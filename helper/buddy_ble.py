#!/usr/bin/env python3
"""Pure BLE transport helper for DSH-ESP-Buddy.

stdin/stdout carry JSONL IPC. Diagnostics go to stderr so stdout remains machine-readable.
"""

from __future__ import annotations

import argparse
import asyncio
import base64
import binascii
import json
import logging
import sys
import time
from collections import deque
from dataclasses import dataclass
from typing import Any, Callable

from bleak import BleakClient, BleakScanner
from bleak.backends.characteristic import BleakGATTCharacteristic
from bleak.backends.device import BLEDevice
from bleak.backends.scanner import AdvertisementData


NUS_SERVICE_UUID = "6e400001-b5a3-f393-e0a9-e50e24dcca9e"
NUS_RX_UUID = "6e400002-b5a3-f393-e0a9-e50e24dcca9e"
NUS_TX_UUID = "6e400003-b5a3-f393-e0a9-e50e24dcca9e"
BUDDY_LINE_MAX = 4096
DEFAULT_WRITE_CHUNK_CAP = 244
DEFAULT_WRITE_LINE_DELAY_SECONDS = 0.0
MAX_WRITE_LINE_DELAY_SECONDS = 0.004

LOGGER = logging.getLogger("buddy-ble")


class ProtocolError(ValueError):
    pass


def matches_buddy(
    device: BLEDevice,
    advertisement: AdvertisementData,
) -> bool:
    # 名称可能为空、被截短或由用户修改；只接受实际广播的 NUS 服务。
    service_uuids = {uuid.casefold() for uuid in advertisement.service_uuids or []}
    return NUS_SERVICE_UUID in service_uuids


def device_label(device: BLEDevice, advertisement: AdvertisementData) -> str:
    name = advertisement.local_name or device.name
    return f"{name} ({device.address})" if name else device.address


class ByteLineDecoder:
    def __init__(self, max_line_bytes: int = BUDDY_LINE_MAX) -> None:
        self._max_line_bytes = max_line_bytes
        self._buffer = bytearray()

    def push(self, chunk: bytes | bytearray) -> list[str]:
        self._buffer.extend(chunk)
        lines: list[str] = []
        while True:
            try:
                newline = self._buffer.index(0x0A)
            except ValueError:
                break
            if newline > self._max_line_bytes:
                raise ProtocolError("Buddy line exceeds configured limit")
            payload = bytes(self._buffer[:newline])
            del self._buffer[: newline + 1]
            if payload.endswith(b"\r"):
                payload = payload[:-1]
            lines.append(payload.decode("utf-8", errors="strict"))
        if len(self._buffer) > self._max_line_bytes:
            raise ProtocolError("Buddy line exceeds configured limit")
        return lines

    def reset(self) -> None:
        self._buffer.clear()


class TxLineBuffer:
    """Control FIFO, bulk FIFO, plus a single latest-wins snapshot slot."""

    def __init__(self) -> None:
        self._condition = asyncio.Condition()
        self._snapshot: str | None = None
        self._control: deque[str] = deque()
        self._bulk: deque[str] = deque()

    async def put(self, line: str, mode: str = "snapshot") -> None:
        async with self._condition:
            if mode == "control":
                self._control.append(line)
            elif mode == "bulk":
                self._bulk.append(line)
            elif mode == "snapshot":
                self._snapshot = line
            else:
                raise ProtocolError("tx.mode must be snapshot, control, or bulk")
            self._condition.notify()

    async def get(self) -> tuple[str, str]:
        async with self._condition:
            await self._condition.wait_for(lambda: bool(self._control) or self._snapshot is not None or bool(self._bulk))
            if self._control:
                return self._control.popleft(), "control"
            if self._snapshot is not None:
                line = self._snapshot
                self._snapshot = None
                return line, "snapshot"
            line = self._bulk.popleft()
            return line, "bulk"

    async def discard_pending(self) -> None:
        async with self._condition:
            self._snapshot = None
            self._control.clear()
            self._bulk.clear()


@dataclass
class TransferDiagnostics:
    started_at: float
    raw_payload_bytes: int = 0
    wire_bytes: int = 0
    att_writes: int = 0
    with_response_writes: int = 0
    without_response_writes: int = 0
    write_seconds: float = 0.0
    throttle_seconds: float = 0.0
    scheduling_seconds: float = 0.0
    ack_wait_seconds: float = 0.0
    ack_wait_started_at: float | None = None
    last_transport_at: float | None = None

    def summary(self, reason: str) -> str:
        elapsed = max(0.001, time.monotonic() - self.started_at)
        raw_kib_per_second = self.raw_payload_bytes / 1024 / elapsed
        unaccounted = max(
            0.0,
            elapsed
            - self.write_seconds
            - self.throttle_seconds
            - self.scheduling_seconds
            - self.ack_wait_seconds,
        )
        return (
            "role-pack transfer %s raw=%dB wire=%dB att=%d wwr=%d wwrq=%d "
            "write=%.3fs throttle=%.3fs schedule=%.3fs ack_wait=%.3fs "
            "unaccounted=%.3fs effective_raw=%.1fKiB/s"
        ) % (
            reason,
            self.raw_payload_bytes,
            self.wire_bytes,
            self.att_writes,
            self.with_response_writes,
            self.without_response_writes,
            self.write_seconds,
            self.throttle_seconds,
            self.scheduling_seconds,
            self.ack_wait_seconds,
            unaccounted,
            raw_kib_per_second,
        )


def chunk_bytes(payload: bytes, chunk_size: int) -> list[bytes]:
    if chunk_size <= 0:
        raise ValueError("chunk_size must be positive")
    return [payload[offset : offset + chunk_size] for offset in range(0, len(payload), chunk_size)]


def emit_event(event: dict[str, Any]) -> None:
    sys.stdout.write(json.dumps(event, ensure_ascii=False, separators=(",", ":")) + "\n")
    sys.stdout.flush()


@dataclass(frozen=True)
class HelperConfig:
    device_address: str
    scan_timeout: float
    write_chunk_cap: int
    write_line_delay_seconds: float


class BuddyBleHelper:
    def __init__(self, config: HelperConfig) -> None:
        self._config = config
        self._stop = asyncio.Event()
        self._disconnected = asyncio.Event()
        self._tx = TxLineBuffer()
        self._client: BleakClient | None = None
        self._device: BLEDevice | None = None
        self._device_address = config.device_address
        self._device_label = ""
        self._transfer_diagnostics: TransferDiagnostics | None = None

    async def run(self) -> None:
        command_task = asyncio.create_task(self._command_loop(), name="ipc-command")
        ble_task = asyncio.create_task(self._ble_loop(), name="ble-loop")
        try:
            await self._stop.wait()
        finally:
            # 先主动断开现有 GATT 链路。若先取消 BLE 任务再等待清理，Windows
            # 可能在进程被父端强制结束后仍保留链路，直到 ESP 的空闲超时才释放。
            await self._disconnect()
            command_task.cancel()
            ble_task.cancel()
            await asyncio.gather(command_task, ble_task, return_exceptions=True)

    async def _command_loop(self) -> None:
        while not self._stop.is_set():
            raw = await asyncio.to_thread(sys.stdin.buffer.readline)
            if raw == b"":
                self._stop.set()
                return
            if len(raw) > 16 * 1024:
                self._error("IPC command exceeds line limit")
                continue
            try:
                command = json.loads(raw.decode("utf-8"))
                await self._handle_command(command)
            except (UnicodeDecodeError, json.JSONDecodeError, ProtocolError) as error:
                self._error(f"invalid IPC command: {error}")

    async def _handle_command(self, command: Any) -> None:
        if not isinstance(command, dict):
            raise ProtocolError("command must be an object")
        command_type = command.get("type")
        if command_type == "stop":
            LOGGER.info("stop requested")
            self._stop.set()
            return
        if command_type != "tx":
            raise ProtocolError("unknown command type")
        line = command.get("line")
        if not isinstance(line, str) or not line.endswith("\n"):
            raise ProtocolError("tx.line must be a newline-terminated string")
        payload = line[:-1].encode("utf-8")
        if len(payload) > BUDDY_LINE_MAX:
            raise ProtocolError("tx.line exceeds Buddy line limit")
        mode = command.get("mode", "snapshot")
        if mode not in ("snapshot", "control", "bulk"):
            raise ProtocolError("tx.mode must be snapshot, control, or bulk")
        await self._tx.put(line, mode)

    async def _ble_loop(self) -> None:
        backoff = 1.0
        while not self._stop.is_set():
            try:
                # 每次重连重新扫描以刷新名称和平台连接信息，目标地址不随改名改变。
                self._device = await self._scan()
                if self._device is None:
                    raise RuntimeError("Buddy device not found" + (f" at {self._device_address}" if self._device_address else ""))
                await self._connect_and_serve(self._device)
                backoff = 1.0
            except asyncio.CancelledError:
                raise
            except Exception as error:  # Bleak backend errors vary by platform.
                self._error(str(error))
            finally:
                self._finish_transfer("disconnected")
                await self._disconnect()
                await self._tx.discard_pending()
                emit_event({"type": "status", "connected": False})

            if not self._stop.is_set():
                await asyncio.sleep(backoff)
                backoff = min(backoff * 2.0, 30.0)

    async def _scan(self) -> BLEDevice | None:
        LOGGER.info("scanning for Buddy BLE device")
        # 主广播可能先于完整名称到达；保留整个主动扫描窗口，按地址合并结果。
        discovered = await BleakScanner.discover(
            timeout=self._config.scan_timeout,
            return_adv=True,
            service_uuids=[NUS_SERVICE_UUID],
            scanning_mode="active",
        )
        candidates = {
            device.address.casefold(): (device, advertisement)
            for device, advertisement in discovered.values()
            if matches_buddy(device, advertisement)
        }
        if self._device_address:
            selected = candidates.get(self._device_address.casefold())
        elif len(candidates) > 1:
            labels = "; ".join(device_label(*candidate) for candidate in candidates.values())
            raise RuntimeError(f"Multiple NUS devices found; set deviceAddress to the intended Buddy: {labels}")
        else:
            selected = next(iter(candidates.values()), None)
        if selected is None:
            return None
        self._device_label = device_label(*selected)
        return selected[0]

    async def _connect_and_serve(self, device: BLEDevice) -> None:
        self._disconnected.clear()
        decoder = ByteLineDecoder()
        loop = asyncio.get_running_loop()

        def disconnected(_client: BleakClient) -> None:
            loop.call_soon_threadsafe(self._disconnected.set)

        client_options: dict[str, Any] = {"services": [NUS_SERVICE_UUID]}
        if sys.platform == "win32":
            client_options["winrt"] = {"use_cached_services": True}
        client = BleakClient(device, disconnected_callback=disconnected, **client_options)
        self._client = client
        LOGGER.info("connecting to %s", self._device_label or device.address)
        await client.connect()

        # First MITM pairing is completed in the Windows Bluetooth UI. Re-pairing on every
        # reconnect is not idempotent on WinRT and can fail with ERROR_CANCELLED.
        rx_characteristic = client.services.get_characteristic(NUS_RX_UUID)
        if rx_characteristic is None:
            raise RuntimeError("Buddy NUS RX characteristic not found")
        if client.services.get_characteristic(NUS_TX_UUID) is None:
            raise RuntimeError("Buddy NUS TX characteristic not found")

        def notification(_characteristic: BleakGATTCharacteristic, data: bytearray) -> None:
            try:
                for line in decoder.push(data):
                    self._observe_ack(line)
                    emit_event({"type": "rx", "line": line})
            except (ProtocolError, UnicodeDecodeError) as error:
                self._error(f"invalid Buddy notification: {error}")
                decoder.reset()

        await client.start_notify(NUS_TX_UUID, notification)
        # 成功连接后保持地址，设备暂时离线时不得改连另一台同名设备。
        self._device_address = device.address
        write_without_response_size = min(
            self._config.write_chunk_cap,
            max(20, rx_characteristic.max_write_without_response_size),
        )
        # Bleak 3.0.2 only exposes the no-response limit. A write request is
        # limited by ATT_MTU - 3; only role-pack control commands use it.
        write_with_response_size = max(20, client.mtu_size - 3)
        LOGGER.info(
            "connected mtu=%d write_without_response_payload=%d",
            client.mtu_size,
            write_without_response_size,
        )
        emit_event({
            "type": "status",
            "connected": True,
            "device": self._device_label or device.address,
            "mtu": client.mtu_size,
        })

        tx_task = asyncio.create_task(
            self._tx_loop(client, write_without_response_size, write_with_response_size),
            name="ble-tx",
        )
        stop_task = asyncio.create_task(self._stop.wait(), name="ble-stop")
        disconnect_task = asyncio.create_task(self._disconnected.wait(), name="ble-disconnect")
        done, pending = await asyncio.wait(
            {tx_task, stop_task, disconnect_task},
            return_when=asyncio.FIRST_COMPLETED,
        )
        for task in pending:
            task.cancel()
        await asyncio.gather(*pending, return_exceptions=True)
        for task in done:
            exception = task.exception() if not task.cancelled() else None
            if exception is not None:
                raise exception

    async def _write_line(
        self,
        client: BleakClient,
        line: str,
        mode: str,
        write_without_response_size: int,
        write_with_response_size: int,
    ) -> None:
        response = mode == "control"
        write_size = write_with_response_size if response else write_without_response_size
        line_bytes = line.encode("utf-8")
        tracks_role_pack = self._observe_role_pack_command(line, mode)
        for chunk in chunk_bytes(line_bytes, write_size):
            started_at = time.monotonic()
            await client.write_gatt_char(NUS_RX_UUID, chunk, response=response)
            finished_at = time.monotonic()
            self._record_att_write(response, started_at, finished_at, tracks_role_pack)
        # Windows 可能将短 asyncio 休眠放大为一个调度周期；每条完整 JSONL
        # 数据块只等待一次，避免同一 V2 块的每个 ATT 分片重复等待。
        if self._config.write_line_delay_seconds > 0 and not response:
            throttle_started_at = time.monotonic()
            await asyncio.sleep(self._config.write_line_delay_seconds)
            self._record_throttle(time.monotonic() - throttle_started_at, tracks_role_pack)
        self._start_ack_wait(line, mode)

    async def _tx_loop(
        self,
        client: BleakClient,
        write_without_response_size: int,
        write_with_response_size: int,
    ) -> None:
        while client.is_connected and not self._stop.is_set():
            line, mode = await self._tx.get()
            await self._write_line(
                client,
                line,
                mode,
                write_without_response_size,
                write_with_response_size,
            )

    def _observe_role_pack_command(self, line: str, mode: str) -> bool:
        if mode not in ("control", "bulk"):
            return False
        try:
            command = json.loads(line)
        except json.JSONDecodeError:
            return False
        if not isinstance(command, dict):
            return False
        name = command.get("cmd")
        if name == "char_begin":
            started_at = time.monotonic()
            self._transfer_diagnostics = TransferDiagnostics(started_at, last_transport_at=started_at)
        metrics = self._transfer_diagnostics
        if metrics is None or name not in {"char_begin", "file", "chunk", "file_end", "char_end", "char_abort"}:
            return False
        metrics.wire_bytes += len(line.encode("utf-8"))
        if name == "chunk" and isinstance(command.get("d"), str):
            try:
                metrics.raw_payload_bytes += len(base64.b64decode(command["d"], validate=True))
            except (ValueError, binascii.Error):
                pass
        return True

    def _record_att_write(
        self,
        response: bool,
        started_at: float,
        finished_at: float,
        tracks_role_pack: bool,
    ) -> None:
        metrics = self._transfer_diagnostics
        if metrics is None or not tracks_role_pack:
            return
        if metrics.last_transport_at is not None:
            metrics.scheduling_seconds += max(0.0, started_at - metrics.last_transport_at)
        metrics.att_writes += 1
        metrics.write_seconds += finished_at - started_at
        metrics.last_transport_at = finished_at
        if response:
            metrics.with_response_writes += 1
        else:
            metrics.without_response_writes += 1

    def _record_throttle(self, elapsed: float, tracks_role_pack: bool) -> None:
        metrics = self._transfer_diagnostics
        if metrics is None or not tracks_role_pack:
            return
        metrics.throttle_seconds += elapsed
        metrics.last_transport_at = time.monotonic()

    def _start_ack_wait(self, line: str, mode: str) -> None:
        if mode not in ("control", "bulk") or self._transfer_diagnostics is None:
            return
        try:
            name = json.loads(line).get("cmd")
        except (AttributeError, json.JSONDecodeError):
            return
        if name in {"char_begin", "file", "chunk", "file_end", "char_end", "char_abort"}:
            self._transfer_diagnostics.ack_wait_started_at = time.monotonic()

    def _observe_ack(self, line: str) -> None:
        metrics = self._transfer_diagnostics
        if metrics is None:
            return
        try:
            ack = json.loads(line)
        except json.JSONDecodeError:
            return
        if not isinstance(ack, dict) or ack.get("ack") not in {"char_begin", "file", "chunk", "file_end", "char_end", "char_abort"}:
            return
        observed_at = time.monotonic()
        if metrics.ack_wait_started_at is not None:
            metrics.ack_wait_seconds += observed_at - metrics.ack_wait_started_at
            metrics.ack_wait_started_at = None
        metrics.last_transport_at = observed_at
        if ack.get("ack") in {"char_end", "char_abort"}:
            self._finish_transfer(str(ack.get("ack")))

    def _finish_transfer(self, reason: str) -> None:
        metrics, self._transfer_diagnostics = self._transfer_diagnostics, None
        if metrics is not None:
            LOGGER.info(metrics.summary(reason))

    async def _disconnect(self) -> None:
        client, self._client = self._client, None
        if client is None:
            return
        LOGGER.info("disconnecting Buddy BLE client")
        try:
            # 即使 Bleak 的本地连接标志已滞后，也请求 WinRT 释放远端链路。
            await client.disconnect()
            LOGGER.info("Buddy BLE client disconnected")
        except Exception as error:
            LOGGER.warning("disconnect failed: %s", error)

    @staticmethod
    def _error(message: str) -> None:
        LOGGER.warning("%s", message)
        emit_event({"type": "error", "message": message[:1024]})


def parse_args(argv: list[str] | None = None) -> HelperConfig:
    parser = argparse.ArgumentParser(description="DSH-ESP-Buddy BLE transport helper")
    parser.add_argument("--device-address", default="")
    parser.add_argument("--scan-timeout", type=float, default=10.0)
    parser.add_argument("--write-chunk-cap", type=int, default=DEFAULT_WRITE_CHUNK_CAP)
    parser.add_argument("--write-line-delay-ms", type=int, default=round(DEFAULT_WRITE_LINE_DELAY_SECONDS * 1_000))
    args = parser.parse_args(argv)
    if args.scan_timeout <= 0:
        parser.error("--scan-timeout must be positive")
    if not 20 <= args.write_chunk_cap <= 244:
        parser.error("--write-chunk-cap must be between 20 and 244")
    if not 0 <= args.write_line_delay_ms <= round(MAX_WRITE_LINE_DELAY_SECONDS * 1_000):
        parser.error("--write-line-delay-ms must be between 0 and 4")
    return HelperConfig(
        args.device_address.strip(),
        args.scan_timeout,
        args.write_chunk_cap,
        args.write_line_delay_ms / 1_000,
    )


async def async_main(argv: list[str] | None = None) -> None:
    logging.basicConfig(level=logging.INFO, stream=sys.stderr, format="[buddy-ble] %(levelname)s %(message)s")
    helper = BuddyBleHelper(parse_args(argv))
    await helper.run()


def main() -> None:
    try:
        asyncio.run(async_main())
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()

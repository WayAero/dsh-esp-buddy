#!/usr/bin/env python3
"""Pure BLE transport helper for DSH-ESP-Buddy.

stdin/stdout carry JSONL IPC. Diagnostics go to stderr so stdout remains machine-readable.
"""

from __future__ import annotations

import argparse
import asyncio
import json
import logging
import sys
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
DEFAULT_WRITE_CHUNK_CAP = 180
WRITE_CHUNK_DELAY_SECONDS = 0.004

LOGGER = logging.getLogger("buddy-ble")


class ProtocolError(ValueError):
    pass


def matches_buddy(
    device: BLEDevice,
    advertisement: AdvertisementData,
    device_name_prefix: str,
) -> bool:
    prefix = device_name_prefix.casefold()
    name = advertisement.local_name or device.name or ""
    if not prefix or not name.casefold().startswith(prefix):
        return False
    service_uuids = {uuid.casefold() for uuid in advertisement.service_uuids or []}
    return not service_uuids or NUS_SERVICE_UUID in service_uuids


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
    """Reliable FIFO plus a single latest-wins snapshot slot."""

    def __init__(self) -> None:
        self._condition = asyncio.Condition()
        self._latest: str | None = None
        self._reliable: deque[str] = deque()

    async def put(self, line: str, mode: str = "latest") -> None:
        async with self._condition:
            if mode == "reliable":
                self._reliable.append(line)
            elif mode == "latest":
                self._latest = line
            else:
                raise ProtocolError("tx.mode must be latest or reliable")
            self._condition.notify()

    async def get(self) -> str:
        async with self._condition:
            await self._condition.wait_for(lambda: bool(self._reliable) or self._latest is not None)
            if self._reliable:
                return self._reliable.popleft()
            line = self._latest
            self._latest = None
            assert line is not None
            return line

    async def discard_reliable(self) -> None:
        async with self._condition:
            self._reliable.clear()


def chunk_bytes(payload: bytes, chunk_size: int) -> list[bytes]:
    if chunk_size <= 0:
        raise ValueError("chunk_size must be positive")
    return [payload[offset : offset + chunk_size] for offset in range(0, len(payload), chunk_size)]


def emit_event(event: dict[str, Any]) -> None:
    sys.stdout.write(json.dumps(event, ensure_ascii=False, separators=(",", ":")) + "\n")
    sys.stdout.flush()


@dataclass(frozen=True)
class HelperConfig:
    device_name_prefix: str
    scan_timeout: float
    write_chunk_cap: int


class BuddyBleHelper:
    def __init__(self, config: HelperConfig) -> None:
        self._config = config
        self._stop = asyncio.Event()
        self._disconnected = asyncio.Event()
        self._tx = TxLineBuffer()
        self._client: BleakClient | None = None
        self._device: BLEDevice | None = None
        self._device_failures = 0

    async def run(self) -> None:
        command_task = asyncio.create_task(self._command_loop(), name="ipc-command")
        ble_task = asyncio.create_task(self._ble_loop(), name="ble-loop")
        try:
            await self._stop.wait()
        finally:
            command_task.cancel()
            ble_task.cancel()
            await asyncio.gather(command_task, ble_task, return_exceptions=True)
            await self._disconnect()

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
        mode = command.get("mode", "latest")
        if mode not in ("latest", "reliable"):
            raise ProtocolError("tx.mode must be latest or reliable")
        await self._tx.put(line, mode)

    async def _ble_loop(self) -> None:
        backoff = 1.0
        while not self._stop.is_set():
            try:
                if self._device is None:
                    self._device = await self._scan()
                    if self._device is None:
                        raise RuntimeError("Buddy device not found")
                await self._connect_and_serve(self._device)
                backoff = 1.0
                self._device_failures = 0
            except asyncio.CancelledError:
                raise
            except Exception as error:  # Bleak backend errors vary by platform.
                self._error(str(error))
                if self._device is not None:
                    self._device_failures += 1
                    if self._device_failures >= 6:
                        LOGGER.info("discarding cached Buddy device after repeated failures")
                        self._device = None
                        self._device_failures = 0
            finally:
                await self._disconnect()
                await self._tx.discard_reliable()
                emit_event({"type": "status", "connected": False})

            if not self._stop.is_set():
                await asyncio.sleep(backoff)
                backoff = min(backoff * 2.0, 30.0)

    async def _scan(self) -> BLEDevice | None:
        def matches(device: BLEDevice, advertisement: AdvertisementData) -> bool:
            return matches_buddy(device, advertisement, self._config.device_name_prefix)

        LOGGER.info("scanning for Buddy BLE device")
        return await BleakScanner.find_device_by_filter(matches, timeout=self._config.scan_timeout)

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
        LOGGER.info("connecting to %s", device.name or device.address)
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
                    emit_event({"type": "rx", "line": line})
            except (ProtocolError, UnicodeDecodeError) as error:
                self._error(f"invalid Buddy notification: {error}")
                decoder.reset()

        await client.start_notify(NUS_TX_UUID, notification)
        write_size = min(
            self._config.write_chunk_cap,
            max(20, rx_characteristic.max_write_without_response_size),
        )
        emit_event({
            "type": "status",
            "connected": True,
            "device": device.name or device.address,
            "mtu": client.mtu_size,
        })

        tx_task = asyncio.create_task(self._tx_loop(client, write_size), name="ble-tx")
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

    async def _tx_loop(self, client: BleakClient, write_size: int) -> None:
        frame_count = 0
        while client.is_connected and not self._stop.is_set():
            line = await self._tx.get()
            payload = line.encode("utf-8")
            for chunk in chunk_bytes(payload, write_size):
                await client.write_gatt_char(NUS_RX_UUID, chunk, response=False)
                if WRITE_CHUNK_DELAY_SECONDS > 0:
                    await asyncio.sleep(WRITE_CHUNK_DELAY_SECONDS)
            frame_count += 1
            if frame_count == 1 or frame_count % 10 == 0:
                LOGGER.info("tx frame count=%d bytes=%d", frame_count, len(payload))

    async def _disconnect(self) -> None:
        client, self._client = self._client, None
        if client is not None and client.is_connected:
            try:
                await client.disconnect()
            except Exception as error:
                LOGGER.warning("disconnect failed: %s", error)

    @staticmethod
    def _error(message: str) -> None:
        LOGGER.warning("%s", message)
        emit_event({"type": "error", "message": message[:1024]})


def parse_args(argv: list[str] | None = None) -> HelperConfig:
    parser = argparse.ArgumentParser(description="DSH-ESP-Buddy BLE transport helper")
    parser.add_argument("--device-name-prefix", default="Claude")
    parser.add_argument("--scan-timeout", type=float, default=10.0)
    parser.add_argument("--write-chunk-cap", type=int, default=DEFAULT_WRITE_CHUNK_CAP)
    args = parser.parse_args(argv)
    if args.scan_timeout <= 0:
        parser.error("--scan-timeout must be positive")
    if not 20 <= args.write_chunk_cap <= 244:
        parser.error("--write-chunk-cap must be between 20 and 244")
    return HelperConfig(args.device_name_prefix, args.scan_timeout, args.write_chunk_cap)


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

import asyncio
import io
import json
import unittest
from types import SimpleNamespace
from unittest.mock import patch
from datetime import datetime, timezone, timedelta

from .buddy_ble import (
    BuddyBleHelper,
    HelperConfig,
    NUS_SERVICE_UUID,
    ByteLineDecoder,
    TxLineBuffer,
    ProtocolError,
    chunk_bytes,
    configure_output_encoding,
    emit_event,
    matches_buddy,
    parse_args,
    encode_time_sync,
)


class OutputEncodingTests(unittest.TestCase):
    def test_chinese_windows_error_is_utf8_even_when_streams_start_as_gbk(self) -> None:
        stdout_bytes, stderr_bytes = io.BytesIO(), io.BytesIO()
        stdout = io.TextIOWrapper(stdout_bytes, encoding="gbk")
        stderr = io.TextIOWrapper(stderr_bytes, encoding="gbk")
        message = "[WinError -2147023673] 操作已被用户取消。"
        with patch("sys.stdout", stdout), patch("sys.stderr", stderr):
            configure_output_encoding()
            emit_event({"type": "error", "message": message})
            stderr.write(message + "\n")
            stderr.flush()
            self.assertEqual(json.loads(stdout_bytes.getvalue().decode("utf-8"))["message"], message)
            self.assertEqual(stderr_bytes.getvalue().decode("utf-8").strip(), message)


class ByteLineDecoderTests(unittest.TestCase):
    def test_split_and_coalesced_lines(self) -> None:
        decoder = ByteLineDecoder(32)
        self.assertEqual(decoder.push(b'{"a":'), [])
        self.assertEqual(decoder.push(b'1}\n{"b":2}\r\n'), ['{"a":1}', '{"b":2}'])

    def test_rejects_overlong_unterminated_line(self) -> None:
        decoder = ByteLineDecoder(4)
        with self.assertRaises(ProtocolError):
            decoder.push(b"12345")


class TxLineBufferTests(unittest.IsolatedAsyncioTestCase):
    async def test_time_slot_coalesces_and_does_not_replace_other_traffic(self) -> None:
        buffer = TxLineBuffer()
        for _ in range(1000):
            await buffer.put("", "time")
        await buffer.put("snapshot\n")
        await buffer.put("control1\n", "control")
        await buffer.put("control2\n", "control")
        await buffer.put("bulk\n", "bulk")
        self.assertEqual(await buffer.get(), ("control1\n", "control"))
        self.assertEqual(await buffer.get(), ("control2\n", "control"))
        self.assertEqual(await buffer.get(), ("snapshot\n", "snapshot"))
        self.assertEqual(await buffer.get(), ("bulk\n", "bulk"))
        self.assertEqual(await buffer.get(), ("", "time"))
        self.assertFalse(buffer._time_pending)
        await buffer.put("", "time")
        await buffer.discard_pending()
        self.assertFalse(buffer._time_pending)

    async def test_old_connection_and_stopped_helper_drop_time_requests(self) -> None:
        helper = BuddyBleHelper(HelperConfig("", 10.0, 244, 0.0))
        helper._client = SimpleNamespace(is_connected=True)
        helper._connection_id = 2
        await helper._handle_command({"type": "time-sync", "connectionId": 1})
        self.assertFalse(helper._tx._time_pending)
        await helper._handle_command({"type": "time-sync", "connectionId": 2})
        self.assertTrue(helper._tx._time_pending)
        await helper._tx.discard_pending()
        helper._disconnected.set()
        await helper._handle_command({"type": "time-sync", "connectionId": 2})
        self.assertFalse(helper._tx._time_pending)
        helper._disconnected.clear()
        helper._stop.set()
        await helper._handle_command({"type": "time-sync", "connectionId": 2})
        self.assertFalse(helper._tx._time_pending)

    async def test_time_is_sampled_at_write_after_queue_delay_and_preserves_frame(self) -> None:
        helper = BuddyBleHelper(HelperConfig("", 10.0, 244, 0.0))
        writes = []
        class Client:
            async def write_gatt_char(self, _uuid, payload, response):
                writes.append((payload, response))
        with patch("helper.buddy_ble.datetime") as clock:
            await helper._tx.put("", "time")
            clock.now.assert_not_called()
            line, mode = await helper._tx.get()
            clock.now.return_value.astimezone.return_value = datetime.fromtimestamp(1791158400, timezone(timedelta(seconds=20700)))
            await helper._write_line(Client(), line, mode, 20, 20)
        payload = b"".join(data for data, _ in writes)
        self.assertEqual(payload, b'{"time":[1791158400,20700]}\n')
        self.assertTrue(all(response for _, response in writes))

    async def test_partial_time_write_failure_escapes_to_disconnect_without_replaying_frame(self) -> None:
        helper = BuddyBleHelper(HelperConfig("", 10.0, 244, 0.0))
        calls = []
        class Client:
            async def write_gatt_char(self, _uuid, payload, response):
                calls.append(payload)
                if len(calls) == 2:
                    raise RuntimeError("BLE write failed")
        with self.assertRaisesRegex(RuntimeError, "BLE write failed"):
            await helper._write_line(Client(), "", "time", 20, 20)
        self.assertEqual(len(calls), 2)

    async def test_long_chinese_snapshot_fragments_without_losing_utf8_or_newline(self) -> None:
        class Client:
            def __init__(self) -> None:
                self.calls: list[tuple[bytes, bool]] = []

            async def write_gatt_char(self, _uuid: str, data: bytes, response: bool) -> None:
                self.calls.append((data, response))

        hint = "允许修改权限，但不修改文件内容。" * 20
        line = json.dumps({"protocol": 2, "prompt": {"id": "p_1", "tool": "pwsh", "hint": hint}}, ensure_ascii=False) + "\n"
        self.assertLessEqual(len(hint.encode("utf-8")), 1024)
        helper = BuddyBleHelper(HelperConfig("", 10.0, 244, 0.0))
        for payload_size in (20, 244):
            client = Client()
            await helper._write_line(client, line, "snapshot", payload_size, payload_size)
            self.assertGreater(len(client.calls), 1)
            self.assertTrue(all(len(data) <= payload_size and not response for data, response in client.calls))
            received = b"".join(data for data, _response in client.calls)
            self.assertEqual(received, line.encode("utf-8"))
            self.assertEqual(json.loads(received.decode("utf-8"))["prompt"]["hint"], hint)

    async def test_snapshot_replaces_stale_snapshot(self) -> None:
        buffer = TxLineBuffer()
        await buffer.put("first\n")
        await buffer.put("second\n")
        self.assertEqual(await buffer.get(), ("second\n", "snapshot"))

    async def test_control_precedes_snapshot_and_bulk(self) -> None:
        buffer = TxLineBuffer()
        await buffer.put("snapshot\n")
        await buffer.put("one\n", "bulk")
        await buffer.put("begin\n", "control")
        await buffer.put("two\n", "bulk")
        self.assertEqual(await buffer.get(), ("begin\n", "control"))
        self.assertEqual(await buffer.get(), ("snapshot\n", "snapshot"))
        self.assertEqual(await buffer.get(), ("one\n", "bulk"))
        self.assertEqual(await buffer.get(), ("two\n", "bulk"))

    async def test_disconnect_discards_all_pending_lines(self) -> None:
        buffer = TxLineBuffer()
        await buffer.put("snapshot\n")
        await buffer.put("stale-command\n", "control")
        await buffer.put("stale-chunk\n", "bulk")
        await buffer.discard_pending()
        self.assertIsNone(buffer._snapshot)
        self.assertEqual(len(buffer._control), 0)
        self.assertEqual(len(buffer._bulk), 0)

    async def test_control_uses_write_requests_while_snapshot_and_bulk_use_commands(self) -> None:
        class Client:
            is_connected = True

            def __init__(self) -> None:
                self.calls: list[tuple[bytes, bool]] = []

            async def write_gatt_char(self, _uuid: str, data: bytes, response: bool) -> None:
                self.calls.append((data, response))

        helper = BuddyBleHelper(HelperConfig("", 10.0, 180, 0.004))
        client = Client()
        await helper._write_line(client, "abcdef", "control", 2, 2)
        self.assertEqual(client.calls, [(b"ab", True), (b"cd", True), (b"ef", True)])
        client.calls.clear()
        sleeps: list[float] = []

        async def record_sleep(seconds: float) -> None:
            sleeps.append(seconds)

        with patch("helper.buddy_ble.asyncio.sleep", record_sleep):
            await helper._write_line(client, "abcdef", "bulk", 2, 2)
        self.assertEqual(client.calls, [(b"ab", False), (b"cd", False), (b"ef", False)])
        self.assertEqual(sleeps, [0.004])
        client.calls.clear()
        await helper._write_line(client, "abcd", "snapshot", 2, 2)
        self.assertEqual(client.calls, [(b"ab", False), (b"cd", False)])

    async def test_role_pack_diagnostics_exclude_snapshots(self) -> None:
        class Client:
            is_connected = True

            async def write_gatt_char(self, _uuid: str, _data: bytes, response: bool) -> None:
                return None

        helper = BuddyBleHelper(HelperConfig("", 10.0, 244, 0.004))
        client = Client()
        await helper._write_line(client, '{"cmd":"char_begin"}\n', "control", 244, 244)
        await helper._write_line(client, '{"total":1}\n', "snapshot", 244, 244)
        await helper._write_line(client, '{"cmd":"chunk","offset":0,"d":"eA=="}\n', "bulk", 244, 244)
        metrics = helper._transfer_diagnostics
        self.assertIsNotNone(metrics)
        assert metrics is not None
        self.assertEqual(metrics.raw_payload_bytes, 1)
        self.assertEqual(metrics.with_response_writes, 1)
        self.assertEqual(metrics.without_response_writes, 1)

    async def test_disconnect_requests_release_even_if_local_state_is_stale(self) -> None:
        class Client:
            is_connected = False

            def __init__(self) -> None:
                self.disconnects = 0

            async def disconnect(self) -> None:
                self.disconnects += 1

        helper = BuddyBleHelper(HelperConfig("", 10.0, 244, 0.004))
        client = Client()
        helper._client = client
        await helper._disconnect()
        self.assertEqual(client.disconnects, 1)
        self.assertIsNone(helper._client)


class UtilityTests(unittest.TestCase):
    def test_time_seconds_and_signed_non_hour_timezone_offsets(self) -> None:
        for seconds in (0, 28800, -18000, 19800, 20700, -12600):
            with self.subTest(offset=seconds), patch("helper.buddy_ble.datetime") as clock:
                clock.now.return_value.astimezone.return_value = datetime.fromtimestamp(1791158400.999, timezone(timedelta(seconds=seconds)))
                self.assertEqual(encode_time_sync(), json.dumps({"time": [1791158400, seconds]}, separators=(",", ":")) + "\n")

    def test_chunk_bytes(self) -> None:
        self.assertEqual(chunk_bytes(b"abcdef", 2), [b"ab", b"cd", b"ef"])

    def test_argument_defaults_match_esp_transport(self) -> None:
        config = parse_args([])
        self.assertEqual(config.device_address, "")
        self.assertEqual(config.write_chunk_cap, 244)
        self.assertEqual(config.write_line_delay_seconds, 0.0)

    def test_write_line_delay_accepts_comparison_values(self) -> None:
        for delay_ms in (0, 1, 4):
            self.assertEqual(parse_args(["--write-line-delay-ms", str(delay_ms)]).write_line_delay_seconds, delay_ms / 1_000)



class DiscoveryTests(unittest.IsolatedAsyncioTestCase):
    @staticmethod
    def candidate(name, address="AA:BB:CC:DD:00:01", local_name=None, uuids=None):
        return (SimpleNamespace(name=name, address=address),
                SimpleNamespace(local_name=local_name, service_uuids=[NUS_SERVICE_UUID] if uuids is None else uuids))

    async def scan(self, helper, candidates):
        # 模拟 Bleak 的地址到最终广播数据映射，不让名称承担身份匹配。
        with patch("helper.buddy_ble.BleakScanner.discover", return_value={str(i): c for i, c in enumerate(candidates)}) as discover:
            result = await helper._scan()
        discover.assert_awaited_once_with(timeout=10.0, return_adv=True, service_uuids=[NUS_SERVICE_UUID], scanning_mode="active")
        return result

    async def test_new_old_custom_short_and_missing_names(self):
        for name in ("DeepSeek-A1B2", "Claude-A1B2", "Desk Buddy", "DeepSeek", "D", " " * 29, None, ""):
            with self.subTest(name=name):
                helper = BuddyBleHelper(HelperConfig("", 10.0, 244, 0.0))
                candidate = self.candidate(name)
                self.assertIs(await self.scan(helper, [candidate]), candidate[0])
                expected = f"{name} ({candidate[0].address})" if name else candidate[0].address
                self.assertEqual(helper._device_label, expected)

    async def test_scan_response_name_overrides_short_device_name(self):
        helper = BuddyBleHelper(HelperConfig("", 10.0, 244, 0.0))
        await self.scan(helper, [self.candidate("DeepSeek", local_name="DeepSeek-A1B2")])
        self.assertEqual(helper._device_label, "DeepSeek-A1B2 (AA:BB:CC:DD:00:01)")

    async def test_same_name_devices_require_address_and_saved_address_survives_rename(self):
        first = self.candidate("Desk Buddy")
        second = self.candidate("Desk Buddy", "AA:BB:CC:DD:00:02")
        helper = BuddyBleHelper(HelperConfig("", 10.0, 244, 0.0))
        with self.assertRaisesRegex(RuntimeError, "Multiple NUS devices.*00:01.*00:02"):
            await self.scan(helper, [first, second])
        helper = BuddyBleHelper(HelperConfig(first[0].address.lower(), 10.0, 244, 0.0))
        self.assertIs(await self.scan(helper, [second, first]), first[0])
        renamed = self.candidate("My New Name")
        self.assertIs(await self.scan(helper, [second, renamed]), renamed[0])
        self.assertEqual(helper._device_label, "My New Name (AA:BB:CC:DD:00:01)")
        self.assertIsNone(await self.scan(helper, [second]))

    async def test_missing_or_wrong_service_never_falls_back_to_name_or_address(self):
        helper = BuddyBleHelper(HelperConfig("AA:BB:CC:DD:00:01", 10.0, 244, 0.0))
        for uuids in ([], ["0000180f-0000-1000-8000-00805f9b34fb"]):
            self.assertIsNone(await self.scan(helper, [self.candidate("Claude-A1B2", uuids=uuids)]))
        self.assertIsNotNone(await self.scan(helper, [self.candidate(None, uuids=[NUS_SERVICE_UUID.upper()])]))

    async def test_connected_address_is_retained_for_reconnect_with_new_name(self):
        helper = BuddyBleHelper(HelperConfig("", 10.0, 244, 0.0))
        old = self.candidate("Claude-A1B2")
        await self.scan(helper, [old])
        helper._stop.set()

        class Client:
            services = SimpleNamespace(get_characteristic=lambda _: SimpleNamespace(max_write_without_response_size=244))
            mtu_size = 247
            is_connected = True

            async def connect(self):
                pass

            async def start_notify(self, uuid, callback):
                self.notify = callback

        with patch("helper.buddy_ble.BleakClient", return_value=Client()) as client, patch("helper.buddy_ble.emit_event") as emit:
            await helper._connect_and_serve(old[0])
        self.assertIs(client.call_args.args[0], old[0])
        self.assertEqual(helper._device_address, old[0].address)
        self.assertEqual(emit.call_args.args[0]["device"], "Claude-A1B2 (AA:BB:CC:DD:00:01)")
        renamed = self.candidate("DeepSeek-A1B2")
        self.assertIs(await self.scan(helper, [self.candidate("DeepSeek-A1B2", "AA:BB:CC:DD:00:02"), renamed]), renamed[0])



if __name__ == "__main__":
    unittest.main()

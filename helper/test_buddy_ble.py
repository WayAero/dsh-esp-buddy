import asyncio
import unittest
from types import SimpleNamespace
from unittest.mock import patch

from .buddy_ble import (
    BuddyBleHelper,
    HelperConfig,
    NUS_SERVICE_UUID,
    ByteLineDecoder,
    TxLineBuffer,
    ProtocolError,
    chunk_bytes,
    matches_buddy,
    parse_args,
)


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

    async def test_disconnect_discards_control_and_bulk_but_keeps_snapshot(self) -> None:
        buffer = TxLineBuffer()
        await buffer.put("snapshot\n")
        await buffer.put("stale-command\n", "control")
        await buffer.put("stale-chunk\n", "bulk")
        await buffer.discard_transfer()
        self.assertEqual(await buffer.get(), ("snapshot\n", "snapshot"))

    async def test_control_uses_write_requests_while_snapshot_and_bulk_use_commands(self) -> None:
        class Client:
            is_connected = True

            def __init__(self) -> None:
                self.calls: list[tuple[bytes, bool]] = []

            async def write_gatt_char(self, _uuid: str, data: bytes, response: bool) -> None:
                self.calls.append((data, response))

        helper = BuddyBleHelper(HelperConfig("Claude", 10.0, 180))
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

        helper = BuddyBleHelper(HelperConfig("Claude", 10.0, 244))
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


class UtilityTests(unittest.TestCase):
    def test_chunk_bytes(self) -> None:
        self.assertEqual(chunk_bytes(b"abcdef", 2), [b"ab", b"cd", b"ef"])

    def test_argument_defaults_match_esp_transport(self) -> None:
        config = parse_args([])
        self.assertEqual(config.device_name_prefix, "Claude")
        self.assertEqual(config.write_chunk_cap, 244)

    def test_device_filter_requires_name_and_rejects_wrong_advertised_service(self) -> None:
        device = SimpleNamespace(name="Claude-A1B2")
        self.assertTrue(matches_buddy(device, SimpleNamespace(local_name=None, service_uuids=[]), "Claude"))
        self.assertTrue(matches_buddy(
            device,
            SimpleNamespace(local_name=None, service_uuids=[NUS_SERVICE_UUID.upper()]),
            "Claude",
        ))
        self.assertFalse(matches_buddy(
            device,
            SimpleNamespace(local_name=None, service_uuids=["0000180f-0000-1000-8000-00805f9b34fb"]),
            "Claude",
        ))
        self.assertFalse(matches_buddy(
            SimpleNamespace(name="Other-NUS"),
            SimpleNamespace(local_name=None, service_uuids=[NUS_SERVICE_UUID]),
            "Claude",
        ))


if __name__ == "__main__":
    unittest.main()

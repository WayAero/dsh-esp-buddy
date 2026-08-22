import asyncio
import unittest
from types import SimpleNamespace

from .buddy_ble import (
    NUS_SERVICE_UUID,
    ByteLineDecoder,
    LatestLineBuffer,
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


class LatestLineBufferTests(unittest.IsolatedAsyncioTestCase):
    async def test_latest_snapshot_replaces_stale_snapshot(self) -> None:
        buffer = LatestLineBuffer()
        await buffer.put("first\n")
        await buffer.put("second\n")
        self.assertEqual(await buffer.get(), "second\n")


class UtilityTests(unittest.TestCase):
    def test_chunk_bytes(self) -> None:
        self.assertEqual(chunk_bytes(b"abcdef", 2), [b"ab", b"cd", b"ef"])

    def test_argument_defaults_match_esp_transport(self) -> None:
        config = parse_args([])
        self.assertEqual(config.device_name_prefix, "Claude")
        self.assertEqual(config.write_chunk_cap, 180)

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

from __future__ import annotations

import io
import json
import unittest

from unity_audio_extractor.protocol import SCHEMA_VERSION, EventEmitter


class ProtocolTests(unittest.TestCase):
    def test_emits_one_versioned_json_object_per_line(self) -> None:
        stream = io.StringIO()
        emitter = EventEmitter(stream=stream)
        emitter.emit("progress", completed=2, total=5)

        lines = stream.getvalue().splitlines()
        self.assertEqual(len(lines), 1)
        event = json.loads(lines[0])
        self.assertEqual(event["schemaVersion"], SCHEMA_VERSION)
        self.assertEqual(event["event"], "progress")
        self.assertEqual(event["completed"], 2)

    def test_protocol_escapes_non_ascii_for_windows_pipes(self) -> None:
        stream = io.StringIO()
        emitter = EventEmitter(stream=stream)
        emitter.emit("progress", current="正在扫描 C:\\音频")

        wire = stream.getvalue()
        self.assertTrue(wire.isascii())
        self.assertEqual(json.loads(wire)["current"], "正在扫描 C:\\音频")


if __name__ == "__main__":
    unittest.main()

from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

from helpers import make_wav_bytes
from unity_audio_extractor.formats import detect_standard_audio


class AudioFormatTests(unittest.TestCase):
    def test_detects_valid_wav(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            path = Path(temporary) / "tone.wav"
            path.write_bytes(make_wav_bytes())
            self.assertEqual(detect_standard_audio(path), "wav")

    def test_rejects_extension_only_match(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            path = Path(temporary) / "not-audio.wav"
            path.write_bytes(b"not a wave file")
            self.assertIsNone(detect_standard_audio(path))

    def test_detects_common_container_headers(self) -> None:
        cases = {
            "tone.ogg": b"OggS" + bytes(12),
            "tone.flac": b"fLaC" + bytes(12),
            "tone.mp3": b"ID3" + bytes(13),
            "tone.m4a": bytes(4) + b"ftyp" + bytes(8),
            "tone.aac": b"\xff\xf1" + bytes(14),
        }
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            for filename, content in cases.items():
                path = root / filename
                path.write_bytes(content)
                with self.subTest(filename=filename):
                    self.assertEqual(detect_standard_audio(path), path.suffix[1:])


if __name__ == "__main__":
    unittest.main()


from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

from unity_audio_extractor.naming import UniqueNameAllocator, sanitize_filename


class FilenameTests(unittest.TestCase):
    def test_sanitizes_paths_control_chars_and_windows_names(self) -> None:
        self.assertEqual(sanitize_filename("../folder\\tone?.wav", "fallback.wav"), "tone_.wav")
        self.assertEqual(sanitize_filename("CON.wav", "fallback.wav"), "_CON.wav")
        self.assertEqual(sanitize_filename("...", "fallback.wav"), "fallback.wav")

    def test_truncates_stem_but_preserves_extension(self) -> None:
        name = sanitize_filename("a" * 300 + ".wav", "fallback.wav", max_length=40)
        self.assertLessEqual(len(name), 40)
        self.assertTrue(name.endswith(".wav"))

    def test_allocator_prevents_case_insensitive_generated_collisions(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            output = Path(temporary)
            allocator = UniqueNameAllocator(output)
            names = [
                allocator.allocate("tone.wav").name,
                allocator.allocate("tone.wav").name,
                allocator.allocate("TONE_2.WAV").name,
            ]
            self.assertEqual(names, ["tone.wav", "tone_2.wav", "TONE_2_2.WAV"])
            self.assertEqual(len({name.casefold() for name in names}), 3)

    def test_allocator_reserves_existing_files(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            output = Path(temporary)
            (output / "tone.wav").write_bytes(b"existing")
            allocator = UniqueNameAllocator(output)
            self.assertEqual(allocator.allocate("Tone.wav").name, "Tone_2.wav")


if __name__ == "__main__":
    unittest.main()


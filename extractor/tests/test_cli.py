from __future__ import annotations

import contextlib
import io
import json
import tempfile
import unittest
from pathlib import Path

from helpers import make_wav_bytes
from unity_audio_extractor.cli import main


class CliTests(unittest.TestCase):
    def test_scan_command_emits_started_progress_and_completed(self) -> None:
        with tempfile.TemporaryDirectory() as input_temp, tempfile.TemporaryDirectory() as output_temp:
            input_dir = Path(input_temp)
            output_dir = Path(output_temp) / "result"
            (input_dir / "tone.wav").write_bytes(make_wav_bytes())
            stdout = io.StringIO()

            with contextlib.redirect_stdout(stdout):
                with self.assertRaises(SystemExit) as exited:
                    main(["scan", "--input", str(input_dir), "--output", str(output_dir)])

            self.assertEqual(exited.exception.code, 0)
            events = [json.loads(line) for line in stdout.getvalue().splitlines()]
            self.assertEqual(
                [event["event"] for event in events],
                ["started", "progress", "completed"],
            )
            self.assertEqual(events[-1]["status"], "complete")
            self.assertEqual(events[-1]["audioExported"], 1)
            self.assertTrue((output_dir / "audio" / "tone.wav").is_file())
            self.assertTrue((output_dir / "audio-manifest.csv").is_file())
            self.assertTrue((output_dir / "extraction-summary.json").is_file())


if __name__ == "__main__":
    unittest.main()

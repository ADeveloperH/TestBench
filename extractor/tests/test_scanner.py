from __future__ import annotations

import csv
import io
import json
import tempfile
import unittest
from pathlib import Path

from helpers import make_wav_bytes
from unity_audio_extractor.protocol import EventEmitter
from unity_audio_extractor.scanner import AudioScanner
from unity_audio_extractor.unity_backend import UnityIssue, UnitySample


class FakeUnityBackend:
    def __init__(
        self,
        samples: list[UnitySample | UnityIssue] | None = None,
        error: Exception | None = None,
    ) -> None:
        self.samples = samples or []
        self.error = error
        self.sources: list[Path] = []

    def iter_audio_items(self, source: Path) -> list[UnitySample | UnityIssue]:
        self.sources.append(source)
        if self.error is not None:
            raise self.error
        return self.samples


class AudioScannerTests(unittest.TestCase):
    def test_exports_direct_and_unity_audio_without_overwrite(self) -> None:
        with tempfile.TemporaryDirectory() as input_temp, tempfile.TemporaryDirectory() as output_temp:
            input_dir = Path(input_temp)
            output_dir = Path(output_temp) / "result"
            (input_dir / "music.wav").write_bytes(make_wav_bytes(b"\x01\x00" * 4))
            (input_dir / "resources.bundle").write_bytes(b"UnityFS-test-fixture")
            samples = [
                UnitySample("clip-one", "music.wav", make_wav_bytes(b"\x02\x00" * 4), 1),
                UnitySample("clip-two", "MUSIC_2.WAV", make_wav_bytes(b"\x03\x00" * 4), 2),
            ]
            stream = io.StringIO()
            emitter = EventEmitter(stream=stream)

            summary = AudioScanner(
                input_dir,
                output_dir,
                emitter,
                backend=FakeUnityBackend(samples=samples),
            ).run()

            self.assertEqual(summary.status, "complete")
            self.assertEqual(summary.audioFound, 3)
            self.assertEqual(summary.audioExported, 3)
            exported = sorted(path.name for path in (output_dir / "audio").iterdir())
            self.assertEqual(exported, ["MUSIC_2_2.WAV", "music.wav", "music_2.wav"])
            self.assertEqual(len({name.casefold() for name in exported}), 3)

            with (output_dir / "audio-manifest.csv").open(encoding="utf-8-sig") as handle:
                rows = list(csv.DictReader(handle))
            self.assertEqual(len(rows), 3)
            self.assertEqual({row["status"] for row in rows}, {"exported"})

            summary_json = json.loads(
                (output_dir / "extraction-summary.json").read_text(encoding="utf-8")
            )
            self.assertEqual(summary_json["audioExported"], 3)
            events = [json.loads(line)["event"] for line in stream.getvalue().splitlines()]
            self.assertEqual(events.count("progress"), 2)

    def test_reports_partial_result_for_bad_unity_candidate(self) -> None:
        with tempfile.TemporaryDirectory() as input_temp, tempfile.TemporaryDirectory() as output_temp:
            input_dir = Path(input_temp)
            output_dir = Path(output_temp) / "result"
            (input_dir / "broken.bundle").write_bytes(b"UnityFS-broken")
            emitter = EventEmitter(stream=io.StringIO())

            summary = AudioScanner(
                input_dir,
                output_dir,
                emitter,
                backend=FakeUnityBackend(error=ValueError("invalid bundle")),
            ).run()

            self.assertEqual(summary.status, "partial")
            self.assertEqual(summary.audioExported, 0)
            self.assertEqual(summary.audioFound, 0)
            self.assertEqual(summary.audioFailed, 0)
            self.assertEqual(summary.candidateFailures, 1)
            self.assertEqual(
                [event["event"] for event in emitter.captured],
                ["warning", "progress"],
            )

    def test_counts_invalid_decoded_sample_as_audio_failure(self) -> None:
        with tempfile.TemporaryDirectory() as input_temp, tempfile.TemporaryDirectory() as output_temp:
            input_dir = Path(input_temp)
            output_dir = Path(output_temp) / "result"
            (input_dir / "audio.bundle").write_bytes(b"UnityFS-test-fixture")
            backend = FakeUnityBackend(
                samples=[UnitySample("broken", "broken.wav", b"not audio", 7)]
            )

            summary = AudioScanner(
                input_dir,
                output_dir,
                EventEmitter(stream=io.StringIO()),
                backend=backend,
            ).run()

            self.assertEqual(summary.status, "partial")
            self.assertEqual(summary.audioFound, 1)
            self.assertEqual(summary.audioExported, 0)
            self.assertEqual(summary.audioFailed, 1)
            self.assertEqual(summary.candidateFailures, 0)
            self.assertEqual(list((output_dir / "audio").iterdir()), [])

    def test_continues_after_one_unity_clip_decode_issue(self) -> None:
        with tempfile.TemporaryDirectory() as input_temp, tempfile.TemporaryDirectory() as output_temp:
            input_dir = Path(input_temp)
            output_dir = Path(output_temp) / "result"
            (input_dir / "audio.bundle").write_bytes(b"UnityFS-test-fixture")
            backend = FakeUnityBackend(
                samples=[
                    UnityIssue("broken", 7, "decoder failed"),
                    UnitySample("good", "good.wav", make_wav_bytes(), 8),
                ]
            )

            summary = AudioScanner(
                input_dir,
                output_dir,
                EventEmitter(stream=io.StringIO()),
                backend=backend,
            ).run()

            self.assertEqual(summary.status, "partial")
            self.assertEqual(summary.audioFound, 2)
            self.assertEqual(summary.audioExported, 1)
            self.assertEqual(summary.audioFailed, 1)
            self.assertTrue((output_dir / "audio" / "good.wav").is_file())

    def test_rejects_output_nested_inside_input(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            input_dir = Path(temporary)
            with self.assertRaisesRegex(ValueError, "must not be inside"):
                AudioScanner(
                    input_dir,
                    input_dir / "output",
                    EventEmitter(stream=io.StringIO()),
                    backend=FakeUnityBackend(),
                )


if __name__ == "__main__":
    unittest.main()

from __future__ import annotations

import csv
import json
import shutil
import tempfile
from dataclasses import asdict, dataclass
from pathlib import Path

from .formats import detect_standard_audio, validate_exported_audio
from .naming import UniqueNameAllocator, sanitize_filename
from .protocol import EventEmitter
from .splits import inspect_split_groups, merge_split_group, stage_companion_resources
from .unity_backend import UnityBackend, UnityIssue, UnityPyBackend, UnitySample


UNITY_FILENAMES = {"globalgamemanagers", "resources.assets"}
UNITY_EXTENSIONS = {".assets", ".bundle", ".unity3d"}
UNITY_MAGICS = (b"UnityFS", b"UnityWeb", b"UnityRaw")


@dataclass
class ExportRecord:
    file: str
    originalName: str
    format: str
    bytes: int
    sourcePath: str
    sourceBundle: str
    clipName: str
    pathId: int | None
    status: str = "exported"
    warning: str = ""


@dataclass
class ExtractionSummary:
    status: str
    candidatesScanned: int
    candidateFailures: int
    audioFound: int
    audioExported: int
    audioSkipped: int
    audioFailed: int
    exportedBytes: int
    warnings: list[dict[str, str]]
    manifestPath: str


def is_unity_candidate(path: Path) -> bool:
    if not path.is_file() or ".split" in path.name:
        return False
    if path.suffix.casefold() in UNITY_EXTENSIONS:
        return True
    if path.name.casefold() in UNITY_FILENAMES or path.name.casefold().startswith("level"):
        return True
    try:
        with path.open("rb") as handle:
            return handle.read(8).startswith(UNITY_MAGICS)
    except OSError:
        return False


class AudioScanner:
    def __init__(
        self,
        input_dir: Path,
        output_dir: Path,
        emitter: EventEmitter,
        backend: UnityBackend | None = None,
        manifest_path: Path | None = None,
    ) -> None:
        self.input_dir = input_dir.resolve()
        self.output_dir = output_dir.resolve()
        if self.output_dir == self.input_dir or self.output_dir.is_relative_to(self.input_dir):
            raise ValueError("output directory must not be inside input directory")
        self.audio_dir = self.output_dir / "audio"
        self.manifest_path = (manifest_path or self.output_dir / "audio-manifest.csv").resolve()
        self.emitter = emitter
        self.backend = backend
        self.records: list[ExportRecord] = []
        self.warnings: list[dict[str, str]] = []
        self.audio_found = 0
        self.audio_failed = 0
        self.candidate_failures = 0

    def run(self) -> ExtractionSummary:
        if not self.input_dir.is_dir():
            raise ValueError(f"input directory does not exist: {self.input_dir}")
        self.audio_dir.mkdir(parents=True, exist_ok=True)
        allocator = UniqueNameAllocator(self.audio_dir)

        all_files = sorted(
            (
                path
                for path in self.input_dir.rglob("*")
                if path.is_file()
                and not path.is_symlink()
                and path.resolve().is_relative_to(self.input_dir)
            ),
            key=lambda path: str(path).casefold(),
        )
        standard_files = [
            (path, audio_format)
            for path in all_files
            if (audio_format := detect_standard_audio(path)) is not None
        ]
        candidates = [path for path in all_files if is_unity_candidate(path)]

        with tempfile.TemporaryDirectory(prefix="testbench-audio-splits-") as temporary:
            split_root = Path(temporary)
            split_groups, split_errors = inspect_split_groups(self.input_dir)
            for error in split_errors:
                self._warn(self.input_dir, error, code="split-sequence")
            for group in split_groups:
                merged = merge_split_group(group, split_root)
                stage_companion_resources(group, split_root)
                if is_unity_candidate(merged):
                    candidates.append(merged)

            candidates = sorted(
                {path.resolve() for path in candidates},
                key=lambda path: str(path).casefold(),
            )
            total_steps = len(standard_files) + len(candidates)
            completed_steps = 0

            for source, audio_format in standard_files:
                completed_steps += 1
                self._copy_standard(source, audio_format, allocator)
                self._emit_progress("standard-audio", completed_steps, total_steps, source)

            if candidates and self.backend is None:
                self.backend = UnityPyBackend()
            for source in candidates:
                completed_steps += 1
                self._scan_unity(source, allocator)
                self._emit_progress("unity-resources", completed_steps, total_steps, source)

        self._write_manifest()
        if self.warnings:
            status = "partial"
        elif self.records:
            status = "complete"
        else:
            status = "empty"
        summary = ExtractionSummary(
            status=status,
            candidatesScanned=len(candidates),
            candidateFailures=self.candidate_failures,
            audioFound=self.audio_found,
            audioExported=len(self.records),
            audioSkipped=0,
            audioFailed=self.audio_failed,
            exportedBytes=sum(record.bytes for record in self.records),
            warnings=self.warnings,
            manifestPath=str(self.manifest_path),
        )
        self._write_summary(summary)
        return summary

    def _copy_standard(
        self,
        source: Path,
        audio_format: str,
        allocator: UniqueNameAllocator,
    ) -> None:
        self.audio_found += 1
        filename = sanitize_filename(source.name, f"audio.{audio_format}")
        target = allocator.allocate(filename)
        try:
            shutil.copyfile(source, target)
            if not validate_exported_audio(target, audio_format):
                target.unlink(missing_ok=True)
                raise ValueError("output format validation failed")
            self.records.append(
                ExportRecord(
                    file=target.name,
                    originalName=source.name,
                    format=audio_format,
                    bytes=target.stat().st_size,
                    sourcePath=self._source_label(source),
                    sourceBundle="",
                    clipName="",
                    pathId=None,
                )
            )
        except Exception as error:
            self.audio_failed += 1
            self._warn(source, error, code="standard-audio-export")

    def _scan_unity(self, source: Path, allocator: UniqueNameAllocator) -> None:
        assert self.backend is not None
        try:
            for item in self.backend.iter_audio_items(source):
                if isinstance(item, UnityIssue):
                    self.audio_found += 1
                    self.audio_failed += 1
                    self._warn(
                        source,
                        ValueError(
                            f"{item.clip_name} ({item.path_id}): {item.error}"
                        ),
                        code="unity-clip-decode",
                    )
                else:
                    self._write_unity_sample(source, item, allocator)
        except Exception as error:
            self.candidate_failures += 1
            self._warn(source, error, code="unity-candidate-parse")

    def _write_unity_sample(
        self,
        source: Path,
        sample: UnitySample,
        allocator: UniqueNameAllocator,
    ) -> None:
        self.audio_found += 1
        fallback = f"{sanitize_filename(sample.clip_name, 'AudioClip')}.wav"
        filename = sanitize_filename(sample.sample_name, fallback)
        if not Path(filename).suffix:
            filename += ".wav"
        target = allocator.allocate(filename)
        try:
            target.write_bytes(sample.data)
            detected = detect_standard_audio(target)
            if detected is None:
                target.unlink(missing_ok=True)
                raise ValueError("decoded sample has an unsupported or invalid audio header")
            self.records.append(
                ExportRecord(
                    file=target.name,
                    originalName=sample.sample_name,
                    format=detected,
                    bytes=len(sample.data),
                    sourcePath=self._source_label(source),
                    sourceBundle=source.name,
                    clipName=sample.clip_name,
                    pathId=sample.path_id,
                )
            )
        except Exception as error:
            self.audio_failed += 1
            self._warn(source, error, code="unity-sample-export")

    def _warn(self, source: Path, error: Exception, code: str) -> None:
        warning = {
            "code": code,
            "source": self._source_label(source),
            "error": f"{type(error).__name__}: {error}",
        }
        self.warnings.append(warning)
        self.emitter.emit("warning", **warning)

    def _emit_progress(
        self,
        stage: str,
        completed: int,
        total: int,
        source: Path,
    ) -> None:
        self.emitter.emit(
            "progress",
            stage=stage,
            completed=completed,
            total=total,
            exported=len(self.records),
            current=self._source_label(source),
        )

    def _source_label(self, source: Path) -> str:
        try:
            return str(source.resolve().relative_to(self.input_dir))
        except ValueError:
            return f"merged/{source.name}"

    def _write_manifest(self) -> None:
        self.manifest_path.parent.mkdir(parents=True, exist_ok=True)
        fieldnames = list(ExportRecord.__dataclass_fields__)
        with self.manifest_path.open("w", encoding="utf-8-sig", newline="") as handle:
            writer = csv.DictWriter(handle, fieldnames=fieldnames)
            writer.writeheader()
            for record in self.records:
                writer.writerow(asdict(record))

    def _write_summary(self, summary: ExtractionSummary) -> None:
        summary_path = self.output_dir / "extraction-summary.json"
        summary_path.write_text(
            json.dumps(asdict(summary), ensure_ascii=False, indent=2),
            encoding="utf-8",
        )

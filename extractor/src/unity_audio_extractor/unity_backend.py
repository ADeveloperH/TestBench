from __future__ import annotations

from collections.abc import Iterable, Iterator
from dataclasses import dataclass
from pathlib import Path
from typing import Protocol


@dataclass(frozen=True)
class UnitySample:
    clip_name: str
    sample_name: str
    data: bytes
    path_id: int


@dataclass(frozen=True)
class UnityIssue:
    clip_name: str
    path_id: int
    error: str


class UnityBackend(Protocol):
    def iter_audio_items(self, source: Path) -> Iterable[UnitySample | UnityIssue]: ...


class UnityPyBackend:
    def __init__(self) -> None:
        try:
            import UnityPy  # type: ignore[import-not-found]
        except ImportError as error:
            raise RuntimeError(
                "UnityPy is required to scan Unity resources; install requirements.lock"
            ) from error
        self._unitypy = UnityPy

    def iter_audio_items(self, source: Path) -> Iterator[UnitySample | UnityIssue]:
        environment = self._unitypy.load(str(source))
        for obj in environment.objects:
            if obj.type.name != "AudioClip":
                continue
            try:
                clip = obj.read()
                clip_name = str(
                    getattr(clip, "m_Name", "") or f"AudioClip_{obj.path_id}"
                )
                samples = clip.samples
                if not samples:
                    yield UnityIssue(
                        clip_name=clip_name,
                        path_id=int(obj.path_id),
                        error="AudioClip has no decoded samples",
                    )
                    continue
                for sample_name, data in samples.items():
                    if data:
                        yield UnitySample(
                            clip_name=clip_name,
                            sample_name=str(sample_name),
                            data=bytes(data),
                            path_id=int(obj.path_id),
                        )
            except Exception as error:
                yield UnityIssue(
                    clip_name=f"AudioClip_{obj.path_id}",
                    path_id=int(obj.path_id),
                    error=f"{type(error).__name__}: {error}",
                )

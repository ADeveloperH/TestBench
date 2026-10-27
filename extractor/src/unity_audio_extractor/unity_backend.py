from __future__ import annotations

from collections.abc import Iterable, Iterator
from dataclasses import dataclass
from pathlib import Path
from typing import Protocol

from .unity_source import inspect_unityfs_header, valid_unity_version


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
    def __init__(self, fallback_version: str | None = None) -> None:
        try:
            import UnityPy  # type: ignore[import-not-found]
        except ImportError as error:
            raise RuntimeError(
                "UnityPy is required to scan Unity resources; install requirements.lock"
            ) from error
        self._unitypy = UnityPy
        self.fallback_version = fallback_version
        self.normalized_bundles = 0

    def iter_audio_items(self, source: Path) -> Iterator[UnitySample | UnityIssue]:
        previous_version = self._unitypy.config.FALLBACK_UNITY_VERSION
        self._unitypy.config.FALLBACK_UNITY_VERSION = self.fallback_version
        try:
            yield from self._read_audio_items(source)
        finally:
            self._unitypy.config.FALLBACK_UNITY_VERSION = previous_version

    def _read_audio_items(self, source: Path) -> Iterator[UnitySample | UnityIssue]:
        header = inspect_unityfs_header(source)
        if header and not valid_unity_version(header.engine_version) and not self.fallback_version:
            raise ValueError("资源缺少有效 Unity 版本，且当前输入中未找到一致的版本信息")
        if header and header.offset:
            with source.open("rb") as handle:
                handle.seek(header.offset)
                payload = handle.read()
            # Keep the source directory for external .resource/.resS lookup.
            environment = self._unitypy.load(payload, path=str(source.parent))
        else:
            environment = self._unitypy.load(str(source))
        if not self._has_serialized_file(environment):
            raise ValueError("未解析出 Unity 序列化资源，可能存在不支持的前缀、混淆或损坏")
        if header and header.offset:
            self.normalized_bundles += 1
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

    def _has_serialized_file(self, container: object) -> bool:
        if isinstance(container, self._unitypy.files.SerializedFile):
            return True
        return any(
            self._has_serialized_file(child)
            for child in getattr(container, "files", {}).values()
        )

from __future__ import annotations

import io
import sys
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import Mock, patch

from helpers import make_serialized_file, make_unityfs, make_wav_bytes
from unity_audio_extractor.protocol import EventEmitter
from unity_audio_extractor.scanner import AudioScanner
from unity_audio_extractor.unity_backend import UnityPyBackend


class SerializedFile:
    pass


class UnityBackendTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        self.module = SimpleNamespace(
            config=SimpleNamespace(FALLBACK_UNITY_VERSION="previous-setting"),
            files=SimpleNamespace(SerializedFile=SerializedFile),
            load=Mock(),
        )
        patcher = patch.dict(sys.modules, {"UnityPy": self.module})
        patcher.start()
        self.addCleanup(patcher.stop)

    def environment(self, objects: list | None = None) -> SimpleNamespace:
        return SimpleNamespace(files={"CAB": SerializedFile()}, objects=objects or [])

    def source(self, data: bytes, name: str = "audio.bundle") -> Path:
        path = self.root / name
        path.write_bytes(data)
        return path

    def test_removes_prefix_and_preserves_companion_directory_and_original_bytes(self) -> None:
        bundle = make_unityfs(version="0.0.0")
        original = b"!" * 31 + bundle
        source = self.source(original)
        backend = UnityPyBackend(fallback_version="2022.3.62f2")

        def load(data: bytes, **kwargs: str) -> SimpleNamespace:
            self.assertEqual(self.module.config.FALLBACK_UNITY_VERSION, "2022.3.62f2")
            self.assertEqual(data, bundle)
            self.assertEqual(kwargs, {"path": str(source.parent)})
            return self.environment()

        self.module.load.side_effect = load
        self.assertEqual(list(backend.iter_audio_items(source)), [])
        self.assertEqual(backend.normalized_bundles, 1)
        self.assertEqual(source.read_bytes(), original)
        self.assertEqual(self.module.config.FALLBACK_UNITY_VERSION, "previous-setting")

    def test_restores_version_on_parse_error_and_generator_close(self) -> None:
        source = self.source(make_unityfs())
        backend = UnityPyBackend(fallback_version="2022.3.62f2")
        self.module.load.side_effect = ValueError("broken resource")
        with self.assertRaisesRegex(ValueError, "broken resource"):
            list(backend.iter_audio_items(source))
        self.assertEqual(self.module.config.FALLBACK_UNITY_VERSION, "previous-setting")
        clip = SimpleNamespace(m_Name="tone", samples={"tone.wav": make_wav_bytes()})
        obj = SimpleNamespace(type=SimpleNamespace(name="AudioClip"), path_id=1, read=lambda: clip)
        self.module.load.side_effect = None
        self.module.load.return_value = self.environment([obj])
        items = backend.iter_audio_items(source)
        self.assertEqual(next(items).clip_name, "tone")
        items.close()
        self.assertEqual(self.module.config.FALLBACK_UNITY_VERSION, "previous-setting")

    def test_missing_version_cannot_reuse_previous_task_setting(self) -> None:
        source = self.source(make_unityfs(version="0.0.0"))
        with self.assertRaisesRegex(ValueError, "未找到一致的版本"):
            list(UnityPyBackend().iter_audio_items(source))
        self.module.load.assert_not_called()
        self.assertEqual(self.module.config.FALLBACK_UNITY_VERSION, "previous-setting")

    def test_unrecognized_candidate_is_partial_but_valid_resource_without_audio_is_empty(self) -> None:
        self.source(make_unityfs())
        self.module.load.return_value = SimpleNamespace(files={"raw": io.BytesIO()}, objects=[])
        with tempfile.TemporaryDirectory() as output:
            summary = AudioScanner(self.root, Path(output), EventEmitter(stream=io.StringIO())).run()
        self.assertEqual(summary.status, "partial")
        self.assertEqual(summary.candidateFailures, 1)
        self.assertIn("未解析出 Unity 序列化资源", summary.warnings[0]["error"])
        self.module.load.return_value = self.environment()
        with tempfile.TemporaryDirectory() as output:
            summary = AudioScanner(self.root, Path(output), EventEmitter(stream=io.StringIO())).run()
        self.assertEqual(summary.status, "empty")
        self.assertEqual(summary.candidateFailures, 0)

    def test_scanner_uses_version_from_merged_split_and_records_normalization(self) -> None:
        serialized = make_serialized_file()
        self.source(serialized[:64], "globalgamemanagers.split0")
        self.source(serialized[64:], "globalgamemanagers.split1")
        self.source(b"!" * 31 + make_unityfs(version="0.0.0"), "hashed-resource")
        self.module.load.return_value = self.environment()
        with tempfile.TemporaryDirectory() as output:
            summary = AudioScanner(self.root, Path(output), EventEmitter(stream=io.StringIO())).run()
        self.assertEqual(summary.status, "empty")
        self.assertEqual(summary.candidatesScanned, 2)
        self.assertEqual(summary.unityVersionFallback, "2022.3.62f2")
        self.assertEqual(summary.normalizedBundles, 1)


class RealUnityPyTests(unittest.TestCase):
    def test_synthetic_standard_and_prefixed_bundles_with_real_parser(self) -> None:
        try:
            import UnityPy
        except ImportError:
            self.skipTest("optional UnityPy dependency is not installed")
        previous = UnityPy.config.FALLBACK_UNITY_VERSION
        for prefix in (b"", b"!" * 31):
            with tempfile.TemporaryDirectory() as temporary:
                source = Path(temporary) / "sample.bundle"
                original = prefix + make_unityfs(version="0.0.0")
                source.write_bytes(original)
                backend = UnityPyBackend(fallback_version="2022.3.62f2")
                self.assertEqual(list(backend.iter_audio_items(source)), [])
                self.assertEqual(backend.normalized_bundles, int(bool(prefix)))
                self.assertEqual(source.read_bytes(), original)
                self.assertEqual(UnityPy.config.FALLBACK_UNITY_VERSION, previous)

    def test_prefixed_bundle_keeps_external_resource_lookup(self) -> None:
        try:
            import UnityPy
            from UnityPy.helpers.ResourceReader import get_resource_data
        except ImportError:
            self.skipTest("optional UnityPy dependency is not installed")
        real_load = UnityPy.load
        with tempfile.TemporaryDirectory() as temporary:
            source = Path(temporary) / "sample.bundle"
            source.write_bytes(b"!" * 31 + make_unityfs())
            audio = make_wav_bytes()
            (source.parent / "external.resource").write_bytes(audio)

            def load_and_check(*args, **kwargs):
                environment = real_load(*args, **kwargs)
                bundle = next(iter(environment.files.values()))
                serialized = next(iter(bundle.files.values()))
                self.assertEqual(
                    get_resource_data("external.resource", serialized, 0, len(audio)),
                    audio,
                )
                return environment

            with patch.object(UnityPy, "load", side_effect=load_and_check):
                self.assertEqual(list(UnityPyBackend().iter_audio_items(source)), [])


if __name__ == "__main__":
    unittest.main()

from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

from helpers import make_serialized_file, make_unityfs
from unity_audio_extractor.scanner import is_unity_candidate
from unity_audio_extractor.unity_source import (
    MAX_PREFIX_BYTES,
    discover_unity_version,
    inspect_unityfs_header,
    serialized_unity_version,
)


class UnitySourceTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)

    def source(self, name: str, data: bytes) -> Path:
        path = self.root / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(data)
        return path

    def test_standard_and_variable_prefixes_include_extensionless_bundles(self) -> None:
        for offset in (0, 31, 53, MAX_PREFIX_BYTES):
            data = b"!" * offset + make_unityfs(version="0.0.0")
            path = self.source(f"bundle-{offset}", data)
            header = inspect_unityfs_header(path)
            self.assertIsNotNone(header)
            assert header is not None
            self.assertEqual(header.offset, offset)
            self.assertEqual(header.engine_version, "0.0.0")
            self.assertTrue(is_unity_candidate(path))
            self.assertEqual(path.read_bytes(), data)

    def test_rejects_signature_only_truncation_wrong_size_and_excessive_prefix(self) -> None:
        for index, data in enumerate((
            b"prefix UnityFS\0 random text",
            b"!" * 31 + make_unityfs()[:-1],
            b"!" * 31 + make_unityfs() + b"trailing",
            b"!" * (MAX_PREFIX_BYTES + 1) + make_unityfs(),
        )):
            path = self.source(f"unknown-{index}", data)
            self.assertIsNone(inspect_unityfs_header(path))
            self.assertFalse(is_unity_candidate(path))

    def test_reads_header_version_and_prefers_globalgamemanagers(self) -> None:
        main = self.source("globalgamemanagers", make_serialized_file("2022.3.62f2"))
        other = self.source("shared.assets", make_serialized_file("2021.3.53f1"))
        bundle = self.source("audio.bundle", make_unityfs(version="0.0.0"))
        self.assertEqual(serialized_unity_version(main), "2022.3.62f2")
        self.assertEqual(discover_unity_version([other, main, bundle]), "2022.3.62f2")

    def test_does_not_take_version_strings_from_arbitrary_payload_or_placeholder(self) -> None:
        paths = [
            self.source("text", b"2022.3.62f2\0"),
            self.source("invalid.assets", make_serialized_file("0.0.0")),
            self.source("audio.bundle", make_unityfs(version="0.0.0")),
        ]
        self.assertIsNone(discover_unity_version(paths))

    def test_uses_bundle_version_only_when_consistent_and_rejects_conflicts(self) -> None:
        first = self.source("first.bundle", make_unityfs())
        second = self.source("second.bundle", make_unityfs(version="2021.3.53f1"))
        self.assertEqual(discover_unity_version([first]), "2022.3.62f2")
        self.assertIsNone(discover_unity_version([first, second]))
        a = self.source("a/globalgamemanagers", make_serialized_file())
        b = self.source("b/globalgamemanagers", make_serialized_file("2021.3.53f1"))
        self.assertIsNone(discover_unity_version([a, b, first]))


if __name__ == "__main__":
    unittest.main()

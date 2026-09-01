from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

from unity_audio_extractor.splits import (
    SplitSequenceError,
    discover_split_groups,
    inspect_split_groups,
    merge_split_group,
    stage_companion_resources,
)


class SplitFileTests(unittest.TestCase):
    def test_discovers_numeric_order_and_merges_parts(self) -> None:
        with tempfile.TemporaryDirectory() as input_temp, tempfile.TemporaryDirectory() as work_temp:
            root = Path(input_temp)
            nested = root / "assets" / "bin" / "Data"
            nested.mkdir(parents=True)
            (nested / "sharedassets0.assets.split2").write_bytes(b"C")
            (nested / "sharedassets0.assets.split0").write_bytes(b"A")
            (nested / "sharedassets0.assets.split1").write_bytes(b"B")

            groups = discover_split_groups(root)
            self.assertEqual(len(groups), 1)
            self.assertEqual(
                groups[0].relative_base,
                Path("assets/bin/Data/sharedassets0.assets"),
            )
            merged = merge_split_group(groups[0], Path(work_temp))
            self.assertEqual(merged.read_bytes(), b"ABC")

    def test_stages_resource_and_ress_companions(self) -> None:
        with tempfile.TemporaryDirectory() as input_temp, tempfile.TemporaryDirectory() as work_temp:
            root = Path(input_temp)
            nested = root / "Data"
            nested.mkdir()
            (nested / "sharedassets0.assets.split0").write_bytes(b"A")
            (nested / "sharedassets0.resource").write_bytes(b"resource")
            (nested / "sharedassets0.assets.resS").write_bytes(b"ress")
            (nested / "ignored.txt").write_bytes(b"ignored")
            group = discover_split_groups(root)[0]

            staged = stage_companion_resources(group, Path(work_temp))

            self.assertEqual(
                sorted(path.name for path in staged),
                ["sharedassets0.assets.resS", "sharedassets0.resource"],
            )
            self.assertEqual((Path(work_temp) / "Data/sharedassets0.resource").read_bytes(), b"resource")
            self.assertFalse((Path(work_temp) / "Data/ignored.txt").exists())

    def test_rejects_missing_part(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            (root / "data.assets.split0").write_bytes(b"A")
            (root / "data.assets.split2").write_bytes(b"C")
            with self.assertRaisesRegex(SplitSequenceError, "incomplete split sequence"):
                discover_split_groups(root)

    def test_inspection_keeps_complete_groups_when_another_is_incomplete(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            (root / "good.assets.split0").write_bytes(b"A")
            (root / "bad.assets.split1").write_bytes(b"B")

            groups, errors = inspect_split_groups(root)

            self.assertEqual([group.relative_base.name for group in groups], ["good.assets"])
            self.assertEqual(len(errors), 1)


if __name__ == "__main__":
    unittest.main()

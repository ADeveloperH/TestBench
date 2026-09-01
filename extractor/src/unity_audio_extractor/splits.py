from __future__ import annotations

import re
import shutil
from dataclasses import dataclass
from pathlib import Path


SPLIT_PATTERN = re.compile(r"^(?P<base>.+)\.split(?P<index>\d+)$")


class SplitSequenceError(ValueError):
    pass


@dataclass(frozen=True)
class SplitGroup:
    relative_base: Path
    parts: tuple[Path, ...]


def inspect_split_groups(root: Path) -> tuple[list[SplitGroup], list[SplitSequenceError]]:
    root = root.resolve()
    grouped: dict[Path, list[tuple[int, Path]]] = {}
    for candidate in root.rglob("*"):
        if (
            not candidate.is_file()
            or candidate.is_symlink()
            or not candidate.resolve().is_relative_to(root)
        ):
            continue
        match = SPLIT_PATTERN.match(candidate.name)
        if match is None:
            continue
        relative_parent = candidate.parent.relative_to(root)
        relative_base = relative_parent / match.group("base")
        grouped.setdefault(relative_base, []).append(
            (int(match.group("index")), candidate)
        )

    results: list[SplitGroup] = []
    errors: list[SplitSequenceError] = []
    for relative_base, numbered_parts in sorted(
        grouped.items(), key=lambda item: str(item[0]).casefold()
    ):
        numbered_parts.sort(key=lambda item: item[0])
        actual = [number for number, _ in numbered_parts]
        expected = list(range(actual[-1] + 1))
        if actual != expected:
            errors.append(
                SplitSequenceError(
                    f"incomplete split sequence for {relative_base}: "
                    f"expected {expected}, got {actual}"
                )
            )
            continue
        results.append(
            SplitGroup(
                relative_base=relative_base,
                parts=tuple(path for _, path in numbered_parts),
            )
        )
    return results, errors


def discover_split_groups(root: Path) -> list[SplitGroup]:
    groups, errors = inspect_split_groups(root)
    if errors:
        raise errors[0]
    return groups


def merge_split_group(group: SplitGroup, work_root: Path) -> Path:
    target = (work_root / group.relative_base).resolve()
    resolved_root = work_root.resolve()
    if not target.is_relative_to(resolved_root):
        raise SplitSequenceError(f"unsafe split target: {group.relative_base}")
    target.parent.mkdir(parents=True, exist_ok=True)
    with target.open("wb") as output:
        for part in group.parts:
            with part.open("rb") as source:
                while chunk := source.read(1024 * 1024):
                    output.write(chunk)
    return target


def stage_companion_resources(group: SplitGroup, work_root: Path) -> list[Path]:
    source_dir = group.parts[0].parent
    target_dir = (work_root / group.relative_base.parent).resolve()
    resolved_root = work_root.resolve()
    if not target_dir.is_relative_to(resolved_root):
        raise SplitSequenceError(f"unsafe companion target: {group.relative_base.parent}")
    target_dir.mkdir(parents=True, exist_ok=True)

    staged = []
    for source in source_dir.iterdir():
        if (
            not source.is_file()
            or source.is_symlink()
            or source.suffix.casefold() not in {".resource", ".ress"}
        ):
            continue
        target = target_dir / source.name
        if target.exists():
            continue
        try:
            target.hardlink_to(source)
        except OSError:
            shutil.copyfile(source, target)
        staged.append(target)
    return staged

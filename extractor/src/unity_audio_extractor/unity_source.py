from __future__ import annotations

import re
import struct
from dataclasses import dataclass
from pathlib import Path
from collections.abc import Iterable


MAX_PREFIX_BYTES = 4096
UNITYFS_MAGIC = b"UnityFS\0"
VERSION_PATTERN = re.compile(r"[1-9]\d{0,3}\.\d+\.\d+[abfp]\d+(?:c\d+)?")


@dataclass(frozen=True)
class UnityFSHeader:
    offset: int
    engine_version: str


def valid_unity_version(value: str) -> bool:
    return VERSION_PATTERN.fullmatch(value) is not None


def inspect_unityfs_header(path: Path) -> UnityFSHeader | None:
    """Inspect a bounded prefix; never accept an embedded signature alone."""
    with path.open("rb") as handle:
        head = handle.read(MAX_PREFIX_BYTES + 320)
    file_size = path.stat().st_size
    offset = head.find(UNITYFS_MAGIC)
    while 0 <= offset <= MAX_PREFIX_BYTES:
        try:
            cursor = offset + len(UNITYFS_MAGIC)
            version = struct.unpack_from(">I", head, cursor)[0]
            if version not in {6, 7, 8}:
                raise ValueError("unsupported UnityFS header version")
            cursor += 4
            strings = []
            for _ in range(2):
                end = head.index(b"\0", cursor, cursor + 128)
                value = head[cursor:end].decode("ascii")
                if not value or not all(32 <= ord(char) < 127 for char in value):
                    raise ValueError("invalid UnityFS version string")
                strings.append(value)
                cursor = end + 1
            size, compressed, uncompressed, _flags = struct.unpack_from(
                ">QIII", head, cursor
            )
            if (
                size != file_size - offset
                or size < cursor + 20 - offset
                or not 0 < compressed <= size - (cursor + 20 - offset)
                or uncompressed <= 0
            ):
                raise ValueError("invalid UnityFS size")
            return UnityFSHeader(offset, strings[1])
        except (ValueError, struct.error):
            offset = head.find(UNITYFS_MAGIC, offset + 1)
    return None


def serialized_unity_version(path: Path) -> str | None:
    """Read the version at its serialized-header position, not from payload text."""
    with path.open("rb") as handle:
        head = handle.read(192)
    if len(head) < 21:
        return None
    metadata_size, file_size, version, data_offset = struct.unpack_from(
        ">4I", head
    )
    if not 9 <= version <= 22 or head[16] not in {0, 1}:
        return None
    cursor = 20
    if version >= 22:
        if len(head) < 49:
            return None
        metadata_size, file_size, data_offset = struct.unpack_from(
            ">IQQ", head, 20
        )
        cursor = 48
    if (
        file_size != path.stat().st_size
        or not 0 < metadata_size <= file_size
        or not cursor < data_offset <= file_size
    ):
        return None
    try:
        end = head.index(b"\0", cursor)
        value = head[cursor:end].decode("ascii")
    except (ValueError, UnicodeDecodeError):
        return None
    return value if valid_unity_version(value) else None


def discover_unity_version(sources: Iterable[Path]) -> str | None:
    sources = list(sources)
    # Do not choose arbitrarily when sources disagree within a priority tier.
    for tier in (
        [path for path in sources if path.name.casefold() == "globalgamemanagers"],
        sources,
    ):
        versions = {
            version
            for path in tier
            if (version := serialized_unity_version(path)) is not None
        }
        if versions:
            return next(iter(versions)) if len(versions) == 1 else None
    versions = {
        header.engine_version
        for path in sources
        if (header := inspect_unityfs_header(path)) is not None
        and valid_unity_version(header.engine_version)
    }
    return next(iter(versions)) if len(versions) == 1 else None

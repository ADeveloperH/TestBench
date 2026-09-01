from __future__ import annotations

import re
import unicodedata
from pathlib import Path


WINDOWS_RESERVED = {
    "CON",
    "PRN",
    "AUX",
    "NUL",
    *(f"COM{index}" for index in range(1, 10)),
    *(f"LPT{index}" for index in range(1, 10)),
}
INVALID_CHARS = re.compile(r'[\x00-\x1f<>:"/\\|?*]')


def sanitize_filename(value: object, fallback: str, max_length: int = 180) -> str:
    raw = unicodedata.normalize("NFC", str(value or "")).replace("\\", "/")
    name = raw.rsplit("/", 1)[-1]
    name = INVALID_CHARS.sub("_", name).strip().rstrip(". ")
    if name in {"", ".", ".."}:
        name = fallback

    path = Path(name)
    if path.stem.upper() in WINDOWS_RESERVED:
        name = f"_{name}"
        path = Path(name)

    if len(name) > max_length:
        suffix = path.suffix[:20]
        stem_limit = max(1, max_length - len(suffix))
        name = f"{path.stem[:stem_limit]}{suffix}"
    return name


class UniqueNameAllocator:
    def __init__(self, output_dir: Path) -> None:
        self.output_dir = output_dir
        self._used = {
            child.name.casefold()
            for child in output_dir.iterdir()
            if child.is_file()
        } if output_dir.exists() else set()

    def allocate(self, filename: str) -> Path:
        path = Path(filename)
        candidate = path.name
        index = 1
        while candidate.casefold() in self._used:
            index += 1
            candidate = f"{path.stem}_{index}{path.suffix}"
        self._used.add(candidate.casefold())
        return self.output_dir / candidate


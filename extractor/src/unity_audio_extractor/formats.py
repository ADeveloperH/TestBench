from __future__ import annotations

from pathlib import Path


STANDARD_AUDIO_EXTENSIONS = {
    ".aac": "aac",
    ".flac": "flac",
    ".m4a": "m4a",
    ".mp3": "mp3",
    ".ogg": "ogg",
    ".opus": "opus",
    ".wav": "wav",
}


def detect_standard_audio(path: Path) -> str | None:
    audio_format = STANDARD_AUDIO_EXTENSIONS.get(path.suffix.casefold())
    if audio_format is None or not path.is_file():
        return None
    try:
        with path.open("rb") as handle:
            header = handle.read(16)
    except OSError:
        return None

    if audio_format == "wav":
        valid = len(header) >= 12 and header[:4] == b"RIFF" and header[8:12] == b"WAVE"
    elif audio_format in {"ogg", "opus"}:
        valid = header.startswith(b"OggS")
    elif audio_format == "flac":
        valid = header.startswith(b"fLaC")
    elif audio_format == "mp3":
        valid = header.startswith(b"ID3") or (
            len(header) >= 2 and header[0] == 0xFF and header[1] & 0xE0 == 0xE0
        )
    elif audio_format == "m4a":
        valid = len(header) >= 12 and header[4:8] == b"ftyp"
    else:  # AAC with ADTS sync word
        valid = len(header) >= 2 and header[0] == 0xFF and header[1] & 0xF6 == 0xF0
    return audio_format if valid else None


def validate_exported_audio(path: Path, expected_format: str) -> bool:
    return detect_standard_audio(path) == expected_format


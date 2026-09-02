from __future__ import annotations

import json
import sys
from dataclasses import dataclass, field
from typing import Any, TextIO


SCHEMA_VERSION = 1


def configure_utf8_stdio() -> None:
    """Keep packaged sidecar pipes deterministic on every Windows locale."""
    for stream in (sys.stdout, sys.stderr):
        reconfigure = getattr(stream, "reconfigure", None)
        if callable(reconfigure):
            reconfigure(encoding="utf-8", errors="backslashreplace")


@dataclass
class EventEmitter:
    stream: TextIO | None = None
    captured: list[dict[str, Any]] = field(default_factory=list)

    def __post_init__(self) -> None:
        if self.stream is None:
            self.stream = sys.stdout

    def emit(self, event: str, **payload: Any) -> dict[str, Any]:
        message = {
            "schemaVersion": SCHEMA_VERSION,
            "event": event,
            **payload,
        }
        self.captured.append(message)
        assert self.stream is not None
        # Keep the wire protocol ASCII-only. json.loads restores non-ASCII
        # values from \u escapes, while Windows code pages can no longer turn
        # one localized path or error message into invalid UTF-8 bytes.
        self.stream.write(json.dumps(message, ensure_ascii=True) + "\n")
        self.stream.flush()
        return message

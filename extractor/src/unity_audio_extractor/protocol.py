from __future__ import annotations

import json
import sys
from dataclasses import dataclass, field
from typing import Any, TextIO


SCHEMA_VERSION = 1


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
        self.stream.write(json.dumps(message, ensure_ascii=False) + "\n")
        self.stream.flush()
        return message

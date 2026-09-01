from __future__ import annotations

import io
import wave


def make_wav_bytes(frames: bytes = b"\x00\x00" * 16) -> bytes:
    output = io.BytesIO()
    with wave.open(output, "wb") as wav:
        wav.setnchannels(1)
        wav.setsampwidth(2)
        wav.setframerate(8000)
        wav.writeframes(frames)
    return output.getvalue()


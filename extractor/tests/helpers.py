from __future__ import annotations

import io
import struct
import wave


def make_wav_bytes(frames: bytes = b"\x00\x00" * 16) -> bytes:
    output = io.BytesIO()
    with wave.open(output, "wb") as wav:
        wav.setnchannels(1)
        wav.setsampwidth(2)
        wav.setframerate(8000)
        wav.writeframes(frames)
    return output.getvalue()


def make_serialized_file(version: str = "2022.3.62f2") -> bytes:
    # A self-created v22 SerializedFile with no types or objects.
    metadata = version.encode() + b"\0" + struct.pack("<iB5i", 13, 0, *([0] * 5)) + b"\0"
    data_offset = max(128, (48 + len(metadata) + 15) // 16 * 16)
    header = struct.pack(">4I", 0, 0, 22, 0) + b"\0" * 4
    header += struct.pack(">IQQQ", len(metadata), data_offset, data_offset, 0)
    return (header + metadata).ljust(data_offset, b"\0")


def make_unityfs(payload: bytes | None = None, version: str = "2022.3.62f2") -> bytes:
    payload = make_serialized_file() if payload is None else payload
    info = b"\0" * 16 + struct.pack(">IIIH", 1, len(payload), len(payload), 0)
    info += struct.pack(">IQQI", 1, 0, len(payload), 4) + b"CAB-test\0"
    start = b"UnityFS\0" + struct.pack(">I", 8) + b"5.x.x\0" + version.encode() + b"\0"
    header_size = (len(start) + 20 + 15) // 16 * 16
    total = header_size + len(info) + len(payload)
    header = start + struct.pack(">QIII", total, len(info), len(info), 0x40)
    return header.ljust(header_size, b"\0") + info + payload


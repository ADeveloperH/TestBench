#!/usr/bin/env bash
# Build the Unity audio extractor sidecar for the current macOS architecture.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PYTHON="${UNITY_AUDIO_PYTHON:-python3}"
DEST="$ROOT/src-tauri/bin/macos"
BUILD="$ROOT/extractor/.sidecar-build"

if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "This script must run on macOS; use the PowerShell script on Windows." >&2
  exit 1
fi

"$PYTHON" -c 'import UnityPy' >/dev/null 2>&1 || {
  echo "UnityPy is unavailable in $PYTHON. Install extractor/requirements.lock first." >&2
  exit 1
}
"$PYTHON" -m PyInstaller --version >/dev/null 2>&1 || {
  echo "PyInstaller is unavailable in $PYTHON. Install extractor/packaging-requirements.txt first." >&2
  exit 1
}

mkdir -p "$DEST"
rm -rf "$BUILD"
mkdir -p "$BUILD/dist" "$BUILD/work" "$BUILD/spec" "$BUILD/cache"
export PYINSTALLER_CONFIG_DIR="$BUILD/cache"

"$PYTHON" -m PyInstaller \
  --noconfirm \
  --clean \
  --onefile \
  --name unity-audio-extractor \
  --paths "$ROOT/extractor/src" \
  --distpath "$BUILD/dist" \
  --workpath "$BUILD/work" \
  --specpath "$BUILD/spec" \
  --collect-all UnityPy \
  --collect-all archspec \
  --collect-all astc_encoder \
  --collect-all etcpak \
  --collect-all fmod_toolkit \
  --collect-all lz4 \
  --collect-all texture2ddecoder \
  "$ROOT/extractor/sidecar_entry.py"

cp "$BUILD/dist/unity-audio-extractor" "$DEST/unity-audio-extractor"
chmod +x "$DEST/unity-audio-extractor"
"$DEST/unity-audio-extractor" --version
echo "Built macOS sidecar: $DEST/unity-audio-extractor"

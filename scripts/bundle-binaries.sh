#!/usr/bin/env bash
# 打包内置的 adb + scrcpy（含 macOS 依赖 dylib）到 src-tauri/bin/macos/。
# 用法：bash scripts/bundle-binaries.sh
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DEST="$ROOT/src-tauri/bin/macos"

if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "当前脚本仅支持 macOS；Windows 请手动放置 adb.exe 与 scrcpy-win64（含 scrcpy-server 与 dll）。"
  exit 1
fi

mkdir -p "$DEST"

# adb（优先 ANDROID_HOME，其次 macOS 默认 SDK 路径）
ADB="${ANDROID_HOME:-$HOME/Library/Android/sdk}/platform-tools/adb"
if [[ -x "$ADB" ]]; then
  cp "$ADB" "$DEST/adb"
  chmod +x "$DEST/adb"
  echo "✔ adb"
else
  echo "✘ 未找到 adb：$ADB"
fi

# scrcpy
SCRCPY="/opt/homebrew/bin/scrcpy"
SCRCPY_SERVER="/opt/homebrew/share/scrcpy/scrcpy-server"
if [[ -x "$SCRCPY" && -f "$SCRCPY_SERVER" ]]; then
  cp "$SCRCPY" "$DEST/scrcpy"
  cp "$SCRCPY_SERVER" "$DEST/scrcpy-server"
  chmod +x "$DEST/scrcpy"
  cd "$DEST"
  # 打包依赖 dylib 并修正加载路径；dylibbundler 默认放 lib/，再移到同目录以对齐 @loader_path
  dylibbundler -od -b -x ./scrcpy -d ./lib/ -p @loader_path >/dev/null 2>&1 || true
  if [[ -d lib ]]; then
    mv lib/*.dylib . 2>/dev/null || true
    rmdir lib 2>/dev/null || true
  fi
  echo "✔ scrcpy（含依赖 dylib）"
else
  echo "✘ 未找到 scrcpy，请先执行：brew install scrcpy dylibbundler"
fi

echo "完成：$DEST"

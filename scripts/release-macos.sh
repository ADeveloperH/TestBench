#!/usr/bin/env bash
# macOS 发布脚本：构建 → 校验 ad-hoc 签名 → 生成 updater latest.json → 汇总 release-output/
#
# 用法：
#   export TAURI_SIGNING_PRIVATE_KEY="$HOME/.tauri/internal-workbench.key"  # 支持密钥内容或密钥文件路径
#   export UPDATE_BASE_URL="https://INTERNAL_UPDATE_HOST/testbench"
#   [export UPDATE_NOTES="本次更新说明"]
#   pnpm release:mac
#
# 产物：
#   release-output/latest.json
#   release-output/<version>/TestBench.app.tar.gz（含 .sig 记录）

set -euo pipefail

: "${TAURI_SIGNING_PRIVATE_KEY:?TAURI_SIGNING_PRIVATE_KEY is not set}"
: "${UPDATE_BASE_URL:?UPDATE_BASE_URL is not set}"
# 本项目的 updater 私钥用空密码生成，需显式置空（未设置时 tauri 会尝试交互式提示密码）
export TAURI_SIGNING_PRIVATE_KEY_PASSWORD="${TAURI_SIGNING_PRIVATE_KEY_PASSWORD:-}"

cd "$(dirname "$0")/.."

echo "==> 前端构建"
pnpm build

echo "==> Tauri 构建（--bundles app：只需 .app + updater 签名产物；首次安装 dmg 由 CI/GitHub Release 提供）"
pnpm tauri build --bundles app

BUNDLE_DIR="src-tauri/target/release/bundle/macos"
APP="$BUNDLE_DIR/TestBench.app"
TAR="$BUNDLE_DIR/TestBench.app.tar.gz"
SIG="$BUNDLE_DIR/TestBench.app.tar.gz.sig"

[ -d "$APP" ] || { echo "缺少 App: $APP"; exit 1; }
[ -f "$TAR" ] || { echo "缺少更新包: $TAR"; exit 1; }
[ -f "$SIG" ] || { echo "缺少签名文件: $SIG（构建时需要有效的 TAURI_SIGNING_PRIVATE_KEY）"; exit 1; }

echo "==> codesign 校验（ad-hoc）"
codesign --verify --deep --strict --verbose=2 "$APP"

VERSION="$(node -p "require('./src-tauri/tauri.conf.json').version")"
case "$(uname -m)" in
  arm64) PLATFORM="darwin-aarch64" ;;
  x86_64) PLATFORM="darwin-x86_64" ;;
  *) echo "不支持的架构: $(uname -m)"; exit 1 ;;
esac

echo "==> 生成 latest.json（$PLATFORM，v$VERSION）"
node scripts/generate-update-json.mjs \
  --version "$VERSION" \
  --platform "$PLATFORM" \
  --tar "$TAR" \
  --sig "$SIG" \
  --out release-output \
  --base-url "$UPDATE_BASE_URL" \
  --notes "${UPDATE_NOTES:-}"

echo "==> 发布产物："
find release-output -type f | sort
echo "==> 完成。将 release-output/ 上传到更新服务器（BASE_URL 指向的目录）即可。"

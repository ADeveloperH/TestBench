#!/bin/zsh -l

# 从 Finder 双击时，先进入脚本所在的项目目录。
SCRIPT_DIR="${0:A:h}"
cd "$SCRIPT_DIR" || exit 1

# Finder 启动的终端可能缺少常见开发工具路径。
export PATH="$HOME/.cargo/bin:$HOME/Library/pnpm:/opt/homebrew/bin:/usr/local/bin:$PATH"

echo "======================================"
echo "  正在启动 TestBench 开发环境"
echo "======================================"
echo "项目目录：$SCRIPT_DIR"
echo ""

if ! command -v pnpm >/dev/null 2>&1; then
  echo "启动失败：未找到 pnpm。"
  echo "请先安装 pnpm，然后重新双击此脚本。"
  echo ""
  read -r "?按回车键关闭窗口..."
  exit 1
fi

pnpm tauri dev
STATUS=$?

if [ "$STATUS" -ne 0 ]; then
  echo ""
  echo "TestBench 启动失败，退出码：$STATUS"
  read -r "?按回车键关闭窗口..."
fi

exit "$STATUS"

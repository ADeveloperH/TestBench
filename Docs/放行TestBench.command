#!/bin/bash
# TestBench 一键放行脚本（解决 macOS「已损坏，无法打开」）
# 用法：右键本文件 → 打开（首次可能提示"无法验证开发者"，
#       到 系统设置 → 隐私与安全性 里点「仍要打开」）

APP="/Applications/TestBench.app"

echo "======================================"
echo "  TestBench 放行工具"
echo "======================================"
echo ""

if [ ! -d "$APP" ]; then
    echo "✘ 未找到 $APP"
    echo "  请先把 TestBench 从 dmg 拖入「应用程序」再运行本脚本。"
    echo ""
    read -r -p "按回车退出..."
    exit 1
fi

echo "① 清除下载隔离属性..."
xattr -cr "$APP"
echo "   ✔ 完成"
echo ""

if command -v codesign >/dev/null 2>&1; then
    echo "② 本机重新签名（ad-hoc）..."
    codesign --force --deep -s - "$APP" 2>/dev/null
    echo "   ✔ 完成"
else
    echo "② 未找到 codesign 工具，跳过重签。"
    echo "   若之后仍提示「已损坏」，请在终端执行：xcode-select --install"
    echo "   安装完 Xcode 命令行工具后再运行本脚本一次。"
fi

echo ""
echo "======================================"
echo "  放行完成！"
echo "  现在请：右键 TestBench 图标 → 打开"
echo "  （首次必须右键打开，之后正常双击即可）"
echo "======================================"
echo ""
read -r -p "按回车退出..."

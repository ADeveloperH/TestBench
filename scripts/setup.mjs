#!/usr/bin/env node
// 一键环境准备：检查 pnpm/cargo → 安装依赖 → 打包内置 adb/scrcpy 二进制。
// 用法：
//   pnpm run setup           # 完整流程（推荐 clone 后第一次执行）
//   pnpm run bundle-bin      # 仅打包内置二进制（等价于 --bin-only）
// 说明：内置二进制打包是 best-effort —— 找不到 adb/scrcpy 时仅告警，
// 应用运行时自动回退到系统 PATH，构建本身不依赖二进制内容。
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { platform } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const binOnly = process.argv.includes("--bin-only");
const isWin = process.platform === "win32";

function run(cmd, args) {
  const name = isWin && cmd === "pnpm" ? "pnpm.cmd" : cmd;
  console.log(`\n> ${name} ${args.join(" ")}`);
  const r = spawnSync(name, args, { stdio: "inherit", cwd: root });
  if (r.error) {
    console.error(`执行失败：${r.error.message}`);
    return 1;
  }
  return r.status ?? 1;
}

let failed = false;

if (!binOnly) {
  // 1. pnpm
  if (run("pnpm", ["--version"])) {
    console.error("\n未找到 pnpm，请先安装：npm install -g pnpm");
    process.exit(1);
  }
  // 2. cargo（tauri 后端必需）
  if (run("cargo", ["--version"])) {
    console.error("\n未找到 cargo，请先安装 Rust 工具链：");
    console.error("  curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh");
    console.error("  Windows 下载：https://rustup.rs");
    console.error("macOS 安装后若当前终端仍找不到 cargo：source ~/.zshrc 或重开终端");
    process.exit(1);
  }
  // 3. 前端依赖（node_modules 已存在则跳过；全新 clone 时非交互安装）
  if (existsSync(join(root, "node_modules"))) {
    console.log("\nnode_modules 已存在，跳过 pnpm install（如需重装：rm -rf node_modules && pnpm install）");
  } else if (run("pnpm", ["install", "--config.confirmModulesPurge=false"])) {
    failed = true;
  }
}

// 4. 内置二进制（best-effort，缺失时运行期回退系统 PATH 的 adb/scrcpy）
const os = platform();
if (os === "darwin") {
  if (run("bash", ["scripts/bundle-binaries.sh"])) {
    console.warn("\n⚠ 内置二进制打包未完全成功（缺少 adb / scrcpy？）。");
    console.warn("  开发调试不受影响（回退系统 PATH）；打包分发给别人前建议补齐：");
    console.warn("    brew install scrcpy dylibbundler && pnpm run bundle-bin");
  }
} else if (os === "win32") {
  if (run("powershell", ["-ExecutionPolicy", "Bypass", "-File", "scripts/bundle-binaries.ps1"])) {
    console.warn("\n⚠ 内置二进制打包未完全成功，开发调试会回退系统 PATH 的 adb/scrcpy。");
  }
} else {
  console.warn("\n⚠ 当前平台暂无自动打包脚本，请手动放置二进制到 src-tauri/bin/<platform>/。");
}

if (failed) process.exit(1);
console.log("\n✅ 完成。启动开发环境：pnpm tauri dev");

#!/usr/bin/env node
// 标准 Tauri 构建门禁：不下载、不修复。
import { prepareIosSidecar } from './prepare-ios-sidecar.mjs';
import { checkIosNotices } from './check-ios-notices.mjs';
import { fileURLToPath } from 'node:url';

try {
  const target = process.env.CARGO_BUILD_TARGET;
  const targets = {
    'aarch64-apple-darwin': ['darwin', 'arm64'],
    'x86_64-apple-darwin': ['darwin', 'x64'],
    'universal-apple-darwin': ['darwin', 'arm64'],
    'x86_64-pc-windows-msvc': ['win32', 'x64'],
  };
  if (target && !Object.hasOwn(targets, target)) throw new Error(`不支持的 iOS 工具构建目标：${target}`);
  const platforms = { darwin: 'darwin', windows: 'win32' };
  const architectures = { aarch64: 'arm64', x86_64: 'x64', universal: 'arm64' };
  const hookPlatform = process.env.TAURI_ENV_PLATFORM;
  const hookArch = process.env.TAURI_ENV_ARCH;
  if ((hookPlatform || hookArch) && (!Object.hasOwn(platforms, hookPlatform) || !Object.hasOwn(architectures, hookArch))) {
    throw new Error(`不支持的 Tauri 构建目标：${hookPlatform}/${hookArch}`);
  }
  const [platform, arch] = hookPlatform
    ? [platforms[hookPlatform], architectures[hookArch]]
    : target ? targets[target] : [process.platform, process.arch];
  await prepareIosSidecar({ platform, arch, check: true });
  await checkIosNotices(fileURLToPath(new URL('../src-tauri/', import.meta.url)));
} catch (error) {
  console.error(`iOS 构建门禁失败：${error.message}；工具缺失请运行 pnpm bundle-ios，许可错误请检查 src-tauri/third-party/go-ios`);
  process.exitCode = 1;
}

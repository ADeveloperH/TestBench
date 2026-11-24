#!/usr/bin/env node
import { open, stat } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { assetFor, verifyArchitecture, verifyHash, verifyVersionOutput } from './prepare-ios-sidecar.mjs';
import { checkIosNotices } from './check-ios-notices.mjs';

export async function checkIosBundle(bundle, platform = process.platform, arch = process.arch) {
  const asset = assetFor(platform, arch);
  if (platform !== process.platform || arch !== process.arch) throw new Error('产物启动验收必须在对应平台和架构的原生 Node 进程运行');
  const root = resolve(bundle);
  const binary = join(root, ...(platform === 'darwin' ? ['Contents', 'Resources'] : []), 'bin', asset.directory, asset.binary);
  if (platform === 'win32') await verifyHash(binary, asset.binarySha256);
  const file = await open(binary, 'r');
  try {
    const buffer = Buffer.alloc(65536);
    const { bytesRead } = await file.read(buffer, 0, buffer.length, 0);
    verifyArchitecture(buffer.subarray(0, bytesRead), platform, arch);
  } finally { await file.close(); }
  if (platform === 'darwin') {
    if (((await stat(binary)).mode & 0o111) === 0) throw new Error('内嵌 ios 缺少执行权限');
    const signature = spawnSync('/usr/bin/codesign', ['--verify', '--deep', '--strict', root], { encoding: 'utf8', timeout: 30000 });
    if (signature.error || signature.status !== 0) throw new Error(`应用包签名检查失败：${signature.error?.message ?? signature.stderr}`);
  }
  const result = spawnSync(binary, ['--version'], { encoding: 'utf8', timeout: 15000, windowsHide: true });
  if (result.error || result.status !== 0) throw new Error(`内嵌 ios 启动失败：${result.error?.message ?? result.stderr}`);
  verifyVersionOutput(result.stdout);
  await checkIosNotices(platform === 'darwin' ? join(root, 'Contents', 'Resources') : root);
  console.log(`iOS 产物检查通过（${platform}/${arch}）：${binary}`);
  return binary;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    if (!process.argv[2] || process.argv.length > 4) throw new Error('用法：node scripts/check-ios-bundle.mjs BUNDLE_ROOT [arm64|x64]');
    await checkIosBundle(process.argv[2], process.platform, process.argv[3] ?? process.arch);
  } catch (error) {
    console.error(`iOS 产物检查失败：${error.message}`);
    process.exitCode = 1;
  }
}

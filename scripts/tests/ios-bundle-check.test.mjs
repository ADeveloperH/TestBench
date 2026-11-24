import test from 'node:test';
import assert from 'node:assert/strict';
import { cp, mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { checkIosBundle } from '../check-ios-bundle.mjs';
import { checkIosNotices } from '../check-ios-notices.mjs';

test('受版本控制的许可与固定 go-ios 资产清单一致', async () => {
  await checkIosNotices(fileURLToPath(new URL('../../src-tauri/', import.meta.url)));
});

test('产物许可缺失、正文篡改或版本来源过期均拒绝', async () => {
  const root = await mkdtemp(join(tmpdir(), 'TestBench 许可 '));
  const directory = join(root, 'third-party', 'go-ios');
  const source = fileURLToPath(new URL('../../src-tauri/third-party/go-ios/', import.meta.url));
  try {
    await assert.rejects(checkIosNotices(root), /ENOENT/);
    await cp(source, directory, { recursive: true });
    await checkIosNotices(root);
    const license = join(directory, 'LICENSE.txt');
    await writeFile(license, 'MIT');
    await assert.rejects(checkIosNotices(root), /SHA-256/);
    await cp(join(source, 'LICENSE.txt'), license);
    const noticePath = join(directory, 'NOTICE.json');
    const notice = JSON.parse(await readFile(noticePath, 'utf8'));
    for (const field of ['version', 'source', 'releaseUrl', 'license', 'licenseSource']) {
      await writeFile(noticePath, JSON.stringify({ ...notice, [field]: 'outdated' }));
      await assert.rejects(checkIosNotices(root), /许可记录不一致/);
    }
    await writeFile(noticePath, JSON.stringify(notice));
    await rm(license);
    await assert.rejects(checkIosNotices(root), /ENOENT/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('拒绝用跨平台静态检查冒充产物启动验收', async () => {
  const platform = process.platform === 'darwin' ? 'win32' : 'darwin';
  await assert.rejects(checkIosBundle('/unused', platform, 'x64'), /原生/);
});

test('安装包缺失或损坏 ios 时失败，不回退源码/PATH 工具', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'TestBench 产物检查 '));
  try {
    await assert.rejects(checkIosBundle(directory), /ENOENT/);
    const dest = process.platform === 'darwin'
      ? join(directory, 'Contents', 'Resources', 'bin', 'macos')
      : join(directory, 'bin', 'windows');
    await mkdir(dest, { recursive: true });
    await writeFile(join(dest, process.platform === 'darwin' ? 'ios' : 'ios.exe'), 'corrupted');
    await assert.rejects(checkIosBundle(directory), /Universal|SHA-256/);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('正式构建拒绝未支持目标，且不下载修复', () => {
  const script = fileURLToPath(new URL('../check-ios-build.mjs', import.meta.url));
  const result = spawnSync(process.execPath, [script], {
    encoding: 'utf8', env: { ...process.env, CARGO_BUILD_TARGET: 'aarch64-pc-windows-msvc' },
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /不支持的.*构建目标/);
});

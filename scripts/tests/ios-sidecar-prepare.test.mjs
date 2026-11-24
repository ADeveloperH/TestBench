import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { chmod, mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { assetFor, manifest, prepareIosSidecar, verifyArchitecture, verifyHash, verifyVersionOutput } from "../prepare-ios-sidecar.mjs";

test("固定版本与 Rust 核心一致，平台/架构不能静默回退", () => {
  const tool = readFileSync(new URL("../../tools/ios-core/src/tool.rs", import.meta.url), "utf8");
  assert.ok(tool.includes(`SUPPORTED_VERSION: &str = "${manifest.version}"`));
  assert.equal(assetFor("darwin", "arm64"), assetFor("darwin", "x64"));
  assert.equal(assetFor("win32", "x64").binary, "ios.exe");
  assert.throws(() => assetFor("win32", "arm64"), /不支持/);
  assert.throws(() => assetFor("linux", "x64"), /不支持/);
  assert.throws(() => assetFor("__proto__", "x64"), /不支持/);
  for (const asset of Object.values(manifest.platforms)) {
    assert.ok(asset.url.includes(`/v${manifest.version}/${asset.asset}`));
    assert.match(asset.archiveSha256, /^[a-f0-9]{64}$/);
    assert.match(asset.binarySha256, /^[a-f0-9]{64}$/);
  }
});

test("架构验证拒绝假 PE、错误 machine 和缺少 Universal slice", () => {
  const pe = Buffer.alloc(128); pe.write("MZ"); pe.writeUInt32LE(64, 60); pe.write("PE\0\0", 64); pe.writeUInt16LE(0x8664, 68);
  verifyArchitecture(pe, "win32", "x64");
  pe.writeUInt16LE(0xaa64, 68);
  assert.throws(() => verifyArchitecture(pe, "win32", "x64"), /架构/);
  assert.throws(() => verifyArchitecture(Buffer.from("not executable"), "win32", "x64"), /PE/);
  const fat = Buffer.alloc(48); fat.writeUInt32BE(0xcafebabe, 0); fat.writeUInt32BE(2, 4);
  fat.writeUInt32BE(0x01000007, 8); fat.writeUInt32BE(0x0100000c, 28);
  verifyArchitecture(fat, "darwin", "arm64");
  fat.writeUInt32BE(0x01000007, 28);
  assert.throws(() => verifyArchitecture(fat, "darwin", "arm64"), /同时包含/);
  assert.throws(() => verifyArchitecture(Buffer.alloc(1), "darwin", "x64"), /Universal/);
});

test("版本 JSON 必须精确匹配，不接受其他版本或普通字符串", () => {
  verifyVersionOutput(JSON.stringify({ version: manifest.version }));
  assert.throws(() => verifyVersionOutput('{"version":"0.0.1"}'), /版本不符/);
  assert.throws(() => verifyVersionOutput("1.3.2"), /版本不符|无法识别/);
});

test("损坏 ZIP 校验失败，保留旧目标及 Android 工具", async () => {
  const root = await mkdtemp(join(tmpdir(), "testbench-ios-bad-"));
  try {
    await writeFile(join(root, "ios"), "existing ios");
    await writeFile(join(root, "adb"), "existing adb");
    const archive = join(root, "bad.zip");
    await writeFile(archive, "invalid archive");
    await verifyHash(archive, createHash("sha256").update("invalid archive").digest("hex"));
    await assert.rejects(prepareIosSidecar({ platform: "darwin", arch: "arm64", dest: root, archive }), /SHA-256/);
    assert.equal(await readFile(join(root, "ios"), "utf8"), "existing ios");
    assert.equal(await readFile(join(root, "adb"), "utf8"), "existing adb");
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("损坏缓存不会被复用或触发未校验覆盖", async () => {
  const root = await mkdtemp(join(tmpdir(), "testbench-ios-cache-"));
  try {
    const asset = assetFor("darwin", "arm64");
    await writeFile(join(root, "ios"), "existing ios");
    await writeFile(join(root, `${asset.archiveSha256}-${asset.asset}`), "damaged cache");
    await assert.rejects(prepareIosSidecar({ platform: "darwin", arch: "arm64", dest: root, cacheDir: root }), /缓存无效/);
    assert.equal(await readFile(join(root, "ios"), "utf8"), "existing ios");
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("下载不完整时返回失败，清理临时下载并保留已有工具", async () => {
  const root = await mkdtemp(join(tmpdir(), "testbench-ios-download-"));
  const originalFetch = globalThis.fetch;
  try {
    await writeFile(join(root, "ios"), "existing ios");
    globalThis.fetch = async (url) => {
      assert.equal(url, assetFor("darwin", "arm64").url);
      return new Response("truncated", { status: 200 });
    };
    const cacheDir = join(root, "cache");
    await assert.rejects(prepareIosSidecar({ platform: "darwin", arch: "arm64", dest: root, cacheDir }), /下载不完整/);
    assert.equal(await readFile(join(root, "ios"), "utf8"), "existing ios");
    assert.deepEqual(await readdir(cacheDir), []);
  } finally {
    globalThis.fetch = originalFetch;
    await rm(root, { recursive: true, force: true });
  }
});

for (const [platform, variable] of [["darwin", "IOS_MAC_ARCHIVE"], ["win32", "IOS_WINDOWS_ARCHIVE"]]) {
  test(`官方 ${platform} ZIP：离线安装、检查、幂等复用、损坏修复，保留其他工具`, { skip: !process.env[variable] }, async () => {
    const root = await mkdtemp(join(tmpdir(), "testbench-ios-real-"));
    try {
      const dest = join(root, "空格 目录");
      const options = { platform, arch: "x64", dest, archive: process.env[variable] };
      const installed = await prepareIosSidecar(options);
      await writeFile(join(dest, "adb-sentinel"), "preserve");
      const modified = (await stat(installed)).mtimeMs;
      await prepareIosSidecar({ ...options, check: true });
      await prepareIosSidecar({ platform, arch: "x64", dest, cacheDir: join(root, "unused-cache") });
      assert.equal((await stat(installed)).mtimeMs, modified);
      await assert.rejects(stat(join(root, "unused-cache")), { code: "ENOENT" });
      await writeFile(installed, "damaged");
      await assert.rejects(prepareIosSidecar({ ...options, check: true }), /SHA-256/);
      await prepareIosSidecar(options);
      await verifyHash(installed, assetFor(platform, "x64").binarySha256);
      if (platform === "darwin" && process.platform !== "win32") {
        await chmod(installed, 0o600);
        await assert.rejects(prepareIosSidecar({ ...options, check: true }), /执行权限/);
        await prepareIosSidecar(options);
      }
      assert.equal(await readFile(join(dest, "adb-sentinel"), "utf8"), "preserve");
    } finally { await rm(root, { recursive: true, force: true }); }
  });
}

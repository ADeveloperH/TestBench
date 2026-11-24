#!/usr/bin/env node
// IOS2-300: 构建阶段准备固定版本 go-ios；不依赖 Go/Python/Homebrew。
import { createHash } from "node:crypto";
import { closeSync, createReadStream, createWriteStream, openSync, readFileSync, realpathSync } from "node:fs";
import { chmod, mkdir, mkdtemp, open, rename, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const manifest = JSON.parse(readFileSync(new URL("./ios-sidecar-assets.json", import.meta.url), "utf8"));

export function assetFor(platform, architecture) {
  const asset = Object.hasOwn(manifest.platforms, platform) ? manifest.platforms[platform] : null;
  if (!asset || !asset.architectures.includes(architecture)) {
    throw new Error(`不支持的 go-ios 目标平台/架构：${platform}/${architecture}`);
  }
  return asset;
}

export async function verifyHash(path, expected) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  const actual = hash.digest("hex");
  if (actual !== expected) throw new Error(`SHA-256 校验失败：${path}（期望 ${expected}，实际 ${actual}）`);
}

export function verifyArchitecture(header, platform, architecture) {
  assetFor(platform, architecture);
  if (platform === "win32") {
    if (header.length < 64 || header.toString("ascii", 0, 2) !== "MZ") throw new Error("go-ios 不是 Windows PE 文件");
    const offset = header.readUInt32LE(60);
    if (offset + 6 > header.length || header.toString("ascii", offset, offset + 4) !== "PE\0\0" || header.readUInt16LE(offset + 4) !== 0x8664) {
      throw new Error("go-ios PE 架构不是 Windows x64");
    }
  } else {
    if (header.length < 8 || header.readUInt32BE(0) !== 0xcafebabe) throw new Error("go-ios 不是 macOS Universal Binary");
    const count = header.readUInt32BE(4);
    if (count < 2 || count > 16 || 8 + count * 20 > header.length) throw new Error("go-ios Universal Binary 架构表无效");
    const cpus = Array.from({ length: count }, (_, index) => header.readUInt32BE(8 + index * 20));
    if (!cpus.includes(0x01000007) || !cpus.includes(0x0100000c)) throw new Error("go-ios 必须同时包含 macOS x64 和 arm64");
  }
}

export function verifyVersionOutput(stdout) {
  let version;
  try { version = JSON.parse(stdout).version; } catch { throw new Error("无法识别 go-ios --version JSON 输出"); }
  if (version !== manifest.version) throw new Error(`go-ios 版本不符：期望 ${manifest.version}，实际 ${version}`);
}

async function verifyBinary(path, platform, architecture) {
  const asset = assetFor(platform, architecture);
  await verifyHash(path, asset.binarySha256);
  const file = await open(path, "r");
  try {
    const header = Buffer.alloc(65536);
    const { bytesRead } = await file.read(header, 0, header.length, 0);
    verifyArchitecture(header.subarray(0, bytesRead), platform, architecture);
  } finally { await file.close(); }
  if (platform !== "win32" && process.platform !== "win32") {
    if (((await stat(path)).mode & 0o111) === 0) throw new Error(`go-ios 缺少执行权限：${path}`);
  }
  if (platform === process.platform) {
    const result = spawnSync(path, ["--version"], { encoding: "utf8", timeout: 15000, windowsHide: true });
    if (result.error || result.status !== 0) throw new Error(`go-ios 版本检查失败：${result.error?.message ?? result.stderr}`);
    verifyVersionOutput(result.stdout);
  }
}

async function downloadArchive(asset, path) {
  console.log(`下载 go-ios v${manifest.version}：${asset.url}`);
  const response = await fetch(asset.url, { signal: AbortSignal.timeout(120000) });
  if (!response.ok || !response.body) throw new Error(`go-ios 下载失败：HTTP ${response.status}`);
  let bytes = 0;
  await pipeline(Readable.fromWeb(response.body), new Transform({
    transform(chunk, _encoding, callback) {
      bytes += chunk.length;
      if (bytes > asset.archiveSize) callback(new Error("go-ios 下载大小超出固定资产大小"));
      else callback(null, chunk);
    },
  }), createWriteStream(path, { flags: "wx" }));
  if (bytes !== asset.archiveSize) throw new Error("go-ios 下载不完整");
  await verifyHash(path, asset.archiveSha256);
}

async function cachedArchive(asset, cacheDir) {
  await mkdir(cacheDir, { recursive: true });
  const path = join(cacheDir, `${asset.archiveSha256}-${asset.asset}`);
  try { await verifyHash(path, asset.archiveSha256); return path; } catch (error) {
    if (error.code !== "ENOENT") throw new Error(`go-ios 缓存无效，请删除后重试：${path}\n${error.message}`);
  }
  const temporary = await mkdtemp(join(cacheDir, ".download-"));
  try {
    const candidate = join(temporary, asset.asset);
    await downloadArchive(asset, candidate);
    await rename(candidate, path);
  } finally { await rm(temporary, { recursive: true, force: true }); }
  return path;
}

function extractBinary(archive, asset, output) {
  if (process.platform === "win32") {
    // 路径通过环境变量传递；仅复制固定 ZIP entry，不解包任意相对路径。
    const script = `$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.IO.Compression.FileSystem
$zip = [IO.Compression.ZipFile]::OpenRead($env:TESTBENCH_IOS_ARCHIVE)
try {
  $entry = $zip.GetEntry($env:TESTBENCH_IOS_ENTRY)
  if ($null -eq $entry) { throw 'go-ios executable missing from archive' }
  $inputFile = $entry.Open()
  try {
    $outputFile = [IO.File]::Create($env:TESTBENCH_IOS_OUTPUT)
    try { $inputFile.CopyTo($outputFile) } finally { $outputFile.Dispose() }
  } finally { $inputFile.Dispose() }
} finally { $zip.Dispose() }`;
    const result = spawnSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], {
      encoding: "utf8", timeout: 60000, windowsHide: true,
      env: { ...process.env, TESTBENCH_IOS_ARCHIVE: archive, TESTBENCH_IOS_ENTRY: asset.binary, TESTBENCH_IOS_OUTPUT: output },
    });
    if (result.error || result.status !== 0) throw new Error(`go-ios 解包失败：${result.error?.message ?? result.stderr}`);
  } else {
    const fd = openSync(output, "wx", 0o700);
    try {
      const result = spawnSync("/usr/bin/unzip", ["-p", archive, asset.binary], { stdio: ["ignore", fd, "pipe"], timeout: 60000 });
      if (result.error || result.status !== 0) throw new Error(`go-ios 解包失败：${result.error?.message ?? result.stderr?.toString()}`);
    } finally { closeSync(fd); }
  }
}

export async function prepareIosSidecar(options = {}) {
  const platform = options.platform ?? process.platform;
  const architecture = options.arch ?? process.arch;
  const asset = assetFor(platform, architecture);
  const dest = resolve(options.dest ?? join(root, "src-tauri", "bin", asset.directory));
  const installed = join(dest, asset.binary);
  const validationScope = platform !== process.platform ? "（跨平台仅静态校验，未运行目标程序）" : "";
  if (options.archive) await verifyHash(resolve(options.archive), asset.archiveSha256);
  if (options.check) {
    await verifyBinary(installed, platform, architecture);
    console.log(`go-ios v${manifest.version} 校验通过：${installed}${validationScope}`);
    return installed;
  }
  try {
    await verifyBinary(installed, platform, architecture);
    console.log(`复用已验证 go-ios v${manifest.version}：${installed}${validationScope}`);
    return installed;
  } catch { /* 缺失或损坏时仅从固定校验资产修复。 */ }
  const archive = options.archive ? resolve(options.archive) : await cachedArchive(asset, resolve(options.cacheDir ?? join(tmpdir(), "testbench-go-ios-assets", manifest.version)));
  await mkdir(dest, { recursive: true });
  const temporary = await mkdtemp(join(dest, ".ios-prepare-"));
  try {
    const candidate = join(temporary, asset.binary);
    extractBinary(archive, asset, candidate);
    if (platform !== "win32") await chmod(candidate, 0o755);
    await verifyBinary(candidate, platform, architecture);
    await rename(candidate, installed);
  } finally { await rm(temporary, { recursive: true, force: true }); }
  console.log(`已准备 go-ios v${manifest.version}（${platform}/${architecture}）：${installed}${validationScope}`);
  return installed;
}

function parseArgs(args) {
  const options = {};
  const keys = { "--platform": "platform", "--arch": "arch", "--dest": "dest", "--archive": "archive", "--cache-dir": "cacheDir" };
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--check") options.check = true;
    else if (Object.hasOwn(keys, args[i]) && args[i + 1] && !args[i + 1].startsWith("--")) options[keys[args[i]]] = args[++i];
    else throw new Error(`未知参数或缺少参数值：${args[i]}`);
  }
  return options;
}

if (process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))) {
  if (process.argv.includes("--help")) {
    console.log("准备固定版本 go-ios：node scripts/prepare-ios-sidecar.mjs [--platform darwin|win32] [--arch arm64|x64] [--dest DIR] [--archive ZIP] [--cache-dir DIR] [--check]");
  } else {
    try { await prepareIosSidecar(parseArgs(process.argv.slice(2))); }
    catch (error) { console.error(`go-ios 准备失败：${error.message}`); process.exitCode = 1; }
  }
}

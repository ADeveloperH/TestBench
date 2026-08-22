#!/usr/bin/env node
//! 生成 Tauri updater 的 latest.json：
//!   - 读取 .app.tar.gz.sig 的内容作为 signature（注意：是内容，不是 URL）
//!   - 生成/合并 <out>/latest.json（支持多架构：--merge 时合并到已有 latest.json）
//!
//! 两种 URL 生成方式：
//!   1. 内部静态服务器：--base-url https://host/path  → url = base-url/<version>/<tarName>
//!   2. GitHub Release：  --url <完整直链>            → url 直接用该直链
//!
//! 用法（内部服务器）：
//!   node scripts/generate-update-json.mjs --version 0.0.3 --platform darwin-aarch64 \
//!     --tar TestBench.app.tar.gz --sig TestBench.app.tar.gz.sig \
//!     --out release-output --base-url https://host/testbench --notes "说明"
//!
//! 用法（GitHub Release，配合 --no-copy）：
//!   node scripts/generate-update-json.mjs --version 0.0.4 --platform darwin-aarch64 \
//!     --tar TestBench_aarch64.app.tar.gz --sig TestBench_aarch64.app.tar.gz.sig \
//!     --out release-output --url "https://github.com/OWNER/REPO/releases/download/v0.0.4/TestBench_aarch64.app.tar.gz" \
//!     --no-copy --notes "说明" --merge

import { readFileSync, writeFileSync, mkdirSync, copyFileSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";

function arg(name, required = true) {
  const i = process.argv.indexOf(`--${name}`);
  if (i < 0 || i + 1 >= process.argv.length) {
    if (required) {
      console.error(`缺少参数 --${name}`);
      process.exit(1);
    }
    return "";
  }
  return process.argv[i + 1];
}

const version = arg("version");
const platform = arg("platform");
const tarPath = resolve(arg("tar"));
const sigPath = resolve(arg("sig"));
const outDir = resolve(arg("out"));
const baseUrl = arg("base-url", false).replace(/\/+$/, "");
const urlOverride = arg("url", false);
const notes = arg("notes", false);
const merge = process.argv.includes("--merge");
const noCopy = process.argv.includes("--no-copy");

if (!["darwin-aarch64", "darwin-x86_64", "windows-x86_64"].includes(platform)) {
  console.error(`不支持的平台: ${platform}`);
  process.exit(1);
}
if (!baseUrl && !urlOverride) {
  console.error("需要 --base-url 或 --url 之一");
  process.exit(1);
}

// 1. 签名内容（必须是 .sig 文件内容本身）
const signature = readFileSync(sigPath, "utf8").trim();
if (!signature) {
  console.error("签名文件为空");
  process.exit(1);
}

// 2. 拷贝更新包到 <out>/<version>/（--no-copy 时跳过，CI 里资产另行上传）
const tarName = tarPath.split("/").pop();
const finalUrl = urlOverride || `${baseUrl}/${version}/${tarName}`;
if (!noCopy) {
  const versionDir = join(outDir, version);
  mkdirSync(versionDir, { recursive: true });
  copyFileSync(tarPath, join(versionDir, tarName));
}

// 3. 生成/合并 latest.json
mkdirSync(outDir, { recursive: true });
const latestPath = join(outDir, "latest.json");
let latest = { version, notes, pub_date: new Date().toISOString(), platforms: {} };
if (merge && existsSync(latestPath)) {
  try {
    latest = JSON.parse(readFileSync(latestPath, "utf8"));
    latest.platforms = latest.platforms ?? {};
  } catch (e) {
    console.error(`已有 latest.json 无法解析（${e.message}），将重新生成`);
  }
}
latest.version = version;
latest.notes = notes || latest.notes || "";
latest.pub_date = new Date().toISOString();
latest.platforms[platform] = {
  signature,
  url: finalUrl,
};

writeFileSync(latestPath, JSON.stringify(latest, null, 2) + "\n");
console.log(`已生成: ${latestPath}`);
console.log(`平台 ${platform}: ${finalUrl}`);
console.log(`签名长度: ${signature.length}`);

#!/usr/bin/env node
//! 生成 Tauri updater 的 latest.json：
//!   - 读取 .app.tar.gz.sig 的内容作为 signature（注意：是内容，不是 URL）
//!   - 把 .app.tar.gz 复制到 <out>/<version>/
//!   - 生成/合并 <out>/latest.json（支持多架构：已有 latest.json 时按平台合并）
//!
//! 用法：
//!   node scripts/generate-update-json.mjs \
//!     --version 0.0.3 \
//!     --platform darwin-aarch64 \
//!     --tar <TestBench.app.tar.gz> \
//!     --sig <TestBench.app.tar.gz.sig> \
//!     --out release-output \
//!     --base-url https://INTERNAL_UPDATE_HOST/testbench \
//!     [--notes "更新说明"] \
//!     [--merge]

import { readFileSync, writeFileSync, mkdirSync, copyFileSync, existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

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
const baseUrl = arg("base-url").replace(/\/+$/, "");
const notes = arg("notes", false);
const merge = process.argv.includes("--merge");

if (!["darwin-aarch64", "darwin-x86_64", "windows-x86_64"].includes(platform)) {
  console.error(`不支持的平台: ${platform}`);
  process.exit(1);
}

// 1. 签名内容（必须是 .sig 文件内容本身）
const signature = readFileSync(sigPath, "utf8").trim();
if (!signature) {
  console.error("签名文件为空");
  process.exit(1);
}

// 2. 拷贝更新包到 <out>/<version>/
const versionDir = join(outDir, version);
mkdirSync(versionDir, { recursive: true });
const tarName = "TestBench.app.tar.gz";
const tarDest = join(versionDir, tarName);
copyFileSync(tarPath, tarDest);

// 3. 生成/合并 latest.json
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
  url: `${baseUrl}/${version}/${tarName}`,
};

writeFileSync(latestPath, JSON.stringify(latest, null, 2) + "\n");
console.log(`已生成: ${latestPath}`);
console.log(`已拷贝: ${tarDest}`);
console.log(`签名长度: ${signature.length}`);

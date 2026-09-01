#!/usr/bin/env node
//! 校验 config/ 下的配置文件（CI 用：push/PR 触发，格式错误直接失败）。
//! 本地运行：node scripts/validate-config.mjs

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
let failed = false;

function check(p, ok, msg) {
  if (!ok) {
    console.error(`✗ ${p}: ${msg}`);
    failed = true;
  } else {
    console.log(`✓ ${p}`);
  }
}

function loadJson(rel) {
  const p = join(root, rel);
  try {
    return { p, data: JSON.parse(readFileSync(p, "utf8")) };
  } catch (e) {
    check(rel, false, `JSON 解析失败：${e.message}`);
    return { p, data: null };
  }
}

// —— remote-config.json ——
{
  const { p, data } = loadJson("config/remote-config.json");
  if (data !== null) {
    check(p, typeof data === "object" && !Array.isArray(data), "必须是 JSON 对象");
    check(p, typeof data.schemaVersion === "number", "缺少数字类型的 schemaVersion");
    check(p, data.updatedAt === undefined || typeof data.updatedAt === "string", "updatedAt 必须是字符串");
    const sections = [
      ["apps", (x) => typeof x.name === "string" && x.name && typeof x.package === "string" && x.package],
      ["searchFavorites", (x) => typeof x.value === "string" && x.value],
      ["tagFavorites", (x) => typeof x.value === "string" && x.value],
      ["tagBlockRules", (x) =>
        typeof x.id === "string" &&
        x.id &&
        typeof x.value === "string" &&
        x.value &&
        typeof x.description === "string" &&
        (x.match === "exact" || x.match === "prefix") &&
        typeof x.group === "string" &&
        typeof x.enabledByDefault === "boolean"],
      ["filters", (x) => typeof x.id === "string" && typeof x.name === "string" && !!x.filters && typeof x.filters === "object"],
      ["testCases", (x) => typeof x.id === "string" && typeof x.name === "string" && Array.isArray(x.rules)],
    ];
    for (const [name, isItem] of sections) {
      const arr = data[name];
      if (arr === undefined) continue;
      check(p, Array.isArray(arr), `「${name}」必须是数组`);
      if (Array.isArray(arr)) {
        const bad = arr.findIndex((x) => !isItem(x));
        check(p, bad < 0, `「${name}」第 ${bad + 1} 项格式不正确`);
      }
    }
    if (Array.isArray(data.tagBlockRules)) {
      const ids = data.tagBlockRules.map((rule) => rule.id);
      const fingerprints = data.tagBlockRules.map(
        (rule) => `${rule.match}:${rule.value.trim().toLowerCase()}`,
      );
      check(
        p,
        new Set(ids).size === ids.length,
        "「tagBlockRules」id 不能重复",
      );
      check(
        p,
        new Set(fingerprints).size === fingerprints.length,
        "「tagBlockRules」Tag 与匹配方式不能重复",
      );
    }
  }
}

// —— projects.json ——
{
  const { p, data } = loadJson("config/projects.json");
  if (data !== null) {
    const arr = data.projects ?? data.apps;
    check(p, Array.isArray(arr), "缺少 projects/apps 数组");
    if (Array.isArray(arr)) {
      const bad = arr.findIndex(
        (x) => !x || typeof x.package !== "string" || !x.package,
      );
      check(p, bad < 0, `第 ${bad + 1} 项缺少 package 字段`);
    }
  }
}

if (failed) {
  console.error("\n配置校验失败，请修复后重新提交。");
  process.exit(1);
}
console.log("\n所有配置校验通过。");

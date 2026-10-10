import assert from "node:assert/strict";
import { test } from "node:test";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

// 用已有 Vite 的 esbuild 编译真实 TS 模块，不另加测试框架依赖。
const require = createRequire(import.meta.url);
const { build } = createRequire(require.resolve("vite"))("esbuild");
const root = fileURLToPath(new URL("../../", import.meta.url));
const bundle = await build({
  stdin: {
    contents: 'export * from "./src/features/testcases/caseConfig"; export * from "./src/features/settings/config"; export * from "./src/core/builtinRegistry";',
    resolveDir: root,
  },
  bundle: true, write: false, format: "esm", platform: "node",
});
const model = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`);
const tc = (id, text = id, enabled = true) => ({
  id, name: id, description: "", enabled, scope: { global: true, apps: [] },
  rules: [{ effect: "pass", description: "成功日志", expr: { kind: "cond", cond: { field: "message", op: "contains", value: text } } }],
});
const builtins = [tc("builtin-on"), tc("builtin-off", "off", false)];
const builtinIds = new Set(builtins.map((c) => c.id));
const storage = (entries) => ({ getItem: (key) => entries[key] ?? null });

model.applyBuiltins({ ...model.getCodeBuiltins(), testCases: builtins });

test("旧缓存迁移保留非内置用例，清理旧内置和退休 ID，修复重复 ID", () => {
  const config = model.readCaseConfig(storage({
    [model.LEGACY_CASES_KEY]: JSON.stringify([tc("builtin-on", "旧规则"), tc("custom"), tc("custom", "different"), tc("no_anr")]),
    [model.LEGACY_REMOVED_KEY]: JSON.stringify(["builtin-off"]),
  }), builtinIds);
  assert.equal(config.customCases.length, 2);
  assert.equal(new Set(config.customCases.map((c) => c.id)).size, 2);
  assert.deepEqual(model.applyCaseConfig(builtins, config, true).map((c) => c.id), ["builtin-on", ...config.customCases.map((c) => c.id)]);
  assert.equal(model.applyCaseConfig(builtins, config, false).length, 4);
});

test("启停覆盖持久化，刷新内置规则保留选择，恢复后清空非内置与删除名单并保留默认停用", () => {
  const config = { ...model.emptyCaseConfig(), customCases: [tc("custom"), tc("imported")],
    enabledOverrides: { "builtin-on": false, "builtin-off": true }, removedBuiltinIds: ["builtin-off"] };
  const loaded = model.readCaseConfig(storage({ [model.CASE_CONFIG_KEY]: JSON.stringify(config) }), builtinIds);
  const refreshed = model.applyCaseConfig([tc("builtin-on", "新规则"), builtins[1]], loaded, false);
  assert.equal(refreshed[0].enabled, false);
  assert.equal(refreshed[0].rules[0].expr.cond.value, "新规则");
  assert.equal(refreshed[1].enabled, true);
  const restored = model.applyCaseConfig(builtins, model.emptyCaseConfig(), true);
  assert.deepEqual(restored, builtins);
  assert.equal(restored[1].enabled, false);
  assert.equal(builtins[0].enabled, true, "覆盖不得修改注册表对象");
});

test("恢复后的空新缓存优先于遗留旧缓存，不会复活自定义用例", () => {
  const config = model.readCaseConfig(storage({
    [model.CASE_CONFIG_KEY]: JSON.stringify(model.emptyCaseConfig()),
    [model.LEGACY_CASES_KEY]: JSON.stringify([tc("old-custom")]),
    [model.LEGACY_REMOVED_KEY]: JSON.stringify(["builtin-on"]),
  }), builtinIds);
  assert.deepEqual(config, model.emptyCaseConfig());
});

test("远程晋升为内置的同 ID 本地条目不会重复出现", () => {
  const config = model.readCaseConfig(storage({
    [model.CASE_CONFIG_KEY]: JSON.stringify({ ...model.emptyCaseConfig(), customCases: [tc("builtin-on"), tc("custom")] }),
  }), builtinIds);
  assert.deepEqual(model.applyCaseConfig(builtins, config, false).map((c) => c.id), ["builtin-on", "builtin-off", "custom"]);
});

test("正式版批量删除保护内置，调试版允许记入删除名单", () => {
  const ids = ["builtin-on", "custom", "imported"];
  assert.deepEqual([...model.deletableCaseIds(ids, builtinIds, false)], ["custom", "imported"]);
  assert.deepEqual([...model.deletableCaseIds(ids, builtinIds, true)], ids);
});

test("导入保留内容去重，同 ID 不同规则重分配，导入内容不覆盖本地启停", () => {
  const local = [tc("builtin-on", "on", false), tc("custom", "custom-rule")];
  const imported = [tc("builtin-on", "new-rule"), tc("custom", "another-rule"), tc("other", "custom-rule"), tc("custom", "third-rule")];
  const merged = model.mergeTestCases(local, imported);
  assert.equal(merged.length, 5);
  assert.equal(new Set(merged.map((c) => c.id)).size, merged.length);
  assert.equal(merged[0].enabled, false);
  assert.ok(merged.slice(2).every((c) => !builtinIds.has(c.id)));
  assert.equal(model.mergeTestCases(merged, imported).length, merged.length, "重复导入应幂等");
});

test("调试隐藏的内置 ID 导入为不同规则时仍分配非内置 ID", () => {
  const merged = model.mergeTestCases([], [tc("builtin-off", "imported-rule")]);
  assert.equal(merged.length, 1);
  assert.ok(!builtinIds.has(merged[0].id));
});

test("损坏缓存回退；非法启停值被忽略", () => {
  const config = model.readCaseConfig(storage({
    [model.CASE_CONFIG_KEY]: JSON.stringify({ ...model.emptyCaseConfig(), enabledOverrides: { "builtin-on": "false", "builtin-off": false } }),
  }), builtinIds);
  assert.deepEqual(config.enabledOverrides, { "builtin-off": false });
  assert.deepEqual(model.readCaseConfig(storage({ [model.CASE_CONFIG_KEY]: "invalid" }), builtinIds), model.emptyCaseConfig());
});

test("规则或作用域修改使运行指纹失效，名称和启停修改不清空已有证据", () => {
  const original = tc("case");
  const fingerprint = model.caseRuntimeFingerprint(original);
  assert.equal(model.caseRuntimeFingerprint({ ...original, name: "新名称", enabled: false }), fingerprint);
  assert.notEqual(model.caseRuntimeFingerprint({ ...original, rules: [] }), fingerprint);
  assert.notEqual(model.caseRuntimeFingerprint({ ...original, scope: { global: false, apps: ["test.app"] } }), fingerprint);
});

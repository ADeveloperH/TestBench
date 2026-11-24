import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import ts from "typescript";

const require = createRequire(import.meta.url);
const source = readFileSync(new URL("../../src/features/ios/useIosWorkspaceTabs.ts", import.meta.url), "utf8")
  .replace('from "react"', `from ${JSON.stringify(pathToFileURL(require.resolve("react")).href)}`);
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2020 } }).outputText;
const { loadIosWorkspaces, serializeIosWorkspaces, emptyIosView } = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString("base64")}`);
const storage = new Map();
globalThis.localStorage = { getItem: (key) => storage.get(key) ?? null };

test("持久化恢复筛选但不恢复日志、会话和暂停快照，且不读取 Android 缓存", () => {
  storage.clear();
  storage.set("logcat-workspace-tabs-v1", "existing-android-cache");
  const tab = { ...emptyIosView(), id: "tab1", name: "Error", markers: "[LevelFlow],!noise", search: "needle", regex: true, activeFilterId: "ios-only", semantic: "error", follow: false,
    find: { open: true, query: "find-needle", caseSensitive: true, useRegex: true, currentMatch: 82 },
    snapshot: [{ raw: "private runtime text" }], selected: { raw: "selected text" }, clearedThrough: 100 };
  const serialized = serializeIosWorkspaces({ "ios:one": { tabs: [tab], activeId: "tab1", sessionId: "runtime-session" } });
  assert.ok(!serialized.includes("runtime-session"));
  assert.ok(!serialized.includes("private runtime text"));
  assert.ok(!serialized.includes("selected text"));
  storage.set("ios-workspace-tabs-v1", serialized);
  const loaded = loadIosWorkspaces()["ios:one"];
  assert.equal(loaded.tabs[0].search, "needle");
  assert.equal(loaded.tabs[0].markers, "[LevelFlow],!noise");
  assert.equal(loaded.tabs[0].regex, true);
  assert.equal(loaded.tabs[0].activeFilterId, "ios-only");
  assert.deepEqual(loaded.tabs[0].find, { open: false, query: "find-needle", caseSensitive: true, useRegex: true, currentMatch: 0 });
  assert.equal(loaded.tabs[0].follow, false);
  assert.equal(loaded.tabs[0].snapshot, null);
  assert.equal(loaded.tabs[0].clearedThrough, -1);
  assert.equal(loaded.sessionId, null);
  assert.equal(storage.get("logcat-workspace-tabs-v1"), "existing-android-cache");
});

test("按设备隔离，修复活动 Tab 和重复 ID，损坏数据可回退", () => {
  storage.set("ios-workspace-tabs-v1", JSON.stringify({
    "ios:one": { activeId: "missing", tabs: [{ id: "a", name: "one", search: "one" }, { id: "a", name: "duplicate" }] },
    "ios:two": { activeId: "b", tabs: [{ id: "b", name: "two", search: "two" }] },
    "android:serial": { tabs: [{ id: "c" }] },
  }));
  const loaded = loadIosWorkspaces();
  assert.equal(loaded["ios:one"].activeId, "a");
  assert.equal(loaded["ios:one"].tabs.length, 1);
  assert.equal(loaded["ios:one"].tabs[0].regex, false);
  assert.equal(loaded["ios:one"].tabs[0].markers, "");
  assert.equal(loaded["ios:one"].tabs[0].activeFilterId, "");
  assert.deepEqual(loaded["ios:one"].tabs[0].find, emptyIosView().find);
  assert.equal(loaded["ios:two"].tabs[0].search, "two");
  assert.equal(loaded["android:serial"], undefined);
  storage.set("ios-workspace-tabs-v1", "{broken");
  assert.deepEqual(loadIosWorkspaces(), {});
});

test('iOS 测试Tab只恢复身份和应用，不恢复运行轮次、证据或临时屏蔽开关', () => {
  const tab = { ...emptyIosView(), id: 'pilot', name: 'Fruit试点', kind: 'test', testBundleId: 'com.lucky.fruit.quest.master', testRun: { sessionId: 'capture-secret', afterSequence: 99, key: 'round-secret' }, showBlockedLogs: true };
  const serialized = serializeIosWorkspaces({ 'ios:one': { activeId: tab.id, sessionId: 'capture-secret', tabs: [tab] } });
  assert.ok(!serialized.includes('capture-secret')); assert.ok(!serialized.includes('round-secret'));
  storage.set('ios-workspace-tabs-v1', serialized);
  const loaded = loadIosWorkspaces()['ios:one'].tabs[0];
  assert.equal(loaded.kind, 'test'); assert.equal(loaded.testBundleId, tab.testBundleId);
  assert.equal(loaded.testRun, undefined); assert.equal(loaded.showBlockedLogs, undefined);
});

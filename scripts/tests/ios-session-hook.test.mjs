import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import ts from "typescript";

const moduleUrl = (source) => `data:text/javascript;base64,${Buffer.from(source).toString("base64")}`;
const compile = (path) => ts.transpileModule(readFileSync(new URL(path, import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.ESNext } }).outputText;
const retention = moduleUrl(compile("../../src/core/logRetention.ts"));
const helpers = moduleUrl(compile("../../src/features/ios/iosSessionEvents.ts"));
const react = moduleUrl(`
export const useState = value => globalThis.iosHookTest.state(value);
export const useRef = value => globalThis.iosHookTest.ref(value);
export const useCallback = (fn, deps) => globalThis.iosHookTest.memo(fn, deps);
export const useEffect = (fn, deps) => globalThis.iosHookTest.effect(fn, deps);
`);
const core = moduleUrl(`export const invoke = (...args) => globalThis.iosHookTest.invoke(...args);`);
const events = moduleUrl(`export const listen = async (name, fn) => { const h = globalThis.iosHookTest; h.listeners.set(name, fn); return () => h.listeners.delete(name); };`);
const source = compile("../../src/features/ios/useIosProbe.ts")
  .replace('"react"', JSON.stringify(react))
  .replace('"@tauri-apps/api/core"', JSON.stringify(core))
  .replace('"@tauri-apps/api/event"', JSON.stringify(events))
  .replace('"./iosSessionEvents"', JSON.stringify(helpers))
  .replace('"../../core/logRetention"', JSON.stringify(retention));
const { useIosProbe } = await import(moduleUrl(source));
const adapter = moduleUrl("export const iosDevice = device => device;");
const deviceSource = compile("../../src/features/devices/useWorkspaceDevices.ts")
  .replace('"react"', JSON.stringify(react))
  .replace('"@tauri-apps/api/core"', JSON.stringify(core))
  .replace('"../../core/workspaceDevice"', JSON.stringify(adapter))
  .replace('"../ios/iosSessionEvents"', JSON.stringify(helpers));
const { useWorkspaceDevices } = await import(moduleUrl(deviceSource));
const appsSource = compile("../../src/features/ios/useIosApplications.ts")
  .replace('"react"', JSON.stringify(react)).replace('"@tauri-apps/api/core"', JSON.stringify(core))
  .replace('"../../core/iosApps"', JSON.stringify(moduleUrl(compile("../../src/core/iosApps.ts"))));
const { useIosApplications, loadIosAppSelections, resolveIosApplication } = await import(moduleUrl(appsSource));
const tick = () => new Promise((resolve) => setImmediate(resolve));
const same = (a, b) => a && a.length === b.length && a.every((value, index) => Object.is(value, b[index]));
const status = (device, session) => ({ sessionId: session, deviceKey: `ios:${device}`, state: "running", error: null, storageError: null, sessionDir: "test", receivedCount: 1, emittedCount: 1, backendDroppedCount: 0, frontendDroppedCount: 0 });
const batch = (device, session, raw) => ({ ...status(device, session), firstSequence: 1, records: [{ raw, level: "notice" }] });

// 无 DOM 的 Hook 调度器；运行真实 Hook，模拟 Tauri 回包/事件的先后顺序。
function harness() {
  const h = {
    slots: [], cursor: 0, effects: [], listeners: new Map(), handlers: {}, invalidated: [],
    state(initial) {
      const i = this.cursor++;
      if (!(i in this.slots)) this.slots[i] = typeof initial === "function" ? initial() : initial;
      return [this.slots[i], (value) => { this.slots[i] = typeof value === "function" ? value(this.slots[i]) : value; }];
    },
    ref(initial) { const i = this.cursor++; return this.slots[i] ??= { current: initial }; },
    memo(fn, deps) {
      const i = this.cursor++;
      if (!same(this.slots[i]?.deps, deps)) this.slots[i] = { deps, value: fn };
      return this.slots[i].value;
    },
    effect(fn, deps) {
      const i = this.cursor++;
      if (!same(this.slots[i]?.deps, deps)) {
        const previous = this.slots[i]; this.slots[i] = { deps };
        this.effects.push(() => { previous?.cleanup?.(); this.slots[i].cleanup = fn(); });
      }
    },
    invoke(name, args) { return Promise.resolve(this.handlers[name]?.(args)); },
    render() {
      globalThis.iosHookTest = this; this.cursor = 0;
      this.value = (this.hook ?? useIosProbe)(this.onUnavailable);
      this.effects.splice(0).forEach((effect) => effect());
      return this.value;
    },
    emit(name, payload) { this.listeners.get(name)?.({ payload }); },
  };
  h.onUnavailable = (key) => h.invalidated.push(key);
  return h;
}

test("启动回包前暂存日志，不让同设备旧会话日志或错误绑定新会话", async () => {
  const h = harness(); h.render(); await tick();
  h.value.setSelectedDevice("one"); h.render();
  let release;
  h.handlers.ios_probe_start_logs = () => new Promise((resolve) => { release = resolve; });
  h.handlers.ios_probe_status = () => status("one", "new");
  const start = h.value.start(); await tick();
  h.emit("ios-probe-logs", batch("one", "old", "old text"));
  h.emit("ios-probe-logs", batch("one", "new", "new text"));
  h.emit("ios-probe-error", { deviceKey: "ios:one", sessionId: "old", error: { kind: "DeviceDisconnected", message: "old error" } });
  release(); await start; h.render();
  assert.deepEqual(h.value.records.map((record) => record.raw), ["new text"]);
  assert.equal(h.value.error, "");
  assert.deepEqual(h.invalidated, []);
  h.emit("ios-probe-error", { deviceKey: "ios:one", sessionId: "new", error: { kind: "DeviceDisconnected", message: "current error" } });
  h.render();
  assert.equal(h.value.error, "current error");
  assert.deepEqual(h.invalidated, ["ios:one"]);
  await tick();
});

test("切换设备后拒绝旧错误、旧 stopped 和异步状态回包", async () => {
  const h = harness(); h.render(); await tick();
  h.value.setSelectedDevice("one"); h.render();
  h.handlers.ios_probe_status = () => status("one", "session-one");
  await h.value.start(); h.render();
  let releaseOld;
  h.handlers.ios_probe_status = () => new Promise((resolve) => { releaseOld = resolve; });
  h.emit("ios-probe-started", { deviceKey: "ios:one", sessionId: "session-one", error: null });
  h.handlers.ios_probe_status = () => ({ ...status("one", "session-one"), state: "idle" });
  await h.value.stop();
  h.value.setSelectedDevice("two"); h.render();
  h.handlers.ios_probe_status = () => status("two", "session-two");
  await h.value.start(); h.render();
  h.emit("ios-probe-error", { deviceKey: "ios:one", sessionId: "session-one", error: { kind: "DeviceDisconnected", message: "old error" } });
  h.emit("ios-probe-stopped", { deviceKey: "ios:one", sessionId: "session-one", error: null });
  releaseOld(status("one", "session-one")); await tick(); h.render();
  assert.equal(h.value.status.deviceKey, "ios:two");
  assert.equal(h.value.status.sessionId, "session-two");
  assert.equal(h.value.error, "");
  assert.deepEqual(h.invalidated, []);
});

test("启动期暂存有界，溢出记入当前会话展示淘汰指标", async () => {
  const h = harness(); h.render(); await tick();
  h.value.setSelectedDevice("one"); h.render();
  let release;
  const reports = [];
  h.handlers.ios_probe_start_logs = () => new Promise((resolve) => { release = resolve; });
  h.handlers.ios_probe_status = () => status("one", "new");
  h.handlers.ios_probe_report_frontend_dropped = (args) => reports.push(args.count);
  const start = h.value.start(); await tick();
  h.emit("ios-probe-logs", { ...batch("one", "new", ""), records: Array.from({ length: 6000 }, (_, index) => ({ raw: String(index) })) });
  release(); await start; h.render();
  assert.equal(h.value.records.length, 5000);
  assert.equal(h.value.records[0].sequence, 1001);
  assert.deepEqual(reports, [1000]);
});

test("正式设备列表断线失效后，迟到刷新不能恢复能力，手动重刷可以恢复", async () => {
  const h = harness(); h.hook = useWorkspaceDevices;
  const online = [{ id: "one", connectionState: "online", state: "online", capabilities: ["syslog"] }];
  h.handlers.ios_probe_list_devices = () => online;
  h.render(); await tick(); h.render();
  let release;
  h.handlers.ios_probe_list_devices = () => new Promise((resolve) => { release = resolve; });
  const refresh = h.value.refreshIos();
  h.value.markIosUnavailable("ios:one");
  release(online); await refresh; h.render();
  assert.equal(h.value.devices[0].connectionState, "unavailable");
  assert.deepEqual(h.value.devices[0].capabilities, []);
  h.handlers.ios_probe_list_devices = () => online;
  await h.value.refreshIos(); h.render();
  assert.equal(h.value.devices[0].connectionState, "online");
});

test("Probe 诊断同样拒绝断线前发起的迟到枚举", async () => {
  const h = harness(); h.render(); await tick();
  const report = { devices: [{ id: "one", connectionState: "online", state: "online", capabilities: ["syslog"] }] };
  h.handlers.ios_probe_doctor = () => report;
  h.handlers.ios_probe_status = () => status("one", "new");
  await h.value.refresh(); h.render();
  await h.value.start(); h.render();
  let release;
  h.handlers.ios_probe_doctor = () => new Promise((resolve) => { release = resolve; });
  const refresh = h.value.refresh();
  h.emit("ios-probe-error", { deviceKey: "ios:one", sessionId: "new", error: { kind: "DeviceDisconnected", message: "disconnected" } });
  release(report); await refresh; await tick(); h.render();
  assert.equal(h.value.doctor.devices[0].connectionState, "unavailable");
  assert.deepEqual(h.value.doctor.devices[0].capabilities, []);
});


test("iOS 稳定采集对齐 Android：保留超过5000条，严格超过105000后批量保留100000，淘汰计数准确", async () => {
  const h = harness(); h.render(); await tick();
  h.value.setSelectedDevice("one"); h.render();
  h.handlers.ios_probe_status = () => status("one", "new");
  const reports = [];
  h.handlers.ios_probe_report_frontend_dropped = ({ count }) => reports.push(count);
  await h.value.start(); h.render();
  const push = (firstSequence, count) => {
    h.emit("ios-probe-logs", { ...batch("one", "new", ""), firstSequence, records: Array.from({ length: count }, (_, i) => ({ raw: i === 0 && firstSequence === 1 ? "[IAA] original" : String(firstSequence + i) })) });
    h.render();
  };
  push(1, 6000);
  assert.equal(h.value.records.length, 6000);
  assert.equal(h.value.records[0].raw, "[IAA] original");
  push(6001, 94000);
  const snapshot = [...h.value.records];
  push(100001, 5000);
  assert.equal(h.value.records.length, 105000);
  assert.deepEqual(reports, []);
  push(105001, 1);
  assert.equal(h.value.records.length, 100000);
  assert.equal(h.value.records[0].sequence, 5002);
  assert.equal(h.value.records.at(-1).sequence, 105001);
  assert.deepEqual(reports, [5001]);
  assert.equal(snapshot[0].raw, "[IAA] original"); // 已固定的快照不受窗口淘汰影响。
  assert.equal(snapshot.length, 100000);
  push(105002, 5001);
  assert.equal(h.value.records.length, 100000);
  assert.equal(h.value.records[0].sequence, 10003);
  assert.deepEqual(reports, [5001, 5001]);
  await h.value.stop();
  await h.value.start(); h.render();
  assert.equal(h.value.records.length, 0);
});


test("应用选择按设备保存，旧回包/旧刷新不串设备，失效映射不退回全部", async () => {
  const storage = new Map([["ios-app-selection-v1", JSON.stringify({ "ios:one": "com.fruit", "ios:two": "com.other", android: "ignored" })]]);
  globalThis.localStorage = { getItem: (key) => storage.get(key) ?? null, setItem: (key,value) => storage.set(key,value) };
  assert.deepEqual(loadIosAppSelections(), { "ios:one": "com.fruit", "ios:two": "com.other" });
  const fruit = { bundleId: "com.fruit", name: "Fruit Quest", executable: "FruitQuest" };
  assert.equal(resolveIosApplication([fruit], "com.fruit").executable, "FruitQuest");
  assert.equal(resolveIosApplication([], "com.fruit").executable, null);
  assert.equal(resolveIosApplication([{ ...fruit, executable: null }], "com.fruit").executable, null);
  assert.equal(resolveIosApplication([fruit,{ ...fruit, bundleId: "duplicate" }], "com.fruit").executable, null);
  const h = harness(); h.deviceKey = "ios:one"; h.locked = false;
  h.hook = () => useIosApplications(h.deviceKey, true, h.locked, [fruit, { ...fruit, bundleId: "com.other" }]);
  const pending = [];
  h.handlers.ios_list_applications = () => new Promise((resolve) => pending.push(resolve));
  h.render(); assert.equal(h.value.canStart, false);
  h.deviceKey = "ios:two"; h.render();
  pending[0]([fruit]); await tick(); h.render();
  assert.equal(h.value.bundleId, "com.other"); assert.ok(h.value.apps.every((app) => app.executable === null));
  const other = { ...fruit, bundleId: "com.other", executable: "Other" };
  pending[1]([other, { name: "Unconfigured installed", bundleId: "com.hidden.installed", executable: "Hidden" }]); await tick(); h.render(); assert.equal(h.value.canStart, true);
  assert.ok(!h.value.apps.some((app) => app.bundleId === "com.hidden.installed"));
  assert.equal(h.value.apps.find((app) => app.bundleId === "com.fruit").installed, false);
  h.value.select(""); h.render(); assert.equal(h.value.bundleId, "");
  assert.equal(JSON.parse(storage.get("ios-app-selection-v1"))["ios:one"], "com.fruit");
  h.locked = true; h.render(); h.value.select("com.other"); h.render(); assert.equal(h.value.bundleId, "");
  h.locked = false; h.render();
  h.value.select("com.other"); h.render();
  const newRefresh = h.value.refresh();
  pending[3]([other]); await newRefresh; h.render();
  pending[2]([]); await tick(); h.render(); assert.equal(h.value.apps.find((app) => app.bundleId === "com.other").executable, "Other");
  h.handlers.ios_list_applications = () => Promise.reject({ message: "locked" });
  await h.value.refresh(); h.render(); assert.equal(h.value.canStart, false); assert.equal(h.value.error, "locked");
  assert.equal(h.value.bundleId, "com.other");
});

test("正式应用启动传精确匹配名，Probe 手动启动继续传前缀，不依赖 PID 查询", async () => {
  const h = harness(); h.render(); await tick(); h.value.setSelectedDevice("one"); h.render();
  const calls = [];
  h.handlers.ios_probe_start_logs = (args) => calls.push(args);
  h.handlers.ios_probe_status = () => status("one", "new");
  await h.value.start({ processFilter: "FruitQuest", exactProcess: true }); h.render();
  assert.equal(calls[0].processFilter, "FruitQuest"); assert.equal(calls[0].exactProcess, true);
  assert.equal(h.value.processFilter, "FruitQuest");
  await h.value.stop(); h.value.setProcessFilter("Fruit"); h.render();
  await h.value.start();
  assert.equal(calls[1].processFilter, "Fruit"); assert.equal(calls[1].exactProcess, false);
});

test('主动停止接收队列尾批，响应后迟到批不复活运行态、不回退计数，新会话仍隔离', async () => {
  const h = harness(); h.render(); await tick();
  h.value.setSelectedDevice('one'); h.render();
  h.handlers.ios_probe_status = () => status('one', 'first');
  await h.value.start(); h.render();
  h.emit('ios-probe-logs', batch('one', 'first', 'first record'));
  let release;
  h.handlers.ios_probe_stop_logs = () => new Promise(resolve => { release = resolve; });
  h.handlers.ios_probe_status = () => ({ ...status('one', 'first'), state: 'idle', receivedCount: 3, emittedCount: 3 });
  const stop = h.value.stop(); await tick();
  h.emit('ios-probe-logs', { ...batch('one', 'first', 'tail during stop'), firstSequence: 2, receivedCount: 2, emittedCount: 2 });
  release(); await stop; h.render();
  assert.equal(h.value.status.state, 'idle');
  h.emit('ios-probe-logs', { ...batch('one', 'first', 'tail after response'), firstSequence: 3, receivedCount: 2, emittedCount: 3 });
  h.render();
  assert.deepEqual(h.value.records.map(r => r.raw), ['first record', 'tail during stop', 'tail after response']);
  assert.deepEqual(h.value.records.map(r => r.sequence), [1, 2, 3]);
  assert.equal(h.value.status.state, 'idle'); assert.equal(h.value.status.receivedCount, 3);
  h.handlers.ios_probe_start_logs = () => {};
  h.handlers.ios_probe_status = () => status('one', 'second');
  await h.value.start(); h.render();
  h.emit('ios-probe-logs', batch('one', 'first', 'stale'));
  h.emit('ios-probe-logs', batch('two', 'second', 'other device'));
  h.emit('ios-probe-logs', batch('one', 'second', 'new session'));
  h.render();
  assert.deepEqual(h.value.records.map(r => r.raw), ['new session']);
  assert.equal(h.value.status.sessionId, 'second'); assert.equal(h.value.status.receivedCount, 1);
});

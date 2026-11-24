import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import ts from "typescript";

const source = readFileSync(new URL("../../src/features/ios/iosSessionEvents.ts", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext } }).outputText;
const { matchesIosSession, markIosDeviceUnavailable } = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString("base64")}`);

test("拒绝其他设备、同设备旧会话及尚未绑定的迟到事件", () => {
  const event = { deviceKey: "ios:one", sessionId: "old" };
  assert.equal(matchesIosSession(event, "two", "old"), false);
  assert.equal(matchesIosSession(event, "one", "new"), false);
  assert.equal(matchesIosSession(event, "one", null), false);
  assert.equal(matchesIosSession(event, "one", "old"), true);
});

test("断线只失效目标设备，原始快照及其他设备不变", () => {
  const devices = ["one", "two"].map((id) => ({ id, state: "online", connectionState: "online", trustState: "trusted", locked: false, capabilities: ["syslog"] }));
  const updated = markIosDeviceUnavailable(devices, "ios:one");
  assert.equal(updated[0].connectionState, "unavailable");
  assert.deepEqual(updated[0].capabilities, []);
  assert.equal(updated[0].trustState, "trusted");
  assert.equal(updated[1], devices[1]);
  assert.equal(devices[0].connectionState, "online");
});

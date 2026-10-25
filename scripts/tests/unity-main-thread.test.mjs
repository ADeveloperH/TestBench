import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

// 编译真实规则、注册表和 Logcat 解析器，沿用现有测试方式，不新增依赖。
const require = createRequire(import.meta.url);
const { build } = createRequire(require.resolve("vite"))("esbuild");
const root = fileURLToPath(new URL("../../", import.meta.url));
const bundle = await build({
  stdin: {
    contents: 'export { BUILTIN_TEST_CASES, caseAppliesTo, ruleMatches } from "./src/features/testcases/engine"; export { applyCaseConfig, emptyCaseConfig } from "./src/features/testcases/caseConfig"; export { applyBuiltins, getCodeBuiltins, getBuiltinTestCases, isBuiltinTestCase, resetBuiltinsToCode } from "./src/core/builtinRegistry"; export { LongLogParser } from "./src/core/logcat";',
    resolveDir: root,
  },
  bundle: true, write: false, format: "esm", platform: "node",
});
const model = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`);
const remote = JSON.parse(readFileSync(new URL("../../config/remote-config.json", import.meta.url), "utf8"));
const caseId = "unity_main_thread_violation";
const sources = [
  ["代码兜底", model.BUILTIN_TEST_CASES],
  ["远程配置", remote.testCases],
];
const cases = sources.map(([name, definitions]) => {
  const matches = definitions.filter((tc) => tc.id === caseId);
  assert.equal(matches.length, 1, `${name}应有且仅有一个线程异常内置用例`);
  return matches[0];
});
const caughtError = "UnityDispatcherTool执行任务出错：get_realtimeSinceStartup can only be called from the main thread.";
const entry = (message, overrides = {}) => ({
  id: 1, date: "10-23", time: "20:32:08.904", pid: "28012", tid: "28012",
  level: "E", tag: "Unity", message, raw: message, ...overrides,
});
const matches = (tc, log) => tc.rules.some((rule) => model.ruleMatches(rule, log));
function parseLogs(raw) {
  const parser = new model.LongLogParser();
  const entries = raw.split(/\r?\n/).flatMap((line) => parser.pushLine(line));
  const last = parser.flush();
  if (last) entries.push(last);
  return entries.map((log, id) => ({ ...log, id }));
}

test("代码兜底和远程配置内置定义一致，均为默认启用的一次命中错误监控", () => {
  assert.deepEqual(cases[0], cases[1]);
  for (const tc of cases) {
    assert.equal(tc.enabled, true);
    assert.equal(tc.group, "广告");
    assert.equal(tc.rules.length, 1);
    assert.equal(tc.rules[0].effect, "error");
    assert.equal(tc.rules[0].minCount ?? 1, 1);
    assert.equal(tc.rules[0].absence, undefined);
    assert.notEqual(tc.requirePass, true, "未出现异常时应保持监控中");
  }
});

test("所有已配置项目及未来新增项目都适用，不受广告分组应用排除项影响", () => {
  for (const tc of cases) {
    assert.deepEqual(tc.scope, { global: true, apps: [] });
    for (const pkg of [...remote.apps.map((app) => app.package), "com.fruit.slicerush", "com.example.futureproject"]) {
      assert.equal(model.caseAppliesTo(tc, pkg), true, pkg);
    }
    const configured = model.applyCaseConfig([tc], model.emptyCaseConfig(), false);
    assert.equal(configured[0].enabled, true, "现有项目加载新内置用例后应默认启用");
  }
});

test("代码与远程配置加载后都以当前注册表识别为内置用例", () => {
  const code = model.getCodeBuiltins();
  try {
    model.resetBuiltinsToCode();
    assert.equal(model.isBuiltinTestCase(caseId), true);
    model.applyBuiltins({ ...code, testCases: remote.testCases });
    assert.equal(model.isBuiltinTestCase(caseId), true);
    assert.deepEqual(model.getBuiltinTestCases().find((tc) => tc.id === caseId), cases[1]);
  } finally {
    model.resetBuiltinsToCode();
  }
});

test("捕获或未捕获的线程异常均命中，不限定 API、日志级别或广告模块", () => {
  const messages = [
    caughtError,
    "UnityException: get_realtimeSinceStartup can only be called from the main thread.",
    "get_isActiveAndEnabled can only be called from the main thread.",
    "[H5] get_internetReachability can only be called from the main thread.",
    "GET_NAME CAN ONLY BE CALLED FROM THE MAIN THREAD.",
  ];
  for (const tc of cases) {
    for (const message of messages) {
      for (const level of ["E", "W", "I"]) {
        assert.equal(matches(tc, entry(message, { level })), true, `${level}: ${message}`);
      }
    }
  }
});

test("正常广告日志、线程诊断和其他错误不会误报为此线程异常", () => {
  const messages = [
    "ActivityAdClosed utcMs:1790000000000 thread:48",
    "UnityDispatcherTool Android Looper drain 排空队列，任务数: 1",
    "UnityDispatcherTool 主线程任务执行完成",
    "[IAA] 刚刚关闭插屏/激励广告，本次不展示热启动广告",
    "[IAA] ShowRewardAd isWebInvoked:True",
    "UnityDispatcherTool执行任务出错：广告加载超时",
    "run on the main thread",
  ];
  for (const tc of cases) {
    for (const message of messages) assert.equal(matches(tc, entry(message)), false, message);
    assert.equal(matches(tc, entry(caughtError, { tag: "OtherTag" })), false);
  }
});

test("真实格式的多行广告关闭异常可被识别，命中记录保留完整原始堆栈", () => {
  const raw = [
    "[ 10-23 20:32:08.904 28012:28012 E/Unity    ]",
    caughtError,
    "Constructors and field initializers will be executed from the loading thread when loading a scene.",
    "Don't use this function in the constructor or field initializers, instead move initialization code to the Awake or Start function.",
    "  at AD.Runtime.BaseSplashAdHandler+<>c__DisplayClass3_0.<ShowSplashAd>b__0 (System.String s, System.Boolean b) [0x00000] in <00000000000000000000000000000000>:0",
    "  at AD.Runtime.UnityDispatcherTool.ExecuteTaskSafely (System.Action task) [0x00000] in <00000000000000000000000000000000>:0",
    "  at AD.Runtime.UnityDispatcherTool.ExecutePendingMainThreadTasks (System.String source) [0x00000] in <00000000000000000000000000000000>:0",
    "  at AD.Runtime.UnityDispatcherTool.OnAndroidDrain () [0x00000] in <00000000000000000000000000000000>:0",
    "  at UnityEngine.AndroidJavaRunnableProxy.Invoke (System.String methodName, System.IntPtr javaArgs) [0x00000] in <00000000000000000000000000000000>:0",
    "",
  ].join("\n");
  const logs = parseLogs(raw);
  assert.equal(logs.length, 1);
  assert.equal(logs[0].raw, raw.trimEnd());
  assert.equal(logs[0].tid, "28012");
  assert.ok(logs[0].message.includes("BaseSplashAdHandler"));
  assert.ok(logs[0].message.includes("OnAndroidDrain"));
  assert.ok(logs[0].message.includes("AndroidJavaRunnableProxy.Invoke"));
  for (const tc of cases) assert.equal(matches(tc, logs[0]), true);
});

test("多次异常保留独立命中记录，正常关闭日志不匹配", () => {
  const logs = parseLogs([
    "[ 10-23 20:32:08.904 28012:28012 E/Unity ]",
    caughtError,
    "",
    "[ 10-23 20:32:09.000 28012:28012 I/Unity ]",
    "ActivityAdClosed utcMs:1790000000000 thread:48",
    "",
    "[ 10-23 20:32:10.000 28012:28134 E/Unity ]",
    "get_name can only be called from the main thread.",
    "",
  ].join("\n"));
  for (const tc of cases) {
    const hits = logs.filter((log) => matches(tc, log));
    assert.deepEqual(hits.map((log) => log.id), [0, 2]);
    assert.deepEqual(hits.map((log) => log.time), ["20:32:08.904", "20:32:10.000"]);
  }
});

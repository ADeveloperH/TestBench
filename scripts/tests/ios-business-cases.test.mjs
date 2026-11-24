import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
const require = createRequire(import.meta.url);
const { build } = createRequire(require.resolve('vite'))('esbuild');
const contents = `export * from './src/features/ios/iosBusinessCases'; export * from './src/features/ios/iosPilotMonitoring'; export * from './src/features/ios/iosPilotCases'; export {IOS_PILOT_IS_FIXTURE} from './src/features/ios/iosPilotTarget';`;
async function load(enabled, target = '') {
  const bundle = await build({ stdin: { contents, resolveDir: fileURLToPath(new URL('../../', import.meta.url)) }, bundle: true, write: false, format: 'esm', platform: 'node',
    define: { 'import.meta.env.VITE_ENABLE_IOS_BUSINESS_CANDIDATES': JSON.stringify(enabled), 'import.meta.env.VITE_IOS_PILOT_TARGET': JSON.stringify(target) } });
  return import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`);
}
const [m, defaultBuild] = await Promise.all([load('true'), load('false')]);
const ids = ['ios_network_error', 'ios_ie_network_fail', 'ios_ie_level_fail', 'ios_unity_main_thread_violation'];
const status = { deviceKey: 'ios:one', sessionId: 'capture', state: 'running', backendDroppedCount: 0, storageError: null };
const tab = { id: 'test', kind: 'test', testBundleId: m.IOS_PILOT_BUNDLE, testRun: { sessionId: 'capture', afterSequence: 0, key: 'round' } };
// 以下都是受控构造记录，不是 Fruit 真机异常日志，不注入真实采集会话。
const record = (sequence, message, patch = {}) => ({ sequence, sessionId: 'capture', timestamp: 'Nov 16 17:00:00', process: 'FruitQuest', module: 'UnityFramework', pid: 123, level: 'notice', encodingStatus: 'valid', semanticLevel: null, truncated: false, message, raw: `controlled:${message}`, ...patch });
function evaluate(rows, implementation = m) {
  const runtime = implementation.createIosPilotRuntime(tab, 'ios:one');
  implementation.advanceIosPilot(runtime, rows, status);
  return { runtime, results: implementation.iosPilotResults(runtime), result: id => implementation.iosPilotResults(runtime).find(r => r.testCase.id === id) };
}

const maxToponId = 'ios_ie_max_topon_validation';
const uaAdjustId = 'ios_ie_ua_adjust_event';
const adjustRevenueId = 'ios_ie_adjust_revenue_fail';
const crashId = 'ios_no_crash';
const maxShow = '🔗 [track] ad_show {"mediation":"max","source":"DirectSDK"}';
const toponDedup = '🔗 TopOn 收入因 GreenGame 去重标记丢弃（placement=fixture） —— 该位由 MAX 层回传收入，属预期行为';
const adjustSent = '🔗 已转发 Adjust 事件 fixture123（callback params 2 个）';

test('iOS 崩溃只消费本轮关联的 Apple 报告，并按 incident 去重', () => {
  for (const implementation of [m, defaultBuild]) {
    const crashStatus = { ...status, state: 'running' };
    const crashTab = { ...tab, testRun: { ...tab.testRun, startedAt: 1000 } };
    const runtime = implementation.createIosPilotRuntime(crashTab, 'ios:one');
    const report = { incidentId: 'fixture-incident', capturedAt: 1200, pid: 123,
      process: implementation.IOS_PILOT_PROCESS, bundleId: implementation.IOS_PILOT_BUNDLE };
    const outcome = () => implementation.iosPilotResults(runtime).find(r => r.testCase.id === crashId);

    assert.equal(implementation.advanceIosCrashReports(runtime, [report], { ...crashStatus, state: 'error' }), false);
    assert.equal(implementation.advanceIosCrashReports(runtime, [report], { ...crashStatus, state: 'idle' }), false);
    assert.equal(implementation.advanceIosCrashReports(runtime, [report], { ...crashStatus, deviceKey: 'ios:two' }), false);
    assert.equal(implementation.advanceIosCrashReports(runtime, [report], { ...crashStatus, sessionId: 'old' }), false);
    assert.equal(implementation.advanceIosCrashReports(runtime, [{ ...report, capturedAt: 999 }, { ...report, bundleId: 'other' },
      { ...report, process: 'Other' }], crashStatus), false);
    implementation.advanceIosPilot(runtime, [record(1, 'Apple .ips · EXC_CRASH / SIGABRT')], crashStatus);
    assert.equal(outcome().status, 'pending');

    assert.equal(implementation.advanceIosCrashReports(runtime, [report, report], crashStatus), true);
    assert.equal(implementation.advanceIosCrashReports(runtime, [report], crashStatus), false);
    assert.equal(outcome().status, 'fail');
    assert.equal(outcome().ruleHits[0].totalCount, 1);
    assert.match(outcome().ruleHits[0].entries[0].raw, /Incident ID fixture-incident/);
  }
});

test('MAX 包 TopOn 两条真机日志格式均命中才通过，并保留两条原文', () => {
  const show = record(1, maxShow + '（本 key「ad_show」报满 8 次，后续静默）');
  const dedup = record(2, '[Ad] ' + toponDedup, { module: 'Foundation' });
  for (const implementation of [defaultBuild, m]) {
    assert.equal(evaluate([show], implementation).result(maxToponId).status, 'pending');
    assert.equal(evaluate([record(1, toponDedup)], implementation).result(maxToponId).status, 'pending');
    const result = evaluate([show, dedup], implementation).result(maxToponId);
    assert.equal(result.status, 'pass');
    assert.deepEqual(result.ruleHits.map(hit => hit.entries[0].raw), [show.raw, dedup.raw]);
  }
});

test('MAX 包 TopOn 仅接受完整展示 JSON 的顶层字段和同轮的真实去重信号', () => {
  for (const message of [
    '🔗 [track] network_info {"mediation":"max","source":"DirectSDK"}',
    '🔗 [track] ad_show {"mediation":"max","info":{"source":"DirectSDK"}}',
    '🔗 [track] ad_show {"mediation":"max","source":"Other","info":"DirectSDK"}',
    '🔗 [track] ad_show {"mediation":"topon","source":"DirectSDK"}',
    '🔗 [track] ad_show {"mediation":"max","source":"DirectSDK",',
    '🔗 [track] ad_show {"mediation":"max","source":"DirectSDK","source":"Other"}',
    'unrelated\n' + maxShow,
  ]) {
    const result = evaluate([record(1, message), record(2, toponDedup)], defaultBuild).result(maxToponId);
    assert.equal(result.status, 'pending', message);
    assert.deepEqual(result.ruleHits.map(hit => hit.totalCount), [0, 1], message);
  }
  for (const patch of [{ truncated: true }, { process: 'Other' }, { sessionId: 'old' }, { module: 'Foundation' }]) {
    assert.equal(evaluate([record(1, maxShow, patch), record(2, toponDedup)]).result(maxToponId).status, 'pending');
  }
  assert.equal(evaluate([record(1, maxShow), record(2, toponDedup, { sessionId: 'old' })]).result(maxToponId).status, 'pending');
});

test('UA 埋点监控只接受 Adjust SDK 调用完成日志，未观察到时显示疑似', () => {
  for (const implementation of [defaultBuild, m]) {
    for (const [module, message] of [['Foundation', '[Promotion] ' + adjustSent], ['UnityFramework', adjustSent]]) {
      const source = record(1, message, { module });
      const result = evaluate([source], implementation).result(uaAdjustId);
      assert.equal(result.status, 'pass');
      assert.equal(result.ruleHits[0].entries[0].raw, source.raw);
    }
    for (const message of [
      '[Analytics] 🔗 已转交 Adjust 事件 fixture（token fixture123，callback params 2 个）',
      '[Promotion] 🔗 Adjust 后端已收讫事件 fixture123（累计 1 条）',
      '[Other] ' + adjustSent,
      '[Promotion] 🔗 已转发 Adjust 事件 <private>（callback params 2 个）',
      '[Promotion] normal\n' + adjustSent,
    ]) {
      assert.equal(evaluate([record(1, message, { module: 'Foundation' })], implementation).result(uaAdjustId).status, 'suspected');
    }
    assert.equal(evaluate([record(1, adjustSent, { truncated: true })], implementation).result(uaAdjustId).status, 'suspected');
  }
});

test('Adjust 广告收入用例等待同轮两路 SDK 调用，同轮明确丢弃优先判为有问题', () => {
  const max = record(1, '[Promotion] 🔗 已上报广告收入 source applovin_max_sdk 1.5e-7 USD（network fixture，unit max）', { module: 'Foundation' });
  const topon = record(2, '🔗 已上报广告收入 source topon_sdk 0.25 EUR（network fixture，unit topon）（本 key 报满 3 次，后续静默）');
  const dropped = record(3, '[Promotion] 🔗 Adjust 未就绪 ⇒ 收入未上报（source topon_sdk，0.25 EUR）', { module: 'Foundation' });
  for (const impl of [defaultBuild, m]) {
    assert.equal(evaluate([max], impl).result(adjustRevenueId).status, 'pending');
    assert.equal(evaluate([max, { ...topon, sessionId: 'old' }], impl).result(adjustRevenueId).status, 'pending');
    const passed = evaluate([max, topon], impl).result(adjustRevenueId);
    assert.equal(passed.status, 'pass');
    assert.equal(passed.ruleHits[1].entries[0].raw, topon.raw);
    assert.equal(evaluate([max, topon, dropped], impl).result(adjustRevenueId).status, 'fail');
  }
});

test('Adjust 广告收入仅接收授权来源的明确丢弃和完整调用证据', () => {
  const alert = '⚠️ [Promotion] ADJAdRevenue 创建失败（source applovin_max_sdk）⇒ 本次广告收入未上报';
  const overflow = '[Ad] ⚠️ Adjust 收入缓存超过 5000 条，已丢弃最旧一条';
  for (const [message, module, expected] of [
    [alert, 'UnityFramework', 'fail'],
    [overflow, 'Foundation', 'fail'],
    ['[Other] ' + alert, 'Foundation', 'pending'],
    ['[Promotion] ' + alert, 'UIKitCore', 'pending'],
    ['[Ad] 🔗 TopOn 收入因 GreenGame 去重标记丢弃（placement=fixture） —— 该位由 MAX 层回传收入，属预期行为', 'Foundation', 'pending'],
    ['[Promotion] 🔗 Adjust 尚未就绪，本次先入队', 'Foundation', 'pending'],
    ['🔗 [track] adjust_revenue_bak {"mediation":"max"}', 'UnityFramework', 'pending'],
    ['[Promotion] 🔗 Adjust 后端已收讫事件 fixture（累计 1 条）', 'Foundation', 'pending'],
  ]) {
    const result = evaluate([record(1, message, { module })], defaultBuild).result(adjustRevenueId);
    assert.equal(result.status, expected, message);
    if (expected === 'pending') assert.ok(result.ruleHits.every(hit => !hit.hit));
  }
  assert.equal(evaluate([record(1, alert, { truncated: true })], defaultBuild).result(adjustRevenueId).status, 'pending');
});

test('固定fixture绑定需要双重显式开关，普通构建仍只认Fruit，不能任意传入其他Bundle/进程', async () => {
  const [fixture, disabled, unknown] = await Promise.all([load('true', 'fixture'), load('false', 'fixture'), load('true', 'other')]);
  assert.equal(fixture.IOS_PILOT_IS_FIXTURE, true);
  for (const implementation of [m, defaultBuild, disabled, unknown]) {
    assert.equal(implementation.IOS_PILOT_BUNDLE, 'com.lucky.fruit.quest.master');
    assert.equal(implementation.IOS_PILOT_PROCESS, 'FruitQuest');
  }
  const scope = { processFilter: fixture.IOS_PILOT_PROCESS, exactProcess: true };
  assert.equal(fixture.canStartIosPilot(fixture.IOS_PILOT_BUNDLE, fixture.IOS_PILOT_PROCESS, scope, status, 'ios:one', false), true);
  assert.equal(fixture.canStartIosPilot(m.IOS_PILOT_BUNDLE, 'FruitQuest', scope, status, 'ios:one', false), false);
  const fixtureTab = { ...tab, testBundleId: fixture.IOS_PILOT_BUNDLE };
  const runtime = fixture.createIosPilotRuntime(fixtureTab, 'ios:one');
  assert.equal(m.createIosPilotRuntime(fixtureTab, 'ios:one'), null);
  fixture.advanceIosPilot(runtime, [record(1, '[NetworkManager]: 请求失败: controlled', { process: fixture.IOS_PILOT_PROCESS })], status);
  const result = fixture.iosPilotResults(runtime).find(r => r.testCase.id === 'ios_ie_network_fail');
  assert.equal(result.status, 'suspected');
  assert.equal(result.ruleHits[0].entries[0].record.process, 'TestBenchIOSBusinessFixture');
  assert.ok(fixture.IOS_PILOT_CASES.every(tc => tc.scope.apps[0] === 'com.testbench.iosbusinessfixture'));
});

const ordinaryCases = [
  ['ios_ie_task_fail', '[DailyLevelMilestoneManager]: DailyLevelMilestoneFlow 领取请求异常：档位=fixture，领取方式=0，原因=fixture', 'fail',
    '找不到 TaskItem prefab', 'fail'],
  ['ios_ie_cheating', '[NetworkManager]: result code 600,cheating user', 'suspected',
    '[NetworkManager]: 请求失败: /fixture, Code: 503, Msg: cheating user', 'suspected'],
  ['ios_ie_withdraw_fail', '[Withdraw]: 提现失败, errorCode: 503, msg: fixture', 'suspected',
    '[Other]: 提现请求异常: fixture', 'fail'],
  ['ios_ie_localization_fail', '[LocalizationUtils]: Unable to load additional Localization data: fixture', 'fail'],
  ['ios_ie_ui_fail', 'RewardToast: coinText组件为空!', 'fail', '[RewardToastManager]: RewardToast组件为空!', 'fail'],
  ['ios_ie_save_fail', '[SaveManagerHelper]: Failed to delete fixture.txt: fixture', 'suspected',
    '[SomeOtherManager]: Failed to delete fixture.txt', 'suspected'],
  ['ios_ie_task_warn', '[TaskCenterConfig]: [Server] 接口返回失败 configKey=fixture, resultCode=503', 'suspected',
    '[TaskCenterConfig]: [Server] 接口未返回对应配置 configKey=fixture, resultCode=200', 'suspected'],
  ['ios_plugin_promotion_fail', 'PromotionManager GetPromotionChannel not init', 'suspected'],
  ['ios_plugin_analytics_fail', '[IOSAnalytics] 未接入 iOSAnalyticsLibrary', 'fail',
    '[Analytics][bridge] 未接入 iOSAnalyticsLibrary', 'fail'],
  ['ios_sdk_beyla_data_fail', '[Analytics] 📤 ❌ 事件落库失败：fixture', 'suspected'],
  ['ios_anticheat_runtime_fail', '[AntiCheating] 🔗 同步取值返回非 0 code=6001（fixture）', 'fail'],
  ['ios_ie_anticheat_fail', 'AntiCheatingManager InitSDK params invalid', 'fail'],
  ['ios_ie_ad_ecpm_fail', 'NetWorkLog:Request Post /merge/coin/report/ecpm/match/pos\n{"ecpm":0}', 'fail',
    'NetWorkLog:Request Post /merge/coin/user/info JsonParams: {"ecpm":0}', 'fail'],
  ['ios_network_error', 'NetWorkLog:Response Status:200\n{"result_code":503}', 'fail'],
  ['ios_ie_network_fail', '[NetworkManager]: 请求失败: /controlled', 'suspected'],
  ['ios_ie_level_fail', '[LevelUpHandler]: 升级流程异常: controlled', 'fail'],
  ['ios_ie_ad_fail', '广告日志: InitAdStrategy invalid, no mediation configured', 'fail',
    '广告日志: ADCoreManager LoadReward failed. Max is not init.', 'suspected'],
  ['ios_ie_reward_fallback', '[LevelUpReward]: 翻倍广告播放失败，发放当前奖励', 'suspected'],
  ['ios_ie_reward_fail', '[LevelUpReward]: 获取升级奖励失败: controlled', 'fail'],
  ['ios_unity_main_thread_violation', 'UnityEngine.UnityException: Find can only be called from the main thread.', 'fail',
    'Engine diagnostic guide: an API can only be called from the main thread', 'fail'],
  ['ios_ie_sdk_init', '所有SDK初始化完成', 'pass'],
  ['ios_ie_userinfo_fail', '[UserDataManager]: UserDataManager 初始化成功', 'pass', '[UserDataManager] 用户信息拉取失败: controlled', 'suspected'],
  ['ios_ie_prop_fail', '道具数据初始化完成', 'pass', '道具数据初始化异常', 'suspected'],
  ['ios_anticheat_init', '[AntiCheating] 设备指纹就绪（长度 28）', 'pass', '[AntiCheating][probe] iOS bridge is_linked = False', 'fail'],
  ['ios_ie_config_missing', '[IncentiveEngineManager]: [Config] levelConfig 未配置，关卡配置功能将不可用', 'suspected',
    '[IncentiveEngineManager]: [Config] iaaConfig 未配置，广告功能将不可用', 'suspected'],
  ['ios_ie_cloud_config_fail', '[IOSCloudConfig] AddBizKVChangedListener 尚未实现，已降级返回默认值。若业务依赖该能力，请补齐 iOSConfigLibrary 的实现与 C ABI。', 'suspected',
    '[IOSCloudConfig] GetBizConfigs 尚未实现，已降级返回默认值。', 'suspected'],
  ['ios_ie_analytics_fail', 'Beyla 埋点未初始化，埋点无效', 'fail', '[FirebaseAnalyticsTracker] Failed to log event', 'fail'],
];

test('普通构建启用已验证分支及两条试点，内部构建保留全部候选，Android 内置身份独立', () => {
  assert.equal(defaultBuild.IOS_BUSINESS_CANDIDATES_ENABLED, false);
  assert.equal(defaultBuild.IOS_DEFAULT_BUSINESS_CASE_COUNT, 31);
  const rows = [record(1, 'NetWorkLog:Request JsonParams: {"ecpm":0}'), record(2, 'can only be called from the main thread')];
  const { results } = evaluate(rows, defaultBuild);
  assert.deepEqual(results.slice(0, 2).map(r => r.status), ['pending', 'pending']);
  const candidates = results.slice(2);
  assert.deepEqual(candidates.filter(r => r.status === 'pending').map(r => r.testCase.id).sort(), [...ordinaryCases.map(([id]) => id), maxToponId, adjustRevenueId, crashId].sort());
  assert.equal(candidates.find(r => r.testCase.id === 'ios_ie_ua_adjust_event').status, 'suspected');
  const disabled = candidates.filter(r => r.status === 'disabled');
  assert.equal(disabled.length, 1);
  assert.ok(disabled.every(r => r.ruleHits.every(hit => hit.totalCount === 0 && hit.entries.length === 0)));
  assert.equal(m.IOS_PILOT_CASES.length, 34);
  assert.ok(m.IOS_PILOT_CASES.every(tc => tc.enabled !== false));
  const builtins = JSON.parse(readFileSync(new URL('../../config/remote-config.json', import.meta.url))).testCases;
  assert.equal(builtins.length, 47);
  const iosIds = new Set(results.map(r => r.testCase.id));
  assert.ok(builtins.every(tc => !iosIds.has(tc.id)));
});

for (const [id, message, expected, excluded, internalStatus] of ordinaryCases) {
  test(`普通构建仅执行已验证分支 ${id}`, () => {
    const modules = id === 'ios_anticheat_init' ? ['Foundation', 'UnityFramework'] : ['UnityFramework'];
    for (const module of modules) {
      const row = record(1, message, { module });
      const result = evaluate([row], defaultBuild).result(id);
      assert.equal(result.status, expected);
      assert.equal(result.ruleHits.reduce((count, hit) => count + hit.totalCount, 0), 1);
      assert.equal(result.ruleHits.flatMap(hit => hit.entries)[0].raw, row.raw);
      assert.equal(evaluate([row]).result(id).status, expected);
    }
    if (excluded) {
      const row = record(1, excluded);
      assert.equal(evaluate([row], defaultBuild).result(id).status, 'pending');
      assert.equal(evaluate([row]).result(id).status, internalStatus);
    }
  });
}

test('普通构建保留网络和关卡故障的不同严重度，正常响应及配置回退无命中', () => {
  for (const [id, message, expected] of [
    ['ios_network_error', 'NetWorkLog:Response Status:200\n{"result_code":200}', 'pending'],
    ['ios_ie_network_fail', '[NetworkManager]: 请求异常: controlled', 'fail'],
    ['ios_ie_network_fail', '[NetworkManager]: NetworkManager未初始化', 'fail'],
    ['ios_ie_level_fail', '[LevelConfigManager]: 服务端关卡配置请求异常，使用本地配置: controlled', 'fail'],
    ['ios_ie_level_fail', '[LevelConfigManager]: 服务端关卡配置加载失败，使用本地配置: controlled', 'pending'],
  ]) {
    assert.equal(evaluate([record(1, message)], defaultBuild).result(id).status, expected);
    assert.equal(evaluate([record(1, message, {module:'Foundation'})], defaultBuild).result(id).status, 'pending');
  }
});

test('普通构建任务与资源只读取已验诊断，旧任务分支与 Android Splash 路径不参与', () => {
  for (const [id, message, expected] of [
    ['ios_ie_ui_fail', '[UIManager]: Popup prefab not found in Resources folder: fixture', 'fail'],
    ['ios_ie_ui_fail', '[UIManager]: Failed to load popup: Fixture from path: fixture', 'fail'],
    ['ios_ie_ui_fail', '[FloatingTreasureBoxManager]: 宝箱预制体未设置', 'fail'],
    ['ios_ie_ui_fail', 'ToastManager instance not found!', 'fail'],
    ['ios_ie_ui_fail', '[PaymentInputPanel]: 支付方式 fixture 需要 2 个输入字段，但 prefab 只绑定了 1 个槽位', 'fail'],
    ['ios_ie_save_fail', '[RewardLogger]: 写入文件失败: IO', 'fail'],
    ['ios_ie_save_fail', '[SaveManagerHelper]: Error deleting all game data: IO', 'fail'],
    ['ios_ie_save_fail', '[SaveManagerHelper]: Error deleting directory fixture: IO', 'fail'],
    ['ios_ie_save_fail', '[FileOperator]: Error:[fixture] -- Can Not Find File : fixture', 'fail'],
    ['ios_ie_save_fail', '[SaveManagerHelper]: Deleted file: fixture', 'pending'],
    ['ios_ie_task_warn', '[TaskCenterConfig]: [Server] 配置请求结束 configKey=fixture, loadFailed=False', 'pending'],
    ['ios_ie_task_warn', '其他正文\n[TaskCenterConfig]: [Server] 接口返回失败 configKey=fixture', 'pending'],
    ['ios_ie_task_warn', '任务列表拉取失败', 'pending'],
    ['ios_ie_task_fail', '找不到 TaskItem prefab', 'pending'],
    ['ios_ie_runtime_fail', '[IncentiveEngineManager]: 意外错误: fixture', 'disabled'],
  ]) {
    assert.equal(evaluate([record(1, message)], defaultBuild).result(id).status, expected);
    const unrelated = evaluate([record(1, message, {module:'Foundation'})], defaultBuild).result(id);
    assert.equal(unrelated.status, expected === 'disabled' ? 'disabled' : 'pending');
  }
});

test('iOS 里程碑仅在 UnityFramework 首行识别领取请求异常', () => {
 const id = 'ios_ie_task_fail';
 const prefix = '[DailyLevelMilestoneManager]: DailyLevelMilestoneFlow ';
 const failure = prefix + '领取请求异常：档位=fixture，领取方式=0，原因=fixture';
 const source = record(1, failure + '\nDailyLevelMilestoneManager:ClaimAsync()');
 const result = evaluate([source], defaultBuild).result(id);
 assert.equal(result.status, 'fail');
 assert.equal(result.ruleHits[0].entries[0].raw, source.raw);
 for (const message of [
  prefix + '领取成功：档位=fixture，领取方式=0，金币=7',
  prefix + '领取失败：档位=fixture，领取方式=0，错误码=17',
  'MILESTONE_NOT_CLAIMABLE',
  '[Other]: DailyLevelMilestoneFlow 领取请求异常：fixture',
  '[DailyLevelMilestoneManager]: OtherFlow 领取请求异常：fixture',
  '正常正文\n' + failure,
 ]) assert.equal(evaluate([record(1, message)], defaultBuild).result(id).status, 'pending');
 assert.equal(evaluate([record(1, failure, {module:'Foundation'})], defaultBuild).result(id).status, 'pending');
});

test('普通构建账号业务区分 600 拦截、档位重试和提现提交失败', () => {
 const withdrawId = 'ios_ie_withdraw_fail';
 for (const [message, expected, rule] of [
  ['[UserDataManager]: 提现档位拉取失败: fixture', 'suspected', 0],
  ['[UserDataManager]: 提现档位拉取异常: fixture', 'suspected', 0],
  ['[UserDataManager]: 提现档位拉取失败，已达最大重试次数', 'fail', 1],
  ['[Withdraw]: 提现失败, errorCode: 503, msg: fixture', 'suspected', 2],
  ['[Withdraw]: 提现请求异常: fixture', 'fail', 3],
 ]) {
  const result = evaluate([record(1, message)], defaultBuild).result(withdrawId);
  assert.equal(result.status, expected);
  assert.deepEqual(result.ruleHits.flatMap((hit, index) => hit.hit ? [index] : []), [rule]);
  assert.equal(evaluate([record(1, message, {module:'Foundation'})], defaultBuild).result(withdrawId).status, 'pending');
 }
 const rows = [
  record(1, '[UserDataManager]: 提现档位拉取成功，共 1 个档位'),
  record(2, '[Withdraw]: 提现提交成功'),
  record(3, '[Other]: result code 600,cheating user'),
  record(4, '[NetworkManager]: result code 600,cheating user example'),
  record(5, 'normal\n[Withdraw]: 提现请求异常: fixture'),
 ];
 const evaluated = evaluate(rows, defaultBuild);
 for (const id of [withdrawId, 'ios_ie_cheating']) assert.equal(evaluated.result(id).status, 'pending');
 assert.equal(evaluate([record(1, '[NetworkManager]: result code 600,cheating user', {module:'Foundation'})], defaultBuild).result('ios_ie_cheating').status, 'pending');
});

test('普通构建要求 UnityFramework 首行包含明确的 Unity 主线程异常', () => {
  const id = 'ios_unity_main_thread_violation';
  const exception = 'UnityException: get_transform CAN ONLY BE CALLED FROM THE MAIN THREAD';
  assert.equal(evaluate([record(1, `[Feature]: caught ${exception}\nUnityEngine.Component.get_transform()`)], defaultBuild).result(id).status, 'fail');
  for (const row of [
    record(1, `Normal message\n${exception}`),
    record(1, 'UnityException:\nFind can only be called from the main thread'),
    record(1, 'UnityException: Address is invalid\nFind can only be called from the main thread'),
    record(1, exception, { module: 'Foundation' }),
    record(1, exception, { process: 'Other' }),
  ]) assert.equal(evaluate([row], defaultBuild).result(id).status, 'pending');
});

test('SDK初始化的60秒缺失判定仍只在内部构建执行', () => {
  const sdk = implementation => implementation.IOS_PILOT_CASES.find(tc => tc.id === 'ios_ie_sdk_init');
  assert.ok(defaultBuild.IOS_PILOT_CASES.every(tc => !tc.enabled || tc.rules.every(rule => !rule.absence)));
  assert.equal(sdk(m).rules.find(rule => rule.absence).absence.withinSec, 60);
});

test('共享候选分支保留Android正文条件树和error/warn语义', () => {
  const builtins = JSON.parse(readFileSync(new URL('../../config/remote-config.json', import.meta.url))).testCases;
  function messageTree(expr) {
    if (expr.kind === 'cond') {
      if (expr.cond.field === 'tag' && expr.cond.op === 'equals' && expr.cond.value === 'Unity') return null;
      assert.equal(expr.cond.field, 'message'); return expr;
    }
    const children = expr.children.map(messageTree).filter(Boolean);
    return children.length === 1 ? children[0] : { ...expr, children };
  }
  const cases = m.iosBusinessCases(m.IOS_PILOT_BUNDLE).slice(0, 18);
  assert.equal(new Set(cases.map(c => c.id)).size, 18);
  for (const tc of cases) {
    const original = builtins.find(c => `ios_${c.id}` === tc.id);
    assert.ok(original); assert.equal(tc.enabled, true);
    assert.deepEqual(tc.scope, { global: false, apps: [m.IOS_PILOT_BUNDLE] });
    const iosTaskCases = ['ios_ie_task_warn', 'ios_ie_task_fail'];
    const sharedRules = iosTaskCases.includes(tc.id) ? tc.rules.slice(0, original.rules.length) : tc.rules;
    assert.deepEqual(sharedRules.map(r => ({ effect: r.effect, expr: messageTree(r.expr), absence: r.absence ? { ...r.absence, anchor: messageTree(r.absence.anchor) } : undefined })), original.rules.map(r => ({ effect: r.effect, expr: messageTree(r.expr), absence: r.absence ? { ...r.absence, anchor: messageTree(r.absence.anchor) } : undefined })));
    assert.deepEqual(sharedRules.map(r => r.minCount), original.rules.map(r => r.minCount));
  }
});

for (const [code, expected] of [[200, 'pending'], [201, 'fail'], [500, 'fail'], [-1, 'fail'], [0, 'fail'], [2000, 'fail']]) {
  test(`网络响应result_code=${code}按业务值判断，notice不参与级别映射`, () => {
    const message = `NetWorkLog:Response Post /controlled Status:200 Success:True\n{\n "result_code" : ${code}, "data": {}\n}`;
    const { result } = evaluate([record(1, message)]);
    assert.equal(result('ios_network_error').status, expected);
  });
}

test('缺少响应标记、无业务结果码、相似字段或只有HTTP失败不误判为业务响应异常', () => {
  const rows = ['NetWorkLog:Request {"result_code":500}', 'NetWorkLog:Response Status:500', 'NetWorkLog:Response {"other_result_code":500}', 'NetWorkLog:Response {"result_code":"500"}', '[IAA] result_code:500'];
  const { results } = evaluate(rows.map((text, i) => record(i + 1, text)));
  assert.ok(results.filter(r => ids.includes(r.testCase.id)).every(r => r.status === 'pending'));
});

for (const [text, expected, rule] of [
  ['[NetworkManager]: 请求失败: /controlled, Code: 500', 'suspected', 0],
  ['[NetworkManager]: 请求异常: /controlled, Error: controlled', 'fail', 1],
  ['[NetworkManager]: NetworkManager未初始化', 'fail', 2],
]) {
  test(`框架网络分支：${expected}/${rule}，保留原始证据且不伪造级别`, () => {
    const source = record(1, text); const { result } = evaluate([source]); const actual = result('ios_ie_network_fail');
    assert.equal(actual.status, expected); assert.equal(actual.ruleHits[rule].totalCount, 1);
    const evidence = actual.ruleHits[rule].entries[0];
    assert.equal(evidence.record, source); assert.equal(evidence.raw, source.raw); assert.equal(evidence.level, undefined); assert.equal(evidence.tag, undefined);
  });
}

test('业务失败与异常区分，重试成功不抹除已观察到的warn，error优先', () => {
  const first = record(1, '[NetworkManager]: 请求失败: controlled');
  const second = record(2, '[NetworkManager]: 请求成功: controlled');
  const { runtime } = evaluate([first, second]);
  assert.equal(m.iosPilotResults(runtime).find(r => r.testCase.id === 'ios_ie_network_fail').status, 'suspected');
  m.advanceIosPilot(runtime, [record(3, '[NetworkManager]: 请求异常: controlled')], status);
  assert.equal(m.iosPilotResults(runtime).find(r => r.testCase.id === 'ios_ie_network_fail').status, 'fail');
});

for (const text of ['[LevelConfigManager]: 服务端关卡配置请求异常，使用本地配置: controlled', '[LevelUpHandler]: 升级流程异常: controlled']) {
  test(`关卡异常OR分支保留：${text.split(':')[0]}`, () => {
    assert.equal(evaluate([record(1, text)]).result('ios_ie_level_fail').status, 'fail');
  });
}

test('正常通关、关卡配置降级warning、网络周期检查和其他模块失败不触发四项候选', () => {
  const rows = ['[LevelFlow] step=on_game_win_invoked, run=3', '[LevelConfigManager]: 服务端关卡配置加载失败，使用本地配置: controlled', '[LevelUpHandler]: 升级流程正在处理中，忽略重复调用。', '[NetworkManager]: Periodic network check', '[Other]: 请求失败: controlled', '[Other]: 请求异常: controlled', 'Unity main thread running normally'];
  const { results } = evaluate(rows.map((text, i) => record(i + 1, text)));
  assert.ok(results.filter(r => ids.includes(r.testCase.id)).every(r => r.status === 'pending'));
  assert.equal(results[0].status, 'pass');
});

test('捕获后打印和多行线程异常一次即失败，大小写不影响；与广告模块无关', () => {
  const { result } = evaluate([record(1, '[Feature]: caught UnityException: get_transform CAN ONLY BE CALLED FROM THE MAIN THREAD\nUnityEngine.Component.get_transform()')]);
  const actual = result('ios_unity_main_thread_violation');
  assert.equal(actual.status, 'fail'); assert.equal(actual.ruleHits[0].totalCount, 1);
});

test('四项异常同样隔离进程、来源模块、设备、采集会话和开始边界', () => {
  const runtime = m.createIosPilotRuntime({ ...tab, testRun: { ...tab.testRun, afterSequence: 1 } }, 'ios:one');
  const text = '[NetworkManager]: 请求异常: controlled';
  m.advanceIosPilot(runtime, [record(2, text)], { ...status, deviceKey: 'ios:two' });
  m.advanceIosPilot(runtime, [record(1, text), record(2, text, { module: 'UIKitCore' }), record(3, text, { process: 'Other' }), record(4, text, { sessionId: 'old' })], status);
  assert.ok(m.iosPilotResults(runtime).filter(r => ids.includes(r.testCase.id)).every(r => r.status === 'pending'));
  const real = record(5, text); m.advanceIosPilot(runtime, [real], status); m.advanceIosPilot(runtime, [real], status);
  const actual = m.iosPilotResults(runtime).find(r => r.testCase.id === 'ios_ie_network_fail');
  assert.equal(actual.status, 'fail'); assert.equal(actual.ruleHits[1].totalCount, 1);
});

test('MacRoman中文还原后能命中网络失败，原始乱码和来源仍保留', () => {
  const map = 'ÄÅÇÉÑÖÜáàâäãåçéèêëíìîïñóòôöõúùûü†°¢£§•¶ß®©™´¨≠ÆØ∞±≤≥¥µ∂∑∏π∫ªºΩæø¿¡¬√ƒ≈∆«»… ÀÃÕŒœ–—“”‘’÷◊ÿŸ⁄€‹›ﬁﬂ‡·‚„‰ÂÊÁËÈÍÎÏÌÓÔÒÚÛÙıˆ˜¯˘˙˚¸˝˛ˇ';
  const text = '[NetworkManager]: 请求失败: controlled';
  const broken = [...new TextEncoder().encode(text)].map(b => b < 128 ? String.fromCharCode(b) : [...map][b - 128]).join('');
  const source = record(1, broken, { encodingStatus: 'suspected_mojibake' });
  const actual = evaluate([source]).result('ios_ie_network_fail');
  assert.equal(actual.status, 'suspected'); assert.equal(actual.ruleHits[0].entries[0].message, text);
  assert.equal(actual.ruleHits[0].entries[0].raw, source.raw);
});

import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
const require = createRequire(import.meta.url);
const { build } = createRequire(require.resolve("vite"))("esbuild");
const bundle = await build({ stdin: { contents: `export * from './src/core/iosApps'; export * from './src/core/logView'; export * from './src/features/logcat/logViewAdapter'; export * from './src/features/ios/iosLogViewAdapter'; export * from './src/features/ios/iosFilterPreferences'; export * from './src/features/settings/config'; export * from './src/core/builtinRegistry';`, resolveDir: fileURLToPath(new URL('../../', import.meta.url)) }, bundle: true, write: false, format: 'esm', platform: 'node' });
const m = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`);
const ios = (sequence, raw = 'Fixture[12] <Notice> Hello\nUnity Error') => ({ sessionId: 'session', sequence, timestamp: 'Nov 10 12:00:00', device: 'phone', process: 'Fixture', pid: null, module: null, level: 'notice', semanticLevel: null, semanticLevelSource: null, encodingStatus: 'valid', truncated: false, message: 'Hello', raw });
const view = (patch = {}) => ({ search: '', regex: false, activeFilterId: '', level: '', semantic: '', follow: true, snapshot: null, selected: null, clearedThrough: -1, ...patch });

test('MacRoman 样本还原中文和堆栈，保留原文及原始编码状态', () => {
  const message = '[InLevelAdRewardManager]: [InLevelAdReward] Á¨¨28ÂÖ≥ ËøõÂ∫¶Êõ¥Êñ∞Ôºö16.67%\nIncentiveEngine.InLevelAdRewardManager:UpdateProgress(Single, Nullable`1)';
  const record = Object.freeze({ ...ios(1), message, raw: `Nov 13 17:12:27 FruitQuest[2099] <Notice>: ${message}`, encodingStatus: 'suspected_mojibake' });
  const row = m.projectIosLog(record, 'phone', 'session');
  assert.equal(row.message, '[InLevelAdRewardManager]: [InLevelAdReward] 第28关 进度更新：16.67%\nIncentiveEngine.InLevelAdRewardManager:UpdateProgress(Single, Nullable`1)');
  assert.equal(row.encodingRecovered, true);
  assert.equal(row.original, record); assert.equal(row.raw, record.raw);
  assert.equal(row.encodingStatus, 'suspected_mojibake'); assert.equal(record.message, message);
  for (const query of ['第28关', '进度更新', 'Á¨¨28', '[InLevelAdRewardManager]']) {
    assert.deepEqual(m.selectIosRecords([record], view({ search: query })).records, [record]);
  }
  assert.equal(m.selectIosRecords([record], view({ search: '^\\[InLevelAdRewardManager\\].*第28关', regex: true })).records.length, 1);
  assert.equal(m.selectIosRecords([record], view({ search: '第28关', level: 'error' })).records.length, 0);
  assert.equal(m.selectIosRecords([record], view({ markers: '进度更新' })).records.length, 1);
  assert.equal(m.selectIosRecords([record], view({ markers: '!进度更新' })).records.length, 0);
  assert.equal(m.selectIosRecords([record], view({ markers: '!Á¨¨28' })).records.length, 0);
});

test('正常中文、外文、非法 UTF-8、替换符不强转；逐行还原且不依赖启发式标记', () => {
  for (const message of ['第28关 进度更新：16.67% 😀', 'café français ÄÖÜ', 'Á¨', 'broken � Á¨¨28ÂÖ≥', '<private>', 'ASCII frame()']) {
    const row = m.projectIosLog({ ...ios(1), message }, 'phone', 'session');
    assert.equal(row.message, message); assert.equal(row.encodingRecovered, false);
  }
  const row = m.projectIosLog({ ...ios(1), message: '正常中文 😀\nÁ¨¨28ÂÖ≥\r\nframe()' }, 'phone', 'session');
  assert.equal(row.message, '正常中文 😀\n第28关\r\nframe()');
  assert.equal(row.encodingRecovered, true);
  const encodeWrong = (value) => new TextDecoder('macintosh').decode(new TextEncoder().encode(value));
  for (const expected of ['中文标点：宝箱开（50%）；进度更新！', '第28关 😀 中文']) {
    const message = encodeWrong(expected);
    assert.equal(m.projectIosLog({ ...ios(1), message }, 'phone', 'session').message, expected);
  }
});

test('平台投影保留原文与来源、级别，不伪造 Android 字段', () => {
  const record = Object.freeze(ios(1));
  const projected = m.projectIosLog(record, 'ios:one', 'session');
  assert.equal(projected.original, record);
  assert.equal(projected.raw, record.raw);
  assert.equal(projected.pid, null); assert.equal(projected.tid, null); assert.equal(projected.tag, null);
  assert.equal(projected.rawLevel, 'notice'); assert.equal(projected.semanticLevel, null);
  const android = { id: 12, date: '11-10', time: '12:00:00', pid: '0012', tid: '13', tag: 'Unity', level: 'E', message: 'Stack\nframe', raw: 'original' };
  const a = m.projectAndroidLog(android, 'android:one', 'session');
  assert.equal(a.original, android); assert.equal(a.pid, '0012'); assert.equal(a.rawLevel, 'E'); assert.equal(a.message, android.message);
  assert.equal(m.LOG_VIEW_CAPABILITIES.ios.tagFilter, false);
  assert.ok(!m.LOG_VIEW_COLUMNS.ios.some((col) => col.id === 'tid' || col.id === 'tag'));
});

test('稳定行身份不随过滤重排改变，设备/会话隔离且缺少 sequence 不碰撞', () => {
  const record = ios(1);
  assert.equal(m.projectIosLog(record, 'ios:a', 'session').key, m.projectIosLog({ ...record }, 'ios:a', 'session').key);
  assert.notEqual(m.projectIosLog(record, 'ios:a', 'session').key, m.projectIosLog(record, 'ios:b', 'session').key);
  assert.notEqual(m.projectIosLog(record, 'ios:a', 'session').key, m.projectIosLog({ ...record, sessionId: 'new' }, 'ios:a', 'new').key);
  const legacy = { ...record, sequence: undefined };
  assert.equal(m.projectIosLog(legacy, 'ios:a', 'session').key, m.projectIosLog(legacy, 'ios:a', 'session').key);
  assert.notEqual(m.projectIosLog(legacy, 'ios:a', 'session').key, m.projectIosLog({ ...legacy }, 'ios:a', 'session').key);
});

test('原文文字/正则搜索、非法正则、原始与推断级别分别过滤', () => {
  const records = [ios(1), { ...ios(2, '<private>'), semanticLevel: 'error', semanticLevelSource: 'unity_heuristic', level: 'error' }];
  assert.equal(m.selectIosLogs(records, view({ search: 'fixture' })).records.length, 1);
  assert.equal(m.selectIosLogs(records, view({ search: 'hello\\s+unity', regex: true })).records.length, 1);
  assert.equal(m.selectIosLogs(records, view({ search: '[', regex: true })).records.length, 0);
  assert.ok(m.selectIosLogs(records, view({ search: '[', regex: true })).error);
  assert.equal(m.selectIosLogs(records, view({ level: 'notice', semantic: 'error' })).records.length, 0);
  assert.equal(m.selectIosLogs(records, view({ level: 'notice', semantic: 'unknown' })).records.length, 1);
  assert.equal(m.selectIosLogs(records, view({ search: '<private>' })).records[0].raw, '<private>');
});

test('过滤和当前 Tab 导出投影遵循暂停快照与清空边界，不改变源记录', () => {
  const snapshot = [ios(1), ios(2)]; const live = [...snapshot, ios(3)];
  const selected = m.selectIosLogs(live, view({ snapshot, clearedThrough: 1 }));
  assert.deepEqual(selected.records, [snapshot[1]]);
  assert.equal(selected.records.map((r) => r.raw).join('\n'), snapshot[1].raw);
  assert.equal(live.length, 3); assert.equal(snapshot.length, 2);
});

test('version 2 旧配置缺省 iOS 域，新增域独立往返且合并修复同 ID 冲突', () => {
  const old = m.parseImportConfig(JSON.stringify({ version: 2, prefs: { searchHistory: ['android'] }, savedFilters: [] }));
  assert.deepEqual(old.prefs.iosLog, m.emptyIosFilterPreferences());
  const filter = (id, search) => ({ id, name: search, filters: { search, regex: true, level: 'notice', semantic: '' } });
  const localPrefs = { ...old.prefs, iosLog: { history: ['ios'], favorites: [{ value: 'x', description: 'local' }], savedFilters: [filter('same', 'one')] } };
  const local = m.buildExportConfig(localPrefs, [], []);
  const incoming = m.parseImportConfig(JSON.stringify({ ...old, prefs: { ...old.prefs, iosLog: { history: ['incoming'], favorites: [{ value: 'x', description: 'remote' }], savedFilters: [filter('same', 'two')] } } }));
  const merged = m.mergeConfig(local, incoming);
  assert.equal(merged.version, 2);
  assert.deepEqual(merged.prefs.searchHistory, ['android']);
  assert.deepEqual(merged.prefs.iosLog.history, ['ios', 'incoming']);
  assert.equal(merged.prefs.searchFavorites.find((f) => f.value === 'x').description, 'local');
  assert.deepEqual(merged.prefs.iosLog.favorites, []);
  assert.equal(new Set(merged.prefs.iosLog.savedFilters.map((f) => f.id)).size, 2);
  assert.deepEqual(m.parseImportConfig(JSON.stringify(merged)).prefs.iosLog, merged.prefs.iosLog);
  const duplicate = m.mergeConfig(merged, incoming);
  assert.equal(duplicate.prefs.iosLog.savedFilters.length, 2);
});

test('损坏 iOS 配置字段被归一化，不引入 Android 条件', () => {
  assert.deepEqual(m.normalizeIosFilterPreferences({ history: ['x', 1, 'x'], favorites: [null], savedFilters: [null] }), { blocking: { webkitActivities: true, audioCompletion: true, uiBackgroundTasks: true }, customApps: [], removedBuiltinApps: [], markerHistory: [], markerFavorites: [], history: ['x'], favorites: [], savedFilters: [] });
  const result = m.normalizeIosFilterPreferences({ savedFilters: [{ id: 'one', name: 'one', filters: { tags: 'Android', pid: '12', app: 'package', search: 'ios', regex: 'yes', semantic: 'notice' } }] });
  assert.deepEqual(result.savedFilters[0].filters, { markers: '', search: 'ios', regex: false, level: '', semantic: '' });
});


test('iOS 业务标记按正文作字面包含/排除，与全文及两类级别 AND，原文不变', () => {
  const records = [
    { ...ios(1, 'raw A'), message: '[LevelFlow] hello', semanticLevel: 'error' },
    { ...ios(2, 'raw B'), message: '[LevelFlow] noisy' },
    { ...ios(3, 'raw C'), message: '[Other] hello', level: 'error' },
  ];
  assert.deepEqual(m.selectIosLogs(records, view({ markers: '[levelflow], [other], !noisy' })).records.map(r => r.sequence), [1, 3]);
  assert.deepEqual(m.selectIosLogs(records, view({ markers: '[LevelFlow]', semantic: 'error', level: 'notice', search: 'raw A' })).records, [records[0]]);
  assert.equal(m.selectIosLogs(records, view({ markers: 'FruitQuest' })).records.length, 0);
  assert.equal(m.createIosMarkerFilter('[')('[LevelFlow]'), true); // 业务标记不采用正则。
  assert.equal(m.createIosMarkerFilter('!noisy， ! ')('hello'), true);
  assert.equal(records[0].raw, 'raw A');
});

test('标记收藏/历史与命名筛选兼容旧配置、独立合并并通过 version 2 导入导出', () => {
  const a = m.normalizeIosFilterPreferences({ history: ['search'], markerHistory: ['[A]', '[A]', 12], markerFavorites: [{ value: '[A]', description: 'local' }], savedFilters: [{ id: 'id', name: 'A', filters: { markers: '[A],!noise', level: 'notice', semantic: 'unknown' } }] });
  const b = m.mergeIosFilterPreferences(a, { markerHistory: ['[B]'], markerFavorites: [{ value: '[A]', description: 'incoming' }], savedFilters: [{ id: 'id', name: 'B', filters: { markers: '[B]' } }] });
  assert.deepEqual(b.history, ['search']);
  assert.deepEqual(b.markerHistory, ['[A]', '[B]']);
  assert.equal(b.markerFavorites[0].description, 'local');
  assert.equal(new Set(b.savedFilters.map(f => f.id)).size, 2);
  const config = m.buildExportConfig({ iosLog: b }, [], []);
  assert.deepEqual(m.parseImportConfig(JSON.stringify(config)).prefs.iosLog, { ...b, favorites: [] });
  assert.equal(m.iosFilterValues({ search: 'legacy' }).markers, '');
});


test('iOS 配置应用独立于手机清单，旧配置兼容，导入按 Bundle ID 本地优先', () => {
  const old = m.normalizeIosFilterPreferences({});
  assert.deepEqual(old.customApps, []);
  const local = m.normalizeIosFilterPreferences({ customApps: [{ name: 'Local', bundleId: 'com.local.game' }, { name: 'bad', bundleId: 'bad id' }], removedBuiltinApps: ['com.hidden.game'] });
  const merged = m.mergeIosFilterPreferences(local, { customApps: [{ name: 'Imported', bundleId: 'com.local.game' }, { name: 'New', bundleId: 'com.new.game' }] });
  assert.deepEqual(merged.customApps.map(app => app.name), ['Local', 'New']);
  const config = m.buildExportConfig({ iosLog: merged }, [], []);
  assert.deepEqual(m.parseImportConfig(JSON.stringify(config)).prefs.iosLog.customApps, merged.customApps);
});


test('iOS 配置清单内置保护与调试删除名单，不复用 Android 包名', () => {
  const id = 'com.lucky.fruit.quest.master';
  const custom = [{ name: 'User', bundleId: 'com.user.game' }, { name: 'Cannot override', bundleId: id }];
  assert.deepEqual(m.configuredIosApps(custom, [id], false).map(app => app.bundleId), [id, 'com.user.game']);
  assert.equal(m.configuredIosApps(custom, [], false)[0].name, 'Fruit Quest');
  assert.deepEqual(m.configuredIosApps([], [id], true), []);
  assert.equal(m.validIosBundleId('com.user.game'), true);
  assert.equal(m.validIosBundleId('not a bundle'), false);
});

test('iOS 仅屏蔽两项精确框架消息，其他模块/级别/业务及异常内容保留', () => {
  const blocking = m.emptyIosFilterPreferences().blocking;
  const make = (sequence, module, message, patch = {}) => Object.freeze({ ...ios(sequence), module, message, raw: `raw:${message}`, ...patch });
  const start = "0x13800bf40 - [PID=2155, throttler=0x13801cc80] ProcessThrottler::Activity::Activity: Starting foreground activity / 'WebPageProxy::runJavaScriptInFrameInScriptWorld'";
  const end = start.replace('Activity: Starting', 'invalidate: Ending');
  const audio = "   SSClientCompletion.cpp:33    Calling client's completion block now: clientPID = 2099, actionID = 4097";
  const hidden = [make(1, 'WebKit', start), make(2, 'WebKit', end), make(3, 'AudioToolbox', audio)];
  const retained = [make(4, 'UnityFramework', start), make(5, 'WebKit', start, { level: 'error' }), make(6, 'WebKit', start, { level: 'warning' }), make(7, 'WebKit', start + '\nFailure details'), make(8, 'WebKit', 'WebProcessProxy::didChangeThrottleState: type=1'), make(9, 'AudioToolbox', audio + ' failed'), make(10, 'UIKitCore', audio), make(11, 'WebKit', start.replace('foreground', 'background')), make(12, 'UnityFramework', '[IAA] business log')];
  const input = [...hidden, ...retained];
  const selected = m.selectIosRecords(input, view(), blocking);
  assert.deepEqual(selected.records, retained); assert.equal(selected.blockedCount, 3); assert.deepEqual(selected.source, input);
  assert.deepEqual(m.selectIosRecords(input, view({ showBlockedLogs: true }), blocking).records, input);
  assert.deepEqual(m.selectIosRecords(input, view()).records, input); // Probe 不传屏蔽配置。
  assert.equal(m.selectIosRecords(input, view(), { ...blocking, webkitActivities: false }).blockedCount, 1);
  assert.equal(m.selectIosRecords(input, view(), { ...blocking, audioCompletion: false }).blockedCount, 2);
  assert.deepEqual(m.selectIosRecords(input, view(), { webkitActivities: false, audioCompletion: false }).records, input);
  assert.equal(m.selectIosRecords(input, view({ snapshot: hidden, clearedThrough: 1 }), blocking).blockedCount, 2);
  assert.equal(m.selectIosRecords(input, view({ search: 'ProcessThrottler' }), blocking).records.includes(hidden[0]), false);
  assert.equal(hidden[0].raw, `raw:${start}`);
});

test('iOS 屏蔽开关兼容旧配置、持久化导入导出，合并保留本地选择', () => {
  assert.deepEqual(m.normalizeIosFilterPreferences({}).blocking, { webkitActivities: true, audioCompletion: true, uiBackgroundTasks: true });
  assert.deepEqual(m.normalizeIosFilterPreferences({ blocking: { webkitActivities: false, audioCompletion: 'bad' } }).blocking, { webkitActivities: false, audioCompletion: true, uiBackgroundTasks: true });
  const prefs = { ...m.parseImportConfig(JSON.stringify({ version: 2 })).prefs, iosLog: m.normalizeIosFilterPreferences({ blocking: { webkitActivities: false, audioCompletion: false } }) };
  const exported = m.buildExportConfig(prefs, [], []);
  assert.deepEqual(m.parseImportConfig(JSON.stringify(exported)).prefs.iosLog.blocking, prefs.iosLog.blocking);
  assert.deepEqual(m.mergeIosFilterPreferences(prefs.iosLog, { blocking: { webkitActivities: true } }).blocking, prefs.iosLog.blocking);
});

test('UIKit 后台任务仅屏蔽已核对的 11 种常规状态，保留故障及其他模块/级别', () => {
  const messages = [
    'Will add backgroundTask with taskName: <private>, expirationHandler: <__NSMallocBlock__: 0x130f1be80>',
    'Incrementing reference count for background assertion <private>',
    'Created background task <private>.',
    'Ending background task with UIBackgroundTaskIdentifier: 71',
    'Ending task with identifier 71 and description: <private>, _expireHandler: <__NSMallocBlock__: 0x12d6edb80>',
    'Decrementing reference count for assertion <private> (used by background task with identifier 71: <private>)',
    'Creating new assertion because there is no existing background assertion.',
    'Creating new background assertion',
    'Created new background assertion <BKSProcessAssertion: 0x166681860>',
    'Will invalidate assertion: <BKSProcessAssertion: 0x166681860> for task identifier: 71',
    'Reusing background assertion <BKSProcessAssertion: 0x166681860>',
  ];
  const records = messages.map((message, i) => Object.freeze({ ...ios(i + 1), module: 'UIKitCore', message, raw: `raw:${message}` }));
  const blocking = m.emptyIosFilterPreferences().blocking;
  assert.equal(m.selectIosRecords(records, view(), blocking).blockedCount, 11);
  assert.equal(m.selectIosRecords(records, view(), blocking).records.length, 0);
  assert.deepEqual(m.selectIosRecords(records, view({ showBlockedLogs: true }), blocking).records, records);
  assert.deepEqual(m.selectIosRecords(records, view(), { ...blocking, uiBackgroundTasks: false }).records, records);
  const keep = [
    ...records.map(r => ({ ...r, level: 'error' })), ...records.map(r => ({ ...r, level: 'warning' })),
    ...records.map(r => ({ ...r, module: 'UnityFramework' })), ...records.map(r => ({ ...r, message: r.message + '\nfailed: diagnostic' })),
    { ...ios(100), module: 'UIKitCore', message: 'Background task expired: application may be terminated' },
    { ...ios(101), module: 'Network', message: 'nw_connection reporting state failed' },
    { ...ios(102), module: 'UIKitCore', message: 'Sending UIEvent type: 0; subtype: 0; to windows: 1' },
  ];
  assert.deepEqual(m.selectIosRecords(keep, view(), blocking).records, keep);
  assert.equal(m.selectIosRecords(records, view({ snapshot: records.slice(0, 3), clearedThrough: 1 }), blocking).blockedCount, 2);
  const old = m.normalizeIosFilterPreferences({ blocking: { webkitActivities: false, audioCompletion: false } });
  assert.deepEqual(old.blocking, { webkitActivities: false, audioCompletion: false, uiBackgroundTasks: true });
  const prefs = { ...m.parseImportConfig(JSON.stringify({ version: 2 })).prefs, iosLog: { ...old, blocking: { ...old.blocking, uiBackgroundTasks: false } } };
  const exported = m.buildExportConfig(prefs, [], []);
  assert.equal(m.parseImportConfig(JSON.stringify(exported)).prefs.iosLog.blocking.uiBackgroundTasks, false);
  assert.equal(m.mergeIosFilterPreferences(prefs.iosLog, {}).blocking.uiBackgroundTasks, false);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
const require = createRequire(import.meta.url);
const { build } = createRequire(require.resolve('vite'))('esbuild');
const url = (source) => `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;
const compiled = await build({ stdin: { contents: `export * from './src/core/logView'; export * from './src/features/logcat/logFind'; export * from './src/features/logcat/logColumnWidths'; export * from './src/features/logcat/logShortcuts'; export * from './src/features/logcat/logViewAdapter'; export * from './src/features/ios/iosLogViewAdapter';`, resolveDir: fileURLToPath(new URL('../../', import.meta.url)) }, bundle: true, write: false, format: 'esm', platform: 'node' });
const modelUrl = url(compiled.outputFiles[0].text);
const m = await import(modelUrl);
const rawIos = (sequence, message = 'needle\nframe needle') => ({ sequence, sessionId: 'one', timestamp: 'Nov 12 12:00:00', device: 'phone', process: 'NeedleGame', pid: null, module: null, level: 'notice', semanticLevel: 'error', semanticLevelSource: 'unity_heuristic', encodingStatus: 'valid', truncated: false, message, raw: `original:${message}` });
const row = (sequence, message) => m.projectIosLog(rawIos(sequence, message), 'ios:a', 'one');

test('高频投影缓存复用不可变旧行，堆栈合并替换对象后刷新内容且保持行键', () => {
  const project = m.cacheLogProjection((record) => m.projectIosLog(record, 'ios:a', 'one'));
  const source = rawIos(1);
  const initial = project(source);
  assert.equal(project(source), initial);
  const merged = project({ ...source, message: `${source.message}\nnew frame`, raw: 'merged raw' });
  assert.notEqual(merged, initial); assert.equal(merged.key, initial.key); assert.equal(merged.raw, 'merged raw');
  assert.equal(initial.raw, source.raw);
});

test('共享查找的计数/高亮范围一致，覆盖多行、大小写、正则与零宽匹配', () => {
  const rows = [row(1), row(2, 'different')];
  const index = m.buildFindIndex(rows, 'needle', false, false, ['message', 'process']);
  assert.equal(index.total, 4); // 第一条正文两次+进程一次，第二条进程一次。
  assert.equal(index.byId.get(rows[0].key).fields.message.start, 0);
  assert.equal(index.byId.get(rows[0].key).fields.process.start, 2);
  assert.deepEqual(m.findTextRanges(rows[0].message, 'needle', false, false), [{ from: 0, to: 6 }, { from: 13, to: 19 }]);
  assert.equal(m.buildFindIndex(rows, 'needle', true, false, ['process']).total, 0);
  assert.equal(m.buildFindIndex(rows, 'needle\\s+frame', false, true, ['message']).total, 1);
  assert.equal(m.buildFindIndex(rows, '[', false, true, ['message']).valid, false);
  assert.deepEqual(m.findTextRanges('abc', '(?=.)', false, true), []);
  assert.deepEqual(m.findTextRanges('a', 'a|$', false, true), [{ from: 0, to: 1 }]);
});

test('查找定位使用稳定行键，重排后仍定位原记录，淘汰后不误跳旧下标', () => {
  const rows = [row(1, 'needle'), row(2, 'other')];
  const index = m.buildFindIndex(rows, 'needle', false, false, ['message']);
  assert.equal(m.liveOccurrenceIndex([...rows].reverse(), index, 0), 1);
  assert.equal(m.liveOccurrenceIndex([rows[1]], index, 0), -1);
  assert.equal(m.liveOccurrenceIndex([m.projectIosLog(rawIos(1), 'ios:b', 'one')], index, 0), -1);
  assert.equal(m.rowOfOccurrence(index, 1), null);
});

test('Android 查找保留正文先于 Tag 的匹配顺序，数字 ID 和原文不变', () => {
  const original = { id: 7, date: '11-12', time: '12:00:00', pid: '008', tid: '9', level: 'E', tag: 'needle', message: 'needle stack\nframe', raw: 'original' };
  const record = m.projectAndroidLog(original, 'android:x', 'session');
  const index = m.buildFindIndex([record], 'needle', false, false, ['message', 'tag']);
  assert.equal(index.total, 2); assert.equal(index.rows[0].fields.tag.start, 1);
  assert.equal(record.original.id, 7); assert.equal(record.original.raw, 'original');
  assert.equal(m.logViewCell(record, 'tid'), '9');
});

test('Android 列宽旧键/迁移保持兼容，iOS 单独存储且双击重置值可持久化', () => {
  const store = new Map([['log-col-widths-v1', JSON.stringify({ time: 132, tag: 333, pid: 1 })]]);
  const storage = { getItem: (key) => store.get(key) ?? null, setItem: (key, value) => store.set(key, value) };
  const android = m.loadLogColumnWidths('android', storage);
  assert.equal(android.timestamp, 150); assert.equal(android.tag, 333); assert.equal(android.pid, 44);
  const ios = m.loadLogColumnWidths('ios', storage); ios.process = 275;
  m.saveLogColumnWidths('ios', ios, storage);
  assert.equal(m.loadLogColumnWidths('ios', storage).process, 275);
  assert.equal(JSON.parse(store.get('log-col-widths-v1')).tag, 333);
  ios.process = m.logColumnSize('process', 'ios')[0]; m.saveLogColumnWidths('ios', ios, storage);
  assert.equal(m.loadLogColumnWidths('ios', storage).process, 180);
  store.set('ios-log-col-widths-v1', '{broken'); assert.equal(m.loadLogColumnWidths('ios', storage).process, 180);
});

test('iOS 不伪造字段，原始 notice 与推断 error 分列着色', () => {
  const record = row(1);
  assert.equal(m.logViewCell(record, 'pid'), '—'); assert.equal(m.logViewCell(record, 'tid'), '—');
  assert.equal(m.logViewCell(record, 'level'), 'notice'); assert.equal(m.logViewCell(record, 'semanticLevel'), 'error');
  assert.notEqual(m.logLevelColor('ios', record.rawLevel), m.semanticLevelColor(record.semanticLevel));
});

const hookSource = ts.transpileModule(readFileSync(new URL('../../src/features/logcat/useLogWorkspaceShortcuts.ts', import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.ESNext } }).outputText;
const reactUrl = url(`export const useRef = value => globalThis.shortcutHarness.ref ??= { current: value }; export const useEffect = fn => { const h = globalThis.shortcutHarness; if (!h.mounted) { h.mounted = true; h.cleanup = fn(); } };`);
const { useLogWorkspaceShortcuts } = await import(url(hookSource.replace('"react"', JSON.stringify(reactUrl)).replace('"./logShortcuts"', JSON.stringify(modelUrl))));

const actionsSource = ts.transpileModule(readFileSync(new URL('../../src/features/ios/useIosWorkspaceActions.ts', import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.ESNext } }).outputText;
const actionsReact = url('export const useMemo = fn => fn();');
const actionsInvoke = url('export const invoke = async (name, args) => { globalThis.exportRequests.push({name,args}); return null; };');
const actionsDialog = url('export const message = async () => {};');
const { useIosWorkspaceActions } = await import(url(actionsSource.replace('"react"', JSON.stringify(actionsReact)).replace('"./iosLogViewAdapter"', JSON.stringify(modelUrl)).replace('"@tauri-apps/api/core"', JSON.stringify(actionsInvoke)).replace('"@tauri-apps/plugin-dialog"', JSON.stringify(actionsDialog))));

test('工具栏与快捷键共用的 iOS 动作遵循暂停/清空边界，TXT 导出保留 raw 而非展示字段', async () => {
  globalThis.exportRequests = [];
  const records = [rawIos(1), rawIos(2), rawIos(3)];
  const patches = [];
  const view = { search: 'needle', regex: false, level: 'notice', semantic: '', snapshot: records.slice(0, 2), clearedThrough: 1, selected: records[1], follow: false, find: { open: true, query: 'needle', caseSensitive: false, useRegex: false, currentMatch: 9 } };
  try {
    const actions = useIosWorkspaceActions(view, records, (patch) => patches.push(patch), false);
    assert.equal(actions.canPause, true); // 已停止时仍可恢复暂停展示。
    await actions.exportCurrent();
    assert.deepEqual(globalThis.exportRequests, [{ name: 'export_logs', args: { text: records[1].raw } }]);
    actions.pause(); assert.deepEqual(patches[0], { snapshot: null });
    actions.clear(); assert.equal(patches[1].clearedThrough, 3); assert.equal(patches[1].selected, null); assert.equal(patches[1].find.query, 'needle'); assert.equal(patches[1].find.currentMatch, 0);
    const cleared = useIosWorkspaceActions({ ...view, ...patches[1] }, records, () => {}, false);
    await cleared.exportCurrent(); assert.equal(globalThis.exportRequests.length, 1);
    assert.equal(records.length, 3);
  } finally { delete globalThis.exportRequests; }
});

test('真实快捷键 Hook 按最新平台/Tab 回调执行，不重复订阅，页面/输入/弹窗/组合键不误触', () => {
  const listeners = new Set(); const calls = [];
  let popup = false; let selectedText = false;
  globalThis.window = { addEventListener: (_key, fn) => listeners.add(fn), removeEventListener: (_key, fn) => listeners.delete(fn), getSelection: () => ({ isCollapsed: !selectedText }) };
  globalThis.document = { querySelector: () => popup ? {} : null };
  const h = { mounted: false, ref: null, cleanup: null };
  const render = (platform, enabled = true) => { globalThis.shortcutHarness = h; useLogWorkspaceShortcuts({ enabled, canPause: true, canExport: true, onPause: () => calls.push(`${platform}:pause`), onClear: () => calls.push(`${platform}:clear`), onExport: () => calls.push(`${platform}:export`), onCopy: () => calls.push(`${platform}:copy`) }); };
  const emit = (key, extra = {}) => {
    const event = { key, defaultPrevented: false, isComposing: false, ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, target: { closest: () => null }, preventDefault() { this.defaultPrevented = true; }, ...extra };
    listeners.forEach((fn) => fn(event)); return event;
  };
  try {
    render('android'); emit(' '); emit('l', { ctrlKey: true });
    render('ios'); emit('e', { metaKey: true }); emit('c', { metaKey: true });
    assert.equal(listeners.size, 1);
    assert.deepEqual(calls, ['android:pause', 'android:clear', 'ios:export', 'ios:copy']);
    const count = calls.length;
    emit('l', { ctrlKey: true, target: { closest: () => ({}) } });
    emit('l', { ctrlKey: true, defaultPrevented: true }); emit(' ', { isComposing: true });
    emit('e', { metaKey: true, altKey: true }); emit('l', { ctrlKey: true, shiftKey: true });
    popup = true; emit('e', { metaKey: true }); popup = false;
    selectedText = true; assert.equal(emit('c', { metaKey: true }).defaultPrevented, false);
    render('ios-probe', false); emit('l', { ctrlKey: true }); emit(' ');
    assert.equal(calls.length, count);
    h.cleanup(); assert.equal(listeners.size, 0);
  } finally { delete globalThis.window; delete globalThis.document; delete globalThis.shortcutHarness; }
});

test('真实虚拟器在滚动期跳过 ref 测量和缓存重置后，主动校准恢复多行高度及下一行位置', async () => {
  const { Virtualizer } = createRequire(require.resolve('@tanstack/react-virtual'))('@tanstack/virtual-core');
  const source = readFileSync(new URL('../../src/features/logcat/logRowMeasurement.ts', import.meta.url), 'utf8');
  const { measureLogRows } = await import(url(ts.transpile(source, { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 })));
  const heights = [54, 27, 81];
  const nodes = heights.map((_, index) => ({ isConnected: true, dataset: { index: String(index) }, getAttribute: () => String(index), getBoundingClientRect: () => ({ height: heights[index] }) }));
  const parent = { querySelectorAll: () => nodes };
  const v = new Virtualizer({ count: 3, getScrollElement: () => null, estimateSize: () => 20, getItemKey: (i) => `row-${i}`, scrollToFn: () => {}, observeElementRect: () => {}, observeElementOffset: () => {} });
  v.getTotalSize();
  v.isScrolling = true;
  nodes.forEach((node) => v.measureElement(node));
  assert.equal(v.getTotalSize(), 60); // 测量被跳过，不能把估值当作真实行高。
  measureLogRows(parent, v);
  assert.equal(v.getTotalSize(), 162);
  assert.equal(v.getMeasurements()[1].start, 54);
  v.measure();
  assert.equal(v.getTotalSize(), 60);
  heights[0] = 108; // 缩窄内容列或放大字号后换行增加。
  measureLogRows(parent, v);
  assert.equal(v.getMeasurements()[1].start, 108);
  assert.equal(v.getTotalSize(), 216);
});

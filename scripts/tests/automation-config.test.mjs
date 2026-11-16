import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
const require = createRequire(import.meta.url);
const { build } = createRequire(require.resolve('vite'))('esbuild');
const bundle = await build({ stdin: { contents: 'export * from "./src/features/automation/model"; export { defaultDraft, storedView, validatePlanList } from "./src/features/automation/useExecutionPlans";', resolveDir: fileURLToPath(new URL('../../', import.meta.url)) }, bundle: true, write: false, format: 'esm', platform: 'node' });
const model = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`);
const plan = () => ({ Version: 4, PagePauseMs: 1000, RequestPauseMs: 300, FailureHoldMs: 2000, TypingIntervalMs: 200,
  Environment: { Country: '', Language: '', Extensions: { incentive: { Mock: { Enabled: true }, Ecpm: 20 } } },
  Modules: [{ Id: 'success', Flow: 'level_success', Enabled: true, Args: { level: '5', on_ahead: 'stop' }, Extensions: { incentive: { Enabled: true, Args: { account: 'sample' } } } }] });
const recording = { Width: 1080, Height: 1920, FrameRate: 30, BitRateMbps: 10, CaptureAudio: false };
const draft = () => ({ scenario: 'material_capture_mock', countries: ['ID'], plan: plan(), recording, outputDirectory: '/tmp/AutomationOutput' });
const catalog = { ProtocolVersion: 1, Game: 'sample', Adapter: 'sample', Countries: ['ID', 'BR'], Scenarios: [{ Id: 'material_capture_mock' }] };
test('与Editor配置往返时保留业务扩展，不把本机设备或国家覆盖写回项目', () => {
  const value = model.exportProject(draft());
  assert.deepEqual(model.importProject(value, 'material_capture_mock'), { plan: plan(), recording });
  assert.equal(JSON.parse(value).countries, undefined);
  assert.equal(model.validateDraft(draft(), catalog), null);
});
test('损坏导入与本机缓存不会进入渲染阶段', () => {
  for (const bad of [null, {}, { Version: 4, Modules: [null] }, { ...plan(), Environment: null }, { ...plan(), Modules: [{ ...plan().Modules[0], Args: null }] }]) {
    const text = JSON.stringify({ Version: 1, Plans: { material_capture_mock: bad } });
    assert.throws(() => model.importProject(text, 'material_capture_mock'));
    assert.equal(model.readSavedDraft(JSON.stringify({ ...draft(), plan: bad }), 'material_capture_mock'), null);
  }
  assert.equal(model.readSavedDraft('{invalid', 'material_capture_mock'), null);
});
test('按当前目录限制国家，拒绝重复片段和越界节奏与录屏参数', () => {
  for (const change of [ { countries: [] }, { countries: ['US'] }, { countries: ['ID', 'ID'] }, { plan: { ...plan(), Modules: [...plan().Modules, ...plan().Modules] } }, { plan: { ...plan(), TypingIntervalMs: 1 } }, { recording: { ...recording, BitRateMbps: 0 } } ]) assert.ok(model.validateDraft({ ...draft(), ...change }, catalog));
});
test('可选文本清空后恢复业务默认生成，不污染模板或原对象', () => {
  const original = plan();
  const copy = model.writePath(original, 'Modules', []);
  assert.equal(original.Modules.length, 1);
  assert.deepEqual(copy.Modules, []);
  const clip = original.Modules[0];
  const changed = model.writePath(clip, 'Extensions.incentive.Args.account', '');
  assert.equal(changed.Extensions.incentive.Args.account, undefined);
  assert.equal(clip.Extensions.incentive.Args.account, 'sample');
  assert.throws(() => model.writePath({}, '__proto__.polluted', true));
  assert.throws(() => model.writePath({}, 'constructor.prototype.polluted', true));
  assert.equal({}.polluted, undefined);
});

test('每个场景读取自己的默认计划，编辑副本不改变测试包目录', () => {
  const full = { ...catalog, Scenarios: [{ Id: 'material_capture_mock', Plan: plan(), Recording: recording }, { Id: 'another_scene', Plan: { ...plan(), PagePauseMs: 2000 }, Recording: { ...recording, CaptureAudio: true } }] };
  const next = model.defaultDraft(full, 'another_scene', '/tmp/out');
  assert.equal(next.scenario, 'another_scene');
  assert.equal(next.plan.PagePauseMs, 2000);
  assert.equal(next.recording.CaptureAudio, true);
  next.plan.Modules[0].Args.level = '99';
  assert.equal(full.Scenarios[1].Plan.Modules[0].Args.level, '5');
  assert.throws(() => model.defaultDraft(full, 'not_exported', '/tmp/out'));
});
test('独立Tab草稿保留基线和修订号，损坏草稿及跨场景方案被拒绝', () => {
  const view = { draft: draft(), baseline: draft(), planId: 'plan1', revision: 3 };
  assert.deepEqual(model.storedView(JSON.stringify(view)), view);
  assert.equal(model.storedView(JSON.stringify({ ...view, baseline: {} })), null);
  assert.equal(model.storedView('{invalid'), null);
  const list = { version: 1, revision: 1, plans: [{ id: 'plan1', name: 'ID方案', draft: draft(), updatedAt: '' }], deleted: [], migratedSources: [] };
  assert.deepEqual(model.validatePlanList(list, 'material_capture_mock'), list);
  assert.throws(() => model.validatePlanList(list, 'other'));
  assert.throws(() => model.validatePlanList({ ...list, plans: [...list.plans, ...list.plans] }, 'material_capture_mock'));
});
test('跨Rust和浏览器的JSON字段排序不会导致旧方案丢选或误报未保存', () => {
  const reverse = (value) => Array.isArray(value) ? value.map(reverse) : value && typeof value === 'object' ? Object.fromEntries(Object.entries(value).reverse().map(([k, v]) => [k, reverse(v)])) : value;
  assert.equal(model.sameDraft(draft(), reverse(draft())), true);
  const changed = draft(); changed.plan.Modules[0].Args.level = '55';
  assert.equal(model.sameDraft(draft(), changed), false);
});
test('命令返回与状态事件保留内容不变的目录引用，避免运行时重新加载方案', () => {
  const previous = { ...model.EMPTY_STATE, catalog: { ...catalog }, phase: 'ready' };
  const started = model.reconcileAutomationState(previous, { ...previous, catalog: structuredClone(previous.catalog), busy: true, phase: 'preparing', country: 'ID' });
  assert.equal(started.catalog, previous.catalog);
  assert.equal(started.busy, true);
  assert.equal(started.phase, 'preparing');
  const event = model.reconcileAutomationState(started, { ...started, catalog: structuredClone(previous.catalog), phase: 'running', node: 'game_load' });
  assert.equal(event.catalog, previous.catalog);
  assert.equal(event.node, 'game_load');
  const changed = structuredClone(catalog); changed.Countries = ['ID'];
  assert.equal(model.reconcileAutomationState(event, { ...event, catalog: changed }).catalog, changed);
  assert.equal(model.reconcileAutomationState(event, { ...event, catalog: null }).catalog, null);
});

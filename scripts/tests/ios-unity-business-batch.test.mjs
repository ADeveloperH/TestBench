import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
const require = createRequire(import.meta.url);
const { build } = createRequire(require.resolve('vite'))('esbuild');
const bundle = await build({ stdin: { contents: `export * from './src/features/ios/iosPilotMonitoring'; export * from './src/features/ios/iosPilotCases'; export * from './src/features/ios/useIosPilotMonitoring';`, resolveDir: fileURLToPath(new URL('../../', import.meta.url)) }, bundle: true, write: false, platform: 'node', format: 'esm',
  define: { 'import.meta.env.VITE_ENABLE_IOS_BUSINESS_CANDIDATES': '"true"', 'performance.now': 'globalThis.iosBatchHarness.now', 'setInterval': 'globalThis.iosBatchHarness.setInterval', 'clearInterval': 'globalThis.iosBatchHarness.clearInterval' },
  plugins: [{ name: 'react', setup(b) { b.onResolve({ filter: /^react$/ }, () => ({ path: 'react', namespace: 'test' })); b.onLoad({ filter: /.*/, namespace: 'test' }, () => ({ contents: 'export const useRef=v=>globalThis.iosBatchHarness.ref(v); export const useState=v=>globalThis.iosBatchHarness.state(v); export const useEffect=(f,d)=>globalThis.iosBatchHarness.effect(f,d);' })); } }] });
const m = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`);
const status = (patch = {}) => ({ deviceKey: 'ios:one', sessionId: 'capture', state: 'running', receivedCount: 0, emittedCount: 0, backendDroppedCount: 0, storageError: null, ...patch });
const tab = (id = 'test', patch = {}) => ({ id, kind: 'test', name: 'business', testBundleId: m.IOS_PILOT_BUNDLE, testRun: { sessionId: 'capture', afterSequence: 0, key: 'round' }, ...patch });
const row = (sequence, message, patch = {}) => ({ sequence, sessionId: 'capture', timestamp: 'Nov 16 19:31:54', process: 'FruitQuest', module: 'UnityFramework', pid: 123, level: 'notice', semanticLevel: null, truncated: false, encodingStatus: 'valid', message, raw: `controlled:${message}`, ...patch });
const runtime = () => m.createIosPilotRuntime(tab(), 'ios:one');
const result = (rt, id) => m.iosPilotResults(rt).find(r => r.testCase.id === `ios_${id}`);
const st = (rt, patch = {}) => status({ emittedCount: rt.lastSequence, receivedCount: rt.lastSequence, ...patch });
function feed(rt, message, now = 0, recordPatch = {}, statusPatch = {}) {
  const r = row(rt.lastSequence + 1, message, recordPatch);
  m.advanceIosPilot(rt, [r], status({ receivedCount: r.sequence, emittedCount: r.sequence, ...statusPatch }), now);
  return r;
}
function ticks(rt, from, until, patch = {}) { for (let now = from; now <= until; now += 500) m.tickIosPilot(rt, st(rt, patch), now); }
const anchor = '[UserDataManager]: UserDataManager 初始化开始';
const completed = '[IncentiveEngineManager]: 所有SDK初始化完成';

test('第一批固定18个业务ID及2个独立试点，第一批定义不因第二批追加而改变', () => {
  const expected = ['network_error','ie_network_fail','ie_level_fail','unity_main_thread_violation','ie_sdk_init','ie_cheating','ie_userinfo_fail','ie_withdraw_fail','ie_prop_fail','ie_anticheat_fail','ie_localization_fail','ie_ui_fail','ie_save_fail','ie_runtime_fail','ie_task_fail','ie_task_warn','ie_reward_fail','ie_reward_fallback'].map(id => `ios_${id}`);
  assert.deepEqual(m.IOS_PILOT_CASES.slice(2, 20).map(tc => tc.id), expected);
  assert.equal(m.IOS_PILOT_CASES.length, 34);
  assert.equal(m.IOS_PILOT_CASES.filter(tc => tc.rules.some(r => r.absence)).length, 1);
});

const examples = [
 ['ie_cheating','[NetworkManager]: result code 600,cheating user','suspected'],
 ['ie_userinfo_fail','[UserDataManager]: 用户信息拉取失败: controlled','suspected'],
 ['ie_userinfo_fail','[UserDataManager]: 用户信息拉取异常: controlled','suspected'],
 ['ie_userinfo_fail','[UserDataManager]: 用户信息拉取失败，已达最大重试次数','fail'],
 ['ie_userinfo_fail','[UserDataManager]: UserDataManager 初始化成功','pass'],
 ['ie_withdraw_fail','提现档位拉取失败: controlled','suspected'],
 ['ie_withdraw_fail','提现档位拉取异常: controlled','suspected'],
 ['ie_withdraw_fail','提现档位拉取失败，已达最大重试次数','fail'],
 ['ie_withdraw_fail','提现失败, errorCode: 400','suspected'],
 ['ie_withdraw_fail','提现请求异常: controlled','fail'],
 ['ie_prop_fail','道具数据初始化异常: controlled','suspected'],
 ['ie_prop_fail','道具初始化失败','suspected'],
 ['ie_prop_fail','新用户兜底：controlled','suspected'],
 ['ie_prop_fail','道具数据初始化完成','pass'],
 ['ie_anticheat_fail','InitSDK params invalid','fail'],
 ['ie_localization_fail','Unable to load additional Localization data','fail'],
 ['ie_ui_fail','Failed to load popup controlled','fail'],
 ['ie_ui_fail','Popup prefab not found in Resources folder','fail'],
 ['ie_ui_fail','RewardToast 组件为空','fail'],
 ['ie_ui_fail','宝箱预制体未设置','fail'],
 ['ie_ui_fail','ToastManager instance not found','fail'],
 ['ie_ui_fail','需要3个输入字段，prefab 只绑定了1个','fail'],
 ['ie_save_fail','写入文件失败: controlled','fail'],
 ['ie_save_fail','Error deleting all game data','fail'],
 ['ie_save_fail','Error deleting directory controlled','fail'],
 ['ie_save_fail','Can Not Find File controlled','fail'],
 ['ie_save_fail','Failed to delete controlled','suspected'],
 ['ie_runtime_fail','[IncentiveEngineManager]: 意外错误: controlled','fail'],
 ['ie_task_fail','IAAManager 未初始化','fail'],
 ['ie_task_fail','互动广告任务缺少 url','fail'],
 ['ie_task_fail','找不到 CheckIn prefab','fail'],
 ['ie_task_fail','找不到 TaskItem prefab','fail'],
 ['ie_task_warn','任务列表拉取失败','suspected'],
 ['ie_task_warn','未知任务类型: controlled','suspected'],
 ['ie_task_warn','任务广告加载失败','suspected'],
 ['ie_task_warn','[TaskActionHandler]: 失败: code=400','suspected'],
 ['ie_reward_fail','获取升级奖励失败: controlled','fail'],
 ['ie_reward_fail','获取翻倍奖励失败: controlled','fail'],
 ['ie_reward_fail','获取悬浮宝箱奖励失败: controlled','fail'],
 ['ie_reward_fallback','翻倍广告播放失败，发放当前奖励','suspected'],
 ['ie_reward_fallback','宝箱激励广告播放失败','suspected'],
];
for (const [id, message, expected] of examples) {
  test(`${id}: ${message} → ${expected}（构造规则回放）`, () => {
    const rt = runtime(); const original = feed(rt, message);
    const actual = result(rt, id); assert.equal(actual.status, expected);
    const hit = actual.ruleHits.find(h => h.hit); assert.ok(hit);
    assert.equal(hit.totalCount, 1); assert.equal(hit.entries[0].record, original);
    assert.equal(hit.entries[0].raw, original.raw); assert.equal(hit.entries[0].tag, undefined); assert.equal(hit.entries[0].level, undefined);
  });
}

test('负条件及模块前缀保留：重试耗尽不重复算单次提现失败，组件/任务/兜底不泛化', () => {
  const rt = runtime(); feed(rt, '提现档位拉取失败，已达最大重试次数');
  assert.deepEqual(result(rt,'ie_withdraw_fail').ruleHits.map(h => h.totalCount), [0,1,0,0]);
  for (const message of ['RewardToast success','需要3个输入字段，配置正常','[Other]: 意外错误: controlled','[Other]: 失败: code=400']) feed(rt, message);
  for (const id of ['ie_ui_fail','ie_runtime_fail','ie_task_warn']) assert.equal(result(rt,id).status,'pending');
});

test('正常成功不抹除已发生的业务异常/降级，warn和error优先级保持', () => {
  const rt = runtime(); feed(rt,'道具初始化失败');feed(rt,'道具数据初始化完成');
  assert.equal(result(rt,'ie_prop_fail').status,'suspected');
  feed(rt,'[UserDataManager]: 用户信息拉取失败，已达最大重试次数');feed(rt,'[UserDataManager]: UserDataManager 初始化成功');
  assert.equal(result(rt,'ie_userinfo_fail').status,'fail');
});

test('初始化缺失：没有锚点不报错；恰好60秒有效窗口才报缺失并保留真实锚点', () => {
  const empty = runtime();ticks(empty,0,70000);assert.equal(result(empty,'ie_sdk_init').status,'pending');
  const rt = runtime();const source = feed(rt,anchor,0);ticks(rt,500,59500);
  assert.equal(result(rt,'ie_sdk_init').status,'pending');m.tickIosPilot(rt,st(rt),60000);
  const actual = result(rt,'ie_sdk_init');assert.equal(actual.status,'fail');assert.equal(actual.ruleHits[0].missing,true);
  assert.equal(actual.ruleHits[0].totalCount,0);assert.equal(actual.ruleHits[0].anchorEntry.record,source);
  assert.equal(actual.ruleHits[0].anchorEntry.raw,source.raw);assert.deepEqual(actual.ruleHits[0].entries,[]);
});

test('60秒内目标出现则成功；重复锚点按既有语义重新开始观察', () => {
  const rt = runtime();feed(rt,anchor,0);ticks(rt,500,30000);feed(rt,anchor,30500);ticks(rt,31000,60000);
  assert.equal(result(rt,'ie_sdk_init').status,'pending');feed(rt,completed,60500);ticks(rt,61000,120000);
  assert.equal(result(rt,'ie_sdk_init').status,'pass');assert.equal(rt.states.ios_ie_sdk_init.rules[0].absence,'satisfied');
});

for (const stop of ['idle','error']) {
 test(`采集${stop}结束后不继续制造缺失，同会话尾批成功可补入且不恢复计时`, () => {
  const rt = runtime();feed(rt,anchor,0);ticks(rt,500,59000);m.tickIosPilot(rt,st(rt,{state:stop}),59500);ticks(rt,60000,130000,{state:stop});
  assert.equal(rt.ended,true);assert.equal(result(rt,'ie_sdk_init').status,'pending');
  feed(rt,completed,130500,{}, {state:stop});assert.equal(result(rt,'ie_sdk_init').status,'pass');assert.equal(rt.ended,true);
  feed(rt,anchor,131000);ticks(rt,131500,200000);assert.equal(result(rt,'ie_sdk_init').status,'pass');
 });
}

for (const kind of ['sequence-gap','backend-drop','storage-error','private','truncated','mojibake']) {
 test(`不可靠输入${kind}不伪造初始化缺失，正向目标仍可匹配`, () => {
  const rt = runtime();feed(rt,anchor,0);
  const patch = kind==='private'?{message:'<private>'}:kind==='truncated'?{truncated:true}:kind==='mojibake'?{message:'�',encodingStatus:'suspected_mojibake'}:{};
  const statusPatch = kind==='backend-drop'?{backendDroppedCount:1}:kind==='storage-error'?{storageError:'controlled IO error'}:{};
  const r=row(kind==='sequence-gap'?3:2,'context',patch);
  m.advanceIosPilot(rt,[r],st(rt,{receivedCount:r.sequence,emittedCount:r.sequence,...statusPatch}),500);
  ticks(rt,1000,70000,statusPatch);assert.equal(result(rt,'ie_sdk_init').status,'pending');
  feed(rt,completed,70500);assert.equal(result(rt,'ie_sdk_init').status,'pass');
 });
}

test('计时调度停顿/时钟倒退时暂停缺失判定，不补造超时；新轮次恢复干净窗口', () => {
  for (const now of [6000,-1]) {
    const rt=runtime();feed(rt,anchor,0);m.tickIosPilot(rt,st(rt),now);assert.equal(rt.absenceSuspended,true);
    ticks(rt,6500,70000);assert.equal(result(rt,'ie_sdk_init').status,'pending');
  }
  const fresh=runtime();feed(fresh,anchor,0);ticks(fresh,500,60000);assert.equal(result(fresh,'ie_sdk_init').status,'fail');
});

test('等待后端/前端队列排空后再判缺失；队列里的成功目标不会被提前报缺失', () => {
  for (const queued of [{receivedCount:2,emittedCount:1},{receivedCount:2,emittedCount:2}]) {
    const rt=runtime();feed(rt,anchor,0);ticks(rt,500,65000,queued);
    assert.equal(result(rt,'ie_sdk_init').status,'pending');feed(rt,completed,65500);
    assert.equal(result(rt,'ie_sdk_init').status,'pass');
  }
});

test('iOS使用单调时间，不受系统墙钟日期前后跳变影响', () => {
  const saved=Date.now;try {
    Date.now=()=>9e15;const rt=runtime();feed(rt,anchor,0);ticks(rt,500,30000);
    Date.now=()=>1;ticks(rt,30500,60000);assert.equal(result(rt,'ie_sdk_init').status,'fail');
    assert.equal(rt.states.ios_ie_sdk_init.rules[0].triggeredAt,60000);
  } finally { Date.now=saved; }
});

function harness() {
 const slots=[];const timers=new Map();let cursor=0;let effects=[];let serial=0;
 const h={time:0,now:()=>h.time,setInterval:(fn,ms)=>{assert.equal(ms,500);const id=++serial;timers.set(id,fn);return id;},clearInterval:id=>timers.delete(id),
  ref(v){const i=cursor++;return slots[i]??={current:v};},state(v){const i=cursor++;if(!(i in slots))slots[i]=v;return[slots[i],next=>slots[i]=typeof next==='function'?next(slots[i]):next];},
  effect(fn,deps){const i=cursor++;const old=slots[i];if(!old||deps.some((v,j)=>!Object.is(v,old.deps[j])))effects.push(()=>{old?.cleanup?.();slots[i]={deps,cleanup:fn()};});},
  render(tabs,rows,sourceStatus,deviceKey='ios:one',busy=false){cursor=0;globalThis.iosBatchHarness=h;const value=m.useIosPilotMonitoring(deviceKey,tabs,rows,sourceStatus,busy);const fns=effects;effects=[];fns.forEach(fn=>fn());return value;},
  fire(time){h.time=time;for(const fn of timers.values())fn();},unmount(){for(const slot of slots)slot?.cleanup?.();},timers};return h;
}

test('真实根Hook无新日志时仍计时；后台多Tab独立，单项重置不回放锚点，卸载清理定时器', () => {
 const h=harness();const tabs=[tab('one'),tab('two')];const rows=[row(1,anchor)];const sourceStatus=status({receivedCount:1,emittedCount:1});
 h.render(tabs,rows,sourceStatus);assert.equal(h.timers.size,1);
 for(let now=500;now<=30000;now+=500)h.fire(now);
 let view=h.render(tabs,rows,sourceStatus);view.resetCase(tabs[0],'ios_ie_sdk_init');
 for(let now=30500;now<=60000;now+=500)h.fire(now);
 view=h.render(tabs,rows,sourceStatus);assert.equal(view.forTab(tabs[0]).results.find(r=>r.testCase.id==='ios_ie_sdk_init').status,'pending');
 assert.equal(view.forTab(tabs[1]).results.find(r=>r.testCase.id==='ios_ie_sdk_init').status,'fail');
 h.unmount();assert.equal(h.timers.size,0);
});

test('重新开始更换轮次不继承旧锚点和缺失状态，关闭Tab后旧计时不影响新Tab', () => {
 const h=harness();const sourceStatus=status({receivedCount:1,emittedCount:1});const rows=[row(1,anchor)];h.render([tab()],rows,sourceStatus);
 for(let now=500;now<=60000;now+=500)h.fire(now);
 const fresh=tab('test',{testRun:{sessionId:'capture',afterSequence:1,key:'new'}});
 h.render([fresh],rows,sourceStatus);for(let now=60500;now<=125000;now+=500)h.fire(now);
 let view=h.render([fresh],rows,sourceStatus);assert.equal(view.forTab(fresh).results.find(r=>r.testCase.id==='ios_ie_sdk_init').status,'pending');
 h.render([],rows,sourceStatus);h.fire(125500);h.unmount();assert.equal(h.timers.size,0);
});


test('离开iOS工作区/设备绑定后不对旧会话计时；回来也不将调度空窗补判为业务缺失', () => {
 const h=harness();const tabs=[tab()];const rows=[row(1,anchor)];const sourceStatus=status({receivedCount:1,emittedCount:1});
 h.render(tabs,rows,sourceStatus);h.fire(500);h.render(tabs,rows,sourceStatus,null);
 for(let now=1000;now<=70000;now+=500)h.fire(now);
 let view=h.render(tabs,rows,sourceStatus);view=h.render(tabs,rows,sourceStatus);
 assert.equal(view.forTab(tabs[0]).results.find(r=>r.testCase.id==='ios_ie_sdk_init').status,'pending');
 assert.equal(view.forTab(tabs[0]).runtime.absenceSuspended,true);h.unmount();
});


test('停止请求已发出但状态响应未返回时，Hook不跨60秒制造缺失，尾批仍可成功', () => {
 const h=harness();const tabs=[tab()];const rows=[row(1,anchor)];const sourceStatus=status({receivedCount:1,emittedCount:1});
 h.render(tabs,rows,sourceStatus);for(let now=500;now<=59500;now+=500)h.fire(now);
 h.render(tabs,rows,sourceStatus,'ios:one',true);h.fire(60000);h.fire(60500);
 let view=h.render(tabs,rows,sourceStatus,'ios:one',true);
 assert.equal(view.forTab(tabs[0]).results.find(r=>r.testCase.id==='ios_ie_sdk_init').status,'pending');
 const tail=[...rows,row(2,completed)];const stopped=status({state:'idle',receivedCount:2,emittedCount:2});
 h.time=61000;h.render(tabs,tail,stopped);view=h.render(tabs,tail,stopped);
 assert.equal(view.forTab(tabs[0]).results.find(r=>r.testCase.id==='ios_ie_sdk_init').status,'pass');
 assert.equal(view.forTab(tabs[0]).runtime.ended,true);h.unmount();
});

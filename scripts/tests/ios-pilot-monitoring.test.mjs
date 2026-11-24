import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
const require = createRequire(import.meta.url);
const { build } = createRequire(require.resolve('vite'))('esbuild');
const contents = `export * from './src/features/ios/iosPilotMonitoring'; export * from './src/features/ios/iosPilotCases'; export * from './src/features/ios/iosLogViewAdapter'; export * from './src/features/testcases/testCaseEvaluation'; export * from './src/features/testcases/engine'; export * from './src/features/ios/useIosPilotMonitoring';`;
const bundle = await build({ stdin: { contents, resolveDir: fileURLToPath(new URL('../../', import.meta.url)) }, bundle: true, write: false, format: 'esm', platform: 'node', plugins: [{name:'react-harness', setup(b){ b.onResolve({filter:/^react$/}, () => ({path:'react',namespace:'harness'})); b.onLoad({filter:/.*/,namespace:'harness'}, () => ({contents:`export const useRef = v => globalThis.pilotHarness.ref(v); export const useState = v => globalThis.pilotHarness.state(v); export const useEffect = (fn,deps) => globalThis.pilotHarness.effect(fn,deps);`})); }}] });
const m = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`);
const status = (patch={}) => ({ deviceKey:'ios:one', sessionId:'capture', state:'running', emittedCount:0, receivedCount:0, backendDroppedCount:0, frontendDroppedCount:0, error:null, storageError:null, ...patch });
const tab = (id='tab', patch={}) => ({ id, name:'test', kind:'test', testBundleId:m.IOS_PILOT_BUNDLE, testRun:{sessionId:'capture',afterSequence:0,key:'round'}, ...patch });
const record = (sequence, message, patch={}) => Object.freeze({ sequence, sessionId:'capture', process:'FruitQuest', module:'UnityFramework', timestamp:'Nov 16 14:14:35', pid:3963, message, raw:`raw:${message}`, level:'notice', semanticLevel:null, encodingStatus:'valid', truncated:false, ...patch });
const completed = '[FruitQuest.LevelFlow]: [LevelFlow] step=on_game_win_invoked, run=2';
const progress = '[InLevelAdRewardManager]: [InLevelAdReward] 第29关 进度更新：66.67%';
const blankView = { clearedThrough:-1, snapshot:null, search:'', regex:false, markers:'', level:'', semantic:'' };

function assertPilotStatuses(results, expected) {
  assert.deepEqual(results.slice(0, 2).map(r => r.status), expected);
  assert.equal(results.filter(r => r.status === 'disabled').length, 1);
  assert.equal(results.slice(2).filter(r => r.status === 'pending').length, 30);
  assert.equal(results.find(r => r.testCase.id === 'ios_ie_ua_adjust_event').status, 'suspected');
}

test('试点只允许确认的 Fruit 单应用精确会话，不允许前缀/全部/异设备/停止或启停中', () => {
  const scope={processFilter:'FruitQuest',exactProcess:true};
  assert.equal(m.canStartIosPilot(m.IOS_PILOT_BUNDLE,'FruitQuest',scope,status(),'ios:one',false),true);
  for(const [bundle,exe,s,st,device,busy] of [
    ['', 'FruitQuest',scope,status(),'ios:one',false], [m.IOS_PILOT_BUNDLE,null,scope,status(),'ios:one',false],
    [m.IOS_PILOT_BUNDLE,'FruitQuest',{...scope,exactProcess:false},status(),'ios:one',false],
    [m.IOS_PILOT_BUNDLE,'FruitQuest',scope,status({state:'idle'}),'ios:one',false],
    [m.IOS_PILOT_BUNDLE,'FruitQuest',scope,status(),'ios:two',false],
    [m.IOS_PILOT_BUNDLE,'FruitQuest',scope,status(),'ios:one',true],
  ]) assert.equal(m.canStartIosPilot(bundle,exe,s,st,device,busy),false);
  assert.equal(m.createIosPilotRuntime(tab('x',{testBundleId:'com.other'}),'ios:one'),null);
});

test('还原中文只计一次，关卡完成精确匹配，证据保留原文/来源且不伪造Tag和级别', () => {
  const runtime=m.createIosPilotRuntime(tab(),'ios:one');
  const wrong='[InLevelAdRewardManager]: [InLevelAdReward] Á¨¨28ÂÖ≥ ËøõÂ∫¶Êõ¥Êñ∞Ôºö16.67%';
  const source=[record(1,wrong),record(2,completed)];
  m.advanceIosPilot(runtime,source,status());m.advanceIosPilot(runtime,source,status());
  const results=m.iosPilotResults(runtime);
  assertPilotStatuses(results, ['pass','pass']);
  for(const result of results.slice(0,2)) assert.equal(result.ruleHits[0].totalCount,1);
  const evidence=results[1].ruleHits[0].entries[0];
  assert.ok(evidence.message.includes('第28关 进度更新：16.67%'));
  assert.equal(evidence.raw,source[0].raw);assert.equal(evidence.record,source[0]);
  assert.equal(evidence.tag,undefined);assert.equal(evidence.level,undefined);
  assert.equal(evidence.deviceKey,'ios:one');assert.equal(evidence.sessionId,'capture');
});

test('开始边界、来源模块/进程、百分比和完成标记的负样本不误判', () => {
  const runtime=m.createIosPilotRuntime(tab('x',{testRun:{sessionId:'capture',afterSequence:2,key:'new'}}),'ios:one');
  const rows=[record(1,completed),record(2,progress),record(3,completed,{module:'WebKit'}),record(4,progress,{process:'Other'}),
    record(5,'[LevelFlow] step=on_game_win_invoked_failed'),record(6,'[InLevelAdReward] 进度更新：101%'),record(7,'[InLevelAdReward] 进度更新：-5%'),record(8,'[InLevelAdReward] 进度更新：100.1%')];
  m.advanceIosPilot(runtime,rows,status());assertPilotStatuses(m.iosPilotResults(runtime), ['pending','pending']);
  m.advanceIosPilot(runtime,[record(9,'[InLevelAdReward] 进度更新：100%')],status());
  assert.equal(m.iosPilotResults(runtime)[1].status,'pass');
});

test('旧会话/其他设备不参与，停止尾批可补入但采集中断和缺口单独提示', () => {
  const runtime=m.createIosPilotRuntime(tab(),'ios:one');
  assert.equal(m.advanceIosPilot(runtime,[record(1,completed)],status({deviceKey:'ios:two'})),false);
  m.advanceIosPilot(runtime,[record(1,completed,{sessionId:'old'})],status());assert.equal(runtime.lastSequence,0);
  m.advanceIosPilot(runtime,[record(1,completed)],status({state:'idle'}));
  assert.equal(m.iosPilotResults(runtime)[0].status,'pass');
  m.advanceIosPilot(runtime,[record(3,progress,{truncated:true})],status({state:'error',backendDroppedCount:1}));
  assert.equal(runtime.incomplete,true);assert.equal(runtime.interrupted,true);assert.equal(runtime.limitedContent,true);
  const fresh=m.createIosPilotRuntime(tab('x',{testRun:{sessionId:'new',afterSequence:0,key:'new'}}),'ios:one');
  m.advanceIosPilot(fresh,[record(1,completed)],status({sessionId:'new'}));
  assert.equal(m.iosPilotResults(fresh)[0].status,'pending');
});

test('否定条件缺字段不误命中；共享评估保留 Android minCount、锚点及状态优先级', () => {
  const entry={id:1,date:'',time:'',pid:null,message:'event',raw:'original'};
  for(const op of ['equals','not_equals','contains','not_contains','regex'])assert.equal(m.conditionMatches({field:'tag',op,value:'Unity'},entry),false);
  const tc={id:'android',name:'android',scope:{global:true,apps:[]},rules:[{effect:'pass',minCount:2,expr:m.cond('tag','equals','Unity')},{effect:'error',expr:m.cond('message','equals','failure'),absence:{anchor:m.cond('message','equals','anchor'),withinSec:3}}]};
  const cs=m.initCaseState(tc);const android={...entry,pid:'12',tag:'Unity',level:'I'};
  m.advanceCaseState(tc,cs,{...android,message:'anchor'},1000);
  assert.equal(cs.rules[1].absence,'waiting');assert.equal(cs.rules[1].anchorAt,1000);assert.equal(m.computeStatus(tc,cs),'pending');
  m.advanceCaseState(tc,cs,{...android,id:2,message:'failure'},2000);
  assert.equal(cs.rules[1].absence,'satisfied');assert.equal(m.computeStatus(tc,cs),'pass');
  assert.equal(cs.rules[0].totalCount,2);assert.equal(cs.rules[0].entries.length,2);
  cs.rules[1].hit=true;assert.equal(m.computeStatus(tc,cs),'fail');
  assert.equal(m.computeStatus({...tc,enabled:false},cs),'disabled');
});

test('测试列表绕过普通筛选/降噪，暂停与清空仍只改变展示边界', () => {
  const rows=[record(1,completed),record(2,progress),record(3,'framework',{module:'WebKit'})];
  const v={...blankView,kind:'test',testRun:{sessionId:'capture',afterSequence:0,key:'r'},search:'[',regex:true,markers:'!LevelFlow',level:'error',semantic:'error'};
  assert.deepEqual(m.selectIosRecords(rows,v,{webkitActivities:true,audioCompletion:true,uiBackgroundTasks:true}).records,rows);
  assert.deepEqual(m.selectIosRecords(rows,{...v,snapshot:rows.slice(0,2),clearedThrough:1}).records,[rows[1]]);
  assert.equal(m.selectIosRecords(rows,{...v,testRun:undefined}).records.length,0);
});

function harness(){
 const slots=[];let cursor=0;let effects=[];
 const h={ ref(v){const i=cursor++;return slots[i]??={current:v}},state(v){const i=cursor++;if(!(i in slots))slots[i]=v;return[slots[i],next=>slots[i]=typeof next==='function'?next(slots[i]):next]},effect(fn,deps){const i=cursor++;const old=slots[i];if(!old||deps.some((v,j)=>!Object.is(v,old[j]))){slots[i]=deps;effects.push(fn)}},render(tabs,rows,st=status()){cursor=0;globalThis.pilotHarness=h;const value=m.useIosPilotMonitoring('ios:one',tabs,rows,st);const fns=effects;effects=[];fns.forEach(fn=>fn());return value}};return h;
}

test('真实根部Hook同时消费后台测试Tab，普通视图/设置页没有监测开关，重置单例不回放历史', () => {
 const h=harness();const tabs=[tab('one'),tab('two')];const rows=[record(1,completed),record(2,progress)];
 h.render(tabs,[]);h.render(tabs,rows);let value=h.render(tabs,rows);
 for(const t of tabs)assertPilotStatuses(value.forTab(t).results, ['pass','pass']);
 value.resetCase(tabs[0],m.IOS_PILOT_CASES[0].id);value=h.render(tabs,rows);
 assert.equal(value.forTab(tabs[0]).results[0].status,'pending');assert.equal(value.forTab(tabs[1]).results[0].status,'pass');
 value=h.render(tabs,[...rows,record(3,completed)]);value=h.render(tabs,[...rows,record(3,completed)]);
 assert.equal(value.forTab(tabs[0]).results[0].ruleHits[0].totalCount,1);
});

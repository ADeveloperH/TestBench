import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
const require = createRequire(import.meta.url);
const { build } = createRequire(require.resolve('vite'))('esbuild');
async function load(enabled) {
  const b = await build({ stdin: { contents: `export * from './src/features/ios/iosPilotMonitoring'; export * from './src/features/ios/iosPilotCases'; export * from './src/features/ios/iosBusinessCases'; export * from './src/features/testcases/testCaseEvaluation';`, resolveDir: fileURLToPath(new URL('../../',import.meta.url)) },bundle:true,write:false,platform:'node',format:'esm',define:{'import.meta.env.VITE_ENABLE_IOS_BUSINESS_CANDIDATES':JSON.stringify(enabled)} });
  return import(`data:text/javascript;base64,${Buffer.from(b.outputFiles[0].text).toString('base64')}`);
}
const [m, disabled] = await Promise.all([load('true'), load('false')]);
const ids = ['ios_ie_ad_fail','ios_ie_ad_ecpm_fail','ios_ie_cloud_config_fail','ios_ie_analytics_fail','ios_plugin_promotion_fail'];
const tab = {id:'business',kind:'test',testBundleId:m.IOS_PILOT_BUNDLE,testRun:{sessionId:'capture',afterSequence:0,key:'round'}};
const status = {deviceKey:'ios:one',sessionId:'capture',state:'running',receivedCount:1,emittedCount:1,backendDroppedCount:0,storageError:null};
const row = (message, patch={}) => ({sequence:1,sessionId:'capture',timestamp:'Nov 17 12:00:00',process:'FruitQuest',module:'UnityFramework',pid:123,level:'notice',semanticLevel:null,truncated:false,encodingStatus:'valid',message,raw:`controlled:${message}`,...patch});
function evaluate(source, implementation=m, statusPatch={}, customTab=tab) {
 const runtime=implementation.createIosPilotRuntime(customTab,'ios:one');
 implementation.advanceIosPilot(runtime,[source],{...status,...statusPatch},0);
 return {runtime,results:implementation.iosPilotResults(runtime)};
}
const examples = [
 ['ios_ie_ad_fail',0,'广告日志: InitAdStrategy invalid, no mediation configured (maxKey/topOnAppId/topOnAppKey all empty)','fail'],
 ...['Reward','Splash','Inter','Banner'].map(t=>['ios_ie_ad_fail',1,`广告日志: ${t}AdStrategy invalid, pid:controlled`,'fail']),
 ...['ADManager Init Invoke,strategy is null','ADManager Init Invoke,strategy invalid','InitAdStrategy invalid,_adDelegate is null'].map(t=>['ios_ie_ad_fail',2,`广告日志: ${t}`,'fail']),
 ...['UnityDispatcherTool初始化失败：ADManager.Instance为空！','UnityDispatcherTool.RunOnMainThread: 任务不能为空！','UnityDispatcherTool.DelayedCall: 回调不能为空！','UnityDispatcherTool执行任务出错：controlled'].map(t=>['ios_ie_ad_fail',3,t,'fail']),
 ['ios_ie_ad_fail',4,'广告日志: ADCoreManager LoadReward failed. Max is not init.','suspected'],
 ['ios_ie_ad_ecpm_fail',0,'NetWorkLog:Request Post /controlled JsonParams: {"ecpm":0}','fail'],
 ['ios_ie_ad_ecpm_fail',0,'NetWorkLog:Request Post /controlled\nJsonParams : {\n "ecpm" : 0.00, "other":1\n}','fail'],
 ['ios_ie_cloud_config_fail',0,'[IOSCloudConfig] Init：原生实现【未接入】—— 走的是兜底桩','fail'],
 ['ios_ie_cloud_config_fail',1,'[IOSCloudConfig] GetBizConfigs "controlled" → 解析原生 JSON 失败：controlled','fail'],
 ['ios_ie_cloud_config_fail',2,'[IOSCloudConfig] AB callback failed: controlled','fail'],
 ['ios_ie_cloud_config_fail',3,'[IOSCloudConfig] controlled 尚未实现，已降级返回默认值。请补齐实现','suspected'],
 ['ios_ie_analytics_fail',0,'Beyla 埋点未初始化，埋点无效。。。。','fail'],
 ['ios_ie_analytics_fail',1,'[FirebaseAnalyticsTracker]: Event ID cannot be null or empty','fail'],
 ['ios_ie_analytics_fail',2,'[FirebaseAnalyticsTracker]: Failed to log event controlled: exception','fail'],
 ['ios_ie_analytics_fail',3,'[FirebaseInit]: Could not resolve all Firebase dependencies: controlled','fail'],
 ...['PromotionManager GetPromotionChannel not init','PromotionManager GetAdjustPromotionChannel not init'].map(t=>['ios_plugin_promotion_fail',0,t,'suspected']),
 ['ios_plugin_promotion_fail',1,'[Promotion] iOS bridge is_linked = False','fail'],
 ['ios_plugin_promotion_fail',1,'[Promotion] ⚠️ 未接入 iOSPromotionLibrary —— 本工程走的是兜底桩','fail'],
];
for(const [id,rule,text,expected] of examples) test(`第二批构造分支 ${id}/${rule}: ${text}`,()=>{
 const source=row(text); const r=evaluate(source).results.find(r=>r.testCase.id===id);
 assert.equal(r.status,expected); assert.equal(r.ruleHits[rule].totalCount,1);
 const evidence=r.ruleHits[rule].entries[0];assert.equal(evidence.record,source);assert.equal(evidence.raw,source.raw);
 assert.equal(evidence.level,undefined);assert.equal(evidence.tag,undefined);
});
const negatives = [
 'UnityDispatcherTool初始化完成 | 主线程ID：1','广告日志: ADCoreManager Init. IOSAD','广告日志: IOSAD ShowReward failed. callback is null.',
 '广告日志: UnknownAdStrategy invalid','Other no mediation configured','AndroidAD init failed','AndroidAdManager pid is empty',
 '[IOSCloudConfig] Init：原生实现已接入','[IOSCloudConfig] GetInt "key" → 原生返回 NULL，回落默认值 0',
 '[IOSCloudConfig] GetBizConfigs "key" → 原生返回空 ⇒ 空字典（入参非法或原生未接入）',
 '转换失败：AndroidDataConverter controlled','DefaultCloudConfig GetString','[Other] 解析原生 JSON 失败：controlled',
 '[Other] Failed to log event controlled','[Other] Event ID cannot be null or empty','[Other] Could not resolve all Firebase dependencies: controlled',
 '[Analytics] 事件 UpdateEcpm 未命中 Adjust 白名单 ⇒ 只上报埋点、不转发 Adjust',
 '[Promotion] iOS bridge is_linked = True','[Promotion] iOS bridge is_linked = FalsePositive','[Promotion] channel=none',
 '[Promotion] channel=organic','[Promotion] Adjust 初始化完成','[Promotion] 已上报广告收入 source applovin_max_sdk 0.01 USD',
 '[Analytics] 已上报事件 UpdateEcpm：["price": -1]','[Analytics] 已上报事件 UpdateEcpm：["price": 0]',
 'NetWorkLog:Request JsonParams: {"ecpm":0.001}','NetWorkLog:Request JsonParams: {"ecpm":10}',
 'NetWorkLog:Request JsonParams: {"ecpm":-1}','NetWorkLog:Request JsonParams: {"ecpm":"0"}',
 'NetWorkLog:Request JsonParams: {"other_ecpm":0}','NetWorkLog:Request JsonParams: {}',
 'NetWorkLog:Response JsonParams: {"ecpm":0}','[Other] ecpm=0',
 'Normal message\nUnityDispatcherTool执行任务出错：stack only',
 'Normal message\n[FirebaseAnalyticsTracker]: Failed to log event stack only',
 'Normal message\nNetWorkLog:Request JsonParams: {"ecpm":0}',
];
for(const text of negatives) test(`第二批不误报: ${text}`,()=>{
 assert.ok(evaluate(row(text)).results.filter(r=>ids.includes(r.testCase.id)).every(r=>r.status==='pending'));
});
test('iOS eCPM 只使用当前请求的完整参数对象及其顶层数值', () => {
 const id = 'ios_ie_ad_ecpm_fail';
 const request = 'NetWorkLog:Request Post /controlled';
 const adReport = 'NetWorkLog:Request Post https://fixture.invalid/merge/coin/report/ecpm/match/pos';
 const messages = [
  [`${request}\r\n  JsonParams : {\r\n "nested": [{"ecpm": 9}], "text": "escaped quote: \\" and braces: } {", "ecpm": 0.00\r\n}\nOtherParams: {"ecpm":1}`, 'fail'],
  [`${request} JsonParams: {"\\u0065cpm": 0}`, 'fail'],
  [`${request} JsonParams: {"ecpm":1}\nOtherParams: {"ecpm":0}`, 'pending'],
  [`${request} JsonParams: {"other":1}\nOtherParams: {"ecpm":0}`, 'pending'],
  [`${request} JsonParams: {"nested":[{"ecpm":0}]}`, 'pending'],
  [`${request} JsonParams: {"ecpm":0,"ecpm":1}`, 'pending'],
  [`${request} JsonParams: {"ecpm":0, <…>`, 'pending'],
  [`${request} JsonParams: {"ecpm":0,"unfinished":"text`, 'pending'],
  [`${request} JsonParams: {"ecpm":0,}`, 'pending'],
  [`${request} JsonParams: [{"ecpm":0}]`, 'pending'],
  [`${request}\n{"ecpm":0}`, 'pending'],
  [`${adReport}\n{"ecpm":0.0,"api_version":2}`, 'fail'],
  [`${adReport}?test=1\r\n  {\r\n"ecpm":0,"api_version":2\r\n}`, 'fail'],
  [`${adReport}\n{"ecpm":0.001}`, 'pending'],
  [`${adReport}\n{"ecpm":0,... (truncated, total=120)`, 'pending'],
  [`${adReport}\n{"data":{"ecpm":0}}`, 'pending'],
  [`${adReport}\n{}\nOtherParams: {"ecpm":0}`, 'pending'],
  [`${adReport}/other\n{"ecpm":0}`, 'pending'],
  [`${adReport.replace('Request', 'Response')}\n{"ecpm":0}`, 'pending'],
  ['NetWorkLog:Request Post /merge/coin/user/info\n{"ecpm":0}', 'pending'],
  [`${request}\nNetWorkLog:Response JsonParams: {"ecpm":0}`, 'pending'],
  [`${request}\nNetWorkLog:Request Post /other JsonParams: {"ecpm":0}`, 'pending'],
  [`debug: "${request} JsonParams: {"ecpm":0}"`, 'pending'],
 ];
 for (const [message, expected] of messages) {
  const source = row(message, {truncated: message.includes('<…>')});
  const result = evaluate(source).results.find(r => r.testCase.id === id);
  assert.equal(result.status, expected, message);
  if (expected === 'fail') assert.equal(result.ruleHits[0].entries[0].raw, source.raw);
 }
 const ordinary = message => evaluate(row(message), disabled).results.find(r => r.testCase.id === id).status;
 assert.equal(ordinary(`${adReport}\n{"ecpm":0}`), 'fail');
 assert.equal(ordinary(`${adReport} JsonParams: {"ecpm":0}`), 'fail');
 assert.equal(ordinary(`${request} JsonParams: {"ecpm":0}`), 'pending');
 assert.equal(ordinary('NetWorkLog:Request Post /merge/coin/user/info JsonParams: {"ecpm":0}'), 'pending');
});

test('Android eCPM 的 Stats 与 Unity 请求分支沿用原有规则', () => {
 const tc = JSON.parse(readFileSync(new URL('../../config/remote-config.json', import.meta.url))).testCases.find(t => t.id === 'ie_ad_ecpm_fail');
 const evaluateAndroid = (tag, message) => {
  const state = m.initCaseState(tc);
  m.advanceCaseState(tc, state, {id:1, tag, message});
  return state.rules.map(rule => rule.hit);
 };
 assert.deepEqual(evaluateAndroid('Android.Stats', 'UpdateEcpm {price=-1, currency=USD}'), [true, false]);
 assert.deepEqual(evaluateAndroid('Unity', 'NetWorkLog:Request JsonParams: {"ecpm":0}'), [false, true]);
 assert.deepEqual(evaluateAndroid('Unity', 'NetWorkLog:Request JsonParams: {"ecpm":0.1}'), [false, false]);
});

test('普通构建1项候选停用，两条正向试点保留；第一批定义及Android内置身份不改变',()=>{
 assert.equal(m.IOS_BUSINESS_CASE_COUNT,32);assert.equal(m.IOS_PILOT_CASES.length,34);
 assert.deepEqual(m.IOS_PILOT_CASES.slice(20,25).map(tc=>tc.id),ids);
 const results=evaluate(row(examples[0][2]),disabled).results;
 assert.equal(results.filter(r=>r.status==='disabled').length,1);
 assert.equal(results.find(r=>r.testCase.id==='ios_ie_ad_fail').status,'fail');
 assert.ok(results.filter(r=>r.status==='disabled').every(r=>r.ruleHits.every(h=>h.totalCount===0&&h.entries.length===0)));
 const android=JSON.parse(readFileSync(new URL('../../config/remote-config.json',import.meta.url))).testCases;
 assert.equal(android.length,47);assert.ok(android.every(tc=>!tc.id.startsWith('ios_')));
 assert.ok(m.IOS_PILOT_CASES.slice(20,25).every(tc=>tc.scope.apps[0]===m.IOS_PILOT_BUNDLE&&!tc.rules.some(r=>r.absence||r.effect==='pass')));
});
test('普通构建对渠道桥未初始化和未链接分别判疑似和有问题', () => {
 const id = 'ios_plugin_promotion_fail';
 for (const [message, expected] of [
  ['PromotionManager GetPromotionChannel not init', 'suspected'],
  ['PromotionManager GetAdjustPromotionChannel not init', 'suspected'],
  ['[Promotion] iOS bridge is_linked = False', 'fail'],
  ['[Promotion] 未接入 iOSPromotionLibrary', 'fail'],
  ['[Promotion] iOS bridge is_linked = True', 'pending'],
  ['[Promotion] channel=Organic', 'pending'],
 ]) {
  assert.equal(evaluate(row(message), disabled).results.find(r=>r.testCase.id===id).status, expected);
  assert.equal(evaluate(row(message, {module:'Foundation'}), disabled).results.find(r=>r.testCase.id===id).status, 'pending');
 }
});
test('普通构建广告异常只启用独立包验证的配置诊断', () => {
 const id = 'ios_ie_ad_fail';
 const result = (message, implementation = disabled) => evaluate(row(message), implementation).results.find(r => r.testCase.id === id);
 for (const message of [
  '广告日志: InitAdStrategy invalid, no mediation configured',
  '广告日志: InitAdStrategy invalid,_adDelegate is null',
  ...['Reward', 'Splash', 'Inter', 'Banner'].map(type => `广告日志: ${type}AdStrategy invalid, pid:fixture`),
 ]) assert.equal(result(message).status, 'fail');
 for (const message of [
  '广告日志: ADManager Init Invoke,strategy is null',
  '广告日志: ADManager Init Invoke,strategy invalid',
  'UnityDispatcherTool.RunOnMainThread: 任务不能为空！',
  '广告日志: ADCoreManager LoadReward failed. Max is not init.',
 ]) {
  assert.equal(result(message).status, 'pending');
  assert.notEqual(result(message, m).status, 'pending');
 }
});
test('新增每类规则隔离模块、应用、设备、会话及起始边界，序列重复不重计',()=>{
 for(const id of ids){const text=examples.find(e=>e[0]===id)[2];
  for(const patch of [{module:'Foundation'},{module:'UIKitCore'},{process:'Other'},{sessionId:'old'}]){
   assert.equal(evaluate(row(text,patch)).results.find(r=>r.testCase.id===id).status,'pending');
  }
  assert.equal(evaluate(row(text),m,{deviceKey:'ios:two'}).results.find(r=>r.testCase.id===id).status,'pending');
  assert.equal(evaluate(row(text),m,{}, {...tab,testRun:{...tab.testRun,afterSequence:1}}).results.find(r=>r.testCase.id===id).status,'pending');
  const {runtime}=evaluate(row(text));m.advanceIosPilot(runtime,[row(text)],status,1);
  assert.equal(m.iosPilotResults(runtime).find(r=>r.testCase.id===id).ruleHits.reduce((n,h)=>n+h.totalCount,0),1);
 }
});
test('新规则不污染既有iOS试点或Android严重度判定，warn不会因Apple error升为fail',()=>{
 const old=m.initCaseState({rules:[{effect:'error',expr:{kind:'cond',cond:{field:'tag',op:'equals',value:'Android.Stats'}}}]});
 const tc={id:'android',rules:[{effect:'error',expr:{kind:'cond',cond:{field:'tag',op:'equals',value:'Android.Stats'}}}]};
 m.advanceCaseState(tc,old,{id:1,tag:'Unity',message:'price=-1'},0);assert.equal(old.rules[0].hit,false);
 m.advanceCaseState(tc,old,{id:2,tag:'Android.Stats',message:'price=-1'},1);assert.equal(old.rules[0].hit,true);
 const results=evaluate(row('广告日志: ADCoreManager LoadReward failed. Max is not init.',{level:'error'})).results;
 assert.equal(results.find(r=>r.testCase.id==='ios_ie_ad_fail').status,'suspected');
 assert.ok(results.filter(r=>!ids.includes(r.testCase.id)).every(r=>r.status
   === (r.testCase.id === 'ios_ie_ua_adjust_event' ? 'suspected' : 'pending')));
});
test('中文还原后命中新云控分支，原始乱码保留；正常日志不清除已见warn/error',()=>{
 const chars=[...'ÄÅÇÉÑÖÜáàâäãåçéèêëíìîïñóòôöõúùûü†°¢£§•¶ß®©™´¨≠ÆØ∞±≤≥¥µ∂∑∏π∫ªºΩæø¿¡¬√ƒ≈∆«»… ÀÃÕŒœ–—“”‘’÷◊ÿŸ⁄€‹›ﬁﬂ‡·‚„‰ÂÊÁËÈÍÎÏÌÓÔÒÚÛÙıˆ˜¯˘˙˚¸˝˛ˇ'];
 const text='[IOSCloudConfig] Init：原生实现【未接入】—— 走的是兜底桩';
 const broken=[...new TextEncoder().encode(text)].map(b=>b<128?String.fromCharCode(b):chars[b-128]).join('');
 const source=row(broken,{encodingStatus:'suspected_mojibake'});const r=evaluate(source).results.find(r=>r.testCase.id==='ios_ie_cloud_config_fail');
 assert.equal(r.status,'fail');assert.equal(r.ruleHits[0].entries[0].message,text);assert.equal(r.ruleHits[0].entries[0].raw,source.raw);
 const {runtime}=evaluate(row('PromotionManager GetPromotionChannel not init'));
 m.advanceIosPilot(runtime,[row('[Promotion] iOS bridge is_linked = True',{sequence:2})],{...status,receivedCount:2,emittedCount:2},1);
 assert.equal(m.iosPilotResults(runtime).find(r=>r.testCase.id==='ios_plugin_promotion_fail').status,'suspected');
 m.advanceIosPilot(runtime,[row('[Promotion] iOS bridge is_linked = False',{sequence:3})],{...status,receivedCount:3,emittedCount:3},2);
 assert.equal(m.iosPilotResults(runtime).find(r=>r.testCase.id==='ios_plugin_promotion_fail').status,'fail');
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
const require=createRequire(import.meta.url);
const {build}=createRequire(require.resolve('vite'))('esbuild');
async function load(flag){const b=await build({stdin:{contents:`export * from './src/features/ios/iosPilotMonitoring'; export * from './src/features/ios/iosPilotCases'; export * from './src/features/ios/iosBusinessCases'; export * from './src/features/ios/iosBusinessSources';`,resolveDir:fileURLToPath(new URL('../../',import.meta.url))},bundle:true,write:false,platform:'node',format:'esm',define:{'import.meta.env.VITE_ENABLE_IOS_BUSINESS_CANDIDATES':JSON.stringify(flag)}});return import(`data:text/javascript;base64,${Buffer.from(b.outputFiles[0].text).toString('base64')}`);}
const [m,disabled]=await Promise.all([load('true'),load('false')]);
const ids=['ios_plugin_analytics_fail','ios_sdk_beyla_data_fail','ios_anticheat_runtime_fail','ios_anticheat_init'];
const tab={id:'sdk',kind:'test',testBundleId:m.IOS_PILOT_BUNDLE,testRun:{sessionId:'capture',afterSequence:0,key:'round'}};
const status={deviceKey:'ios:one',sessionId:'capture',state:'running',receivedCount:1,emittedCount:1,backendDroppedCount:0,storageError:null};
const row=(message,patch={})=>({sequence:1,sessionId:'capture',timestamp:'Nov 17 12:00:00',process:'FruitQuest',module:'Foundation',pid:123,level:'notice',semanticLevel:null,truncated:false,encodingStatus:'valid',message,raw:`controlled:${message}`,...patch});
function evaluate(source,impl=m,st=status,t=tab){const runtime=impl.createIosPilotRuntime(t,'ios:one');impl.advanceIosPilot(runtime,[source],st,0);return {runtime,results:impl.iosPilotResults(runtime)};}
const result=(rt,id)=>m.iosPilotResults(rt).find(r=>r.testCase.id===id);
const failure='[AntiCheating] ⚠️ [AntiCheating] token 通路判为**失败**（★ 非终态：迟到的成功回调仍可恢复为 ready）：code=1005';
const ready='🔗 [AntiCheating] 设备指纹就绪（长度 26）⇒ 之后 copyToken 将每次现取；SDK 版本=5.3.2';
const degraded='[AntiCheating] ⚠️ [AntiCheating] 本次取到的设备指纹长度为 5000（官方口径：≈26 = 上报成功，≈5000 = 初始化失败）⇒ **疑似降级值**。';
const samples=[
 ['ios_plugin_analytics_fail',0,'[IOSAnalytics] ⚠️ 未接入 iOSAnalyticsLibrary —— 本工程走的是兜底桩','fail'],
 ['ios_plugin_analytics_fail',0,'[Analytics][bridge] ⚠️ 未接入 iOSAnalyticsLibrary','fail'],
 ['ios_plugin_analytics_fail',1,'[Analytics] ⚠️ TrackEvent("controlled") 在未初始化时被调用，事件已丢弃','fail'],
 ['ios_plugin_analytics_fail',2,'[Analytics] ⚠️ TrackEvent 收到空事件名，已丢弃（空事件名在服务端无法归类）','fail'],
 ...['事件库打开/建表失败：','事件落库失败：','事件库查询失败：'].map(s=>['ios_sdk_beyla_data_fail',0,'[Analytics] 📤 ❌ '+s+'controlled','suspected']),
 ...['上传前压缩失败','上传前加密失败','上传流程取到 0 条事件'].map(s=>['ios_sdk_beyla_data_fail',1,'[Analytics] 📤 ❌ '+s+' ⇒ controlled','suspected']),
 ...['上传失败：服务端未确认','上传未完成：网络不可达'].map(s=>['ios_sdk_beyla_data_fail',2,'[Analytics] 📤 ❌ '+s+'（已留在本地待重试）','suspected']),
 ['ios_anticheat_runtime_fail',0,failure,'fail'],
 ['ios_anticheat_runtime_fail',1,'[AntiCheating] 🔗 同步取值返回非 0 code=1005（controlled）message=controlled','fail'],
 ['ios_anticheat_runtime_fail',1,'[AntiCheating] 🔗 同步取值返回非 0 code=-1 message=controlled','fail'],
 ['ios_anticheat_runtime_fail',2,degraded,'suspected'],
 ['ios_anticheat_runtime_fail',3,'[AntiCheating] 🔗 同步取值的 code=0 但 blackBox 指针为空 ⇒ 无值','suspected'],
 ['ios_anticheat_init',0,ready,'pass'],
 ['ios_anticheat_init',0,'[AntiCheating] 🔗 [AntiCheating] 设备指纹就绪（长度 28）⇒ 之后 copyToken 将每次现取','pass'],
 ['ios_anticheat_init',1,'[AntiCheating] ⚠️ 未接入 iOSAntiCheatingLibrary —— 本工程走的是兜底桩','fail'],
 ['ios_anticheat_init',1,'[AntiCheating][probe] iOS bridge is_linked = False','fail'],
 ['ios_anticheat_init',1,'⚠️ [AntiCheating] partner / appKey 为空 ⇒ **拒绝初始化同盾 SDK**，anti_token 将恒为空。','fail'],
 ['ios_anticheat_init',1,'[AntiCheating] ⚠️ [AntiCheating] dataCenter = "unknown" **不在官方枚举内** ⇒ 拒绝初始化。','fail'],
 ['ios_anticheat_init',2,failure,'fail'],
 ['ios_anticheat_init',3,degraded,'suspected'],
];
for(const [id,rule,text,expected] of samples)for(const module of ['UnityFramework','Foundation'])test(`SDK构造分支 ${module}/${id}/${rule}: ${text}`,()=>{
 const source=row(text,{module});const r=evaluate(source).results.find(r=>r.testCase.id===id);assert.equal(r.status,expected);assert.equal(r.ruleHits[rule].totalCount,1);
 const e=r.ruleHits[rule].entries[0];assert.equal(e.record,source);assert.equal(e.raw,source.raw);assert.equal(e.module,module);assert.equal(e.level,undefined);assert.equal(e.tag,undefined);
});
const negatives=[
 '[Analytics][bridge] 已接入 iOSAnalyticsLibrary','[IOSAnalytics] Init(appToken=controlled) —— 原生自举',
 '[Analytics] 🔁 事件 UpdateEcpm 未命中 Adjust 白名单 ⇒ 只上报埋点、不转发 Adjust',
 '[Analytics] 📤 上传结果监听已就绪（接线探针）','[Analytics] 📤 ✅ 上传成功：1 条事件已收讫（服务端 code=200）',
 '[Analytics] 已上报事件 controlled','[Analytics] 📤 开始上传 1 条事件……','[Analytics] 📤 ❌ 上传失败：尚未核实的新文案',
 '[Analytics] ⚠️ TrackEvent("controlled") 已初始化，事件已接收','[Other] 📤 ❌ 事件落库失败：controlled',
 '[AntiCheating][probe] iOS bridge is_linked = True','[AntiCheating][probe] iOS bridge is_linked = FalsePositive',
 '🔗 [AntiCheating] iOSAntiCheatingLibrary 已接入，已调用 initWithOptions',
 '[AntiCheating] iOS 初始化由原生自举完成','[AntiCheating] 🔗 已现取设备指纹，长度 26',
 '[AntiCheating] 设备指纹长度 26','[AntiCheating] 设备指纹就绪（长度 0）','[AntiCheating] 🔗 同步取值返回非 0 code=0（invalid text）',
 'Normal\n'+ready,'Normal\n'+failure,'Normal\n[Analytics] 📤 ❌ 事件落库失败：stack only',
];
for(const text of negatives)test(`SDK不从正常/过程/调用栈推导错误或成功: ${text}`,()=>{
 assert.ok(evaluate(row(text)).results.filter(r=>ids.includes(r.testCase.id)).every(r=>r.status==='pending'));
});
test('Foundation按用例授权：旧26项绝不接收任何原生关键字，也不污染原初始化计时',()=>{
 const messages=['[Analytics] [NetworkManager]: 请求异常: controlled','[Analytics] Failed to load popup controlled','[Analytics] [IncentiveEngineManager]: [Config] privacyPolicyUrl 未配置（必填）','[AntiCheating] 所有SDK初始化完成','[Analytics] [LevelFlow] step=on_game_win_invoked','[Analytics] [FirebaseAnalyticsTracker]: Failed to log event controlled'];
 for(const text of messages){const {results,runtime}=evaluate(row(text));assert.ok(results.slice(0,26).every(r=>r.status==='pending'));assert.equal(runtime.incomplete,false);}
 for(const id of ['ios_ie_network_fail','ios_ie_analytics_fail','ios_ie_cloud_config_fail','ios_ie_config_missing'])assert.equal(m.acceptsIosBusinessSource(id,'Foundation','[Analytics] message'),false);
 assert.equal(m.acceptsIosBusinessSource('ios_anticheat_init','Foundation','[Analytics] '+ready),false);
 assert.equal(m.acceptsIosBusinessSource('ios_plugin_analytics_fail','Foundation','[AntiCheating] message'),false);
 const {runtime}=evaluate(row('unrelated <private>',{truncated:true}));assert.equal(runtime.limitedContent,false);
});
test('新增所有SDK来源仍隔离进程、设备、会话、起始序列及未授权模块',()=>{
 for(const id of ids){const text=samples.find(s=>s[0]===id)[2];
  for(const patch of [{module:'UIKitCore'},{module:'OtherLibrary'},{process:'Other'},{sessionId:'old'}])assert.equal(evaluate(row(text,patch)).results.find(r=>r.testCase.id===id).status,'pending');
  assert.equal(evaluate(row(text),m,{...status,deviceKey:'ios:two'}).results.find(r=>r.testCase.id===id).status,'pending');
  assert.equal(evaluate(row(text),m,{...status,sessionId:'old'}).results.find(r=>r.testCase.id===id).status,'pending');
  assert.equal(evaluate(row(text),m,status,{...tab,testRun:{...tab.testRun,afterSequence:1}}).results.find(r=>r.testCase.id===id).status,'pending');
 }
});
test('未知原生记录推进序列但不造缺口；双通道输出按记录计数，重发同序列不重复',()=>{
 const {runtime}=evaluate(row('[Analytics] unknown'));
 const rows=[row('unrelated',{sequence:2,module:'UIKitCore'}),row(failure,{sequence:3}),row(failure,{sequence:4,module:'UnityFramework'})];
 m.advanceIosPilot(runtime,rows,{...status,receivedCount:4,emittedCount:4},1);m.advanceIosPilot(runtime,rows,{...status,receivedCount:4,emittedCount:4},2);
 assert.equal(runtime.lastSequence,4);assert.equal(runtime.incomplete,false);assert.equal(result(runtime,'ios_anticheat_runtime_fail').ruleHits[0].totalCount,2);
});
test('反作弊失败后迟到就绪保留两类原文与历史错误；新测试轮次不继承',()=>{
 const {runtime}=evaluate(row(failure));m.advanceIosPilot(runtime,[row(ready,{sequence:2})],{...status,receivedCount:2,emittedCount:2},1);
 const r=result(runtime,'ios_anticheat_init');assert.equal(r.status,'fail');assert.equal(r.ruleHits[0].totalCount,1);assert.equal(r.ruleHits[2].totalCount,1);
 const next=m.createIosPilotRuntime({...tab,testRun:{...tab.testRun,key:'next',afterSequence:2}},'ios:one');assert.equal(result(next,'ios_anticheat_init').status,'pending');
 m.advanceIosPilot(next,[row(ready,{sequence:2})],{...status,receivedCount:2,emittedCount:2},2);assert.equal(result(next,'ios_anticheat_init').status,'pending');
});
test('反作弊就绪不是长度校验，显式降级警告仍优先；不制造Android20秒计时',()=>{
 const {runtime}=evaluate(row(ready));m.advanceIosPilot(runtime,[row(degraded,{sequence:2})],{...status,receivedCount:2,emittedCount:2},1);assert.equal(result(runtime,'ios_anticheat_init').status,'suspected');
 for(const tc of m.IOS_PILOT_CASES.slice(-4))assert.ok(tc.rules.every(r=>!r.absence&&!r.minCount));
 const waiting=evaluate(row('🔗 [AntiCheating] iOSAntiCheatingLibrary 已接入，已调用 initWithOptions')).runtime;
 for(let n=500;n<=60000;n+=500)m.tickIosPilot(waiting,status,n);assert.equal(result(waiting,'ios_anticheat_init').status,'pending');
});
test('普通和内部构建均标识已授权但受限的原生 SDK 内容，未授权的内容仍忽略',()=>{
 assert.equal(m.IOS_BUSINESS_CASE_COUNT,32);assert.equal(m.IOS_PILOT_CASES.length,34);assert.deepEqual(m.IOS_PILOT_CASES.slice(-4).map(t=>t.id),ids);
 const source=row('[Analytics] <private>',{truncated:true});const d=evaluate(source,disabled);assert.equal(d.runtime.limitedContent,true);assert.equal(d.results.filter(r=>r.status==='disabled').length,1);assert.ok(d.results.every(r=>r.ruleHits.every(h=>h.totalCount===0)));
 assert.equal(evaluate(source).runtime.limitedContent,true);assert.equal(evaluate(row('[Other] <private>',{truncated:true})).runtime.limitedContent,false);
});
test('普通构建对三个 SDK 用例保留原生来源、严重度和原文证据', () => {
 for (const [id, rule, message, expected] of samples) {
  if (id === 'ios_anticheat_init' || message.startsWith('[Analytics][bridge]')) continue;
  const evidence = row(message);
  const result = evaluate(evidence, disabled).results.find(r => r.testCase.id === id);
  assert.equal(result.status, expected);
  assert.equal(result.ruleHits[rule].entries[0].raw, evidence.raw);
  const unrelated = evaluate(row(message, {module:'UIKitCore'}), disabled);
  assert.equal(unrelated.results.find(r => r.testCase.id === id).status, 'pending');
 }
 for (const message of negatives) {
  const { results } = evaluate(row(message), disabled);
  assert.ok(results.filter(r => ids.includes(r.testCase.id)).every(r => r.status === 'pending'));
 }
});
test('新增原生日志中文还原不丢原文、模块与序列，正文不可还原时不凭空判缺失',()=>{
 const chars=[...'ÄÅÇÉÑÖÜáàâäãåçéèêëíìîïñóòôöõúùûü†°¢£§•¶ß®©™´¨≠ÆØ∞±≤≥¥µ∂∑∏π∫ªºΩæø¿¡¬√ƒ≈∆«»… ÀÃÕŒœ–—“”‘’÷◊ÿŸ⁄€‹›ﬁﬂ‡·‚„‰ÂÊÁËÈÍÎÏÌÓÔÒÚÛÙıˆ˜¯˘˙˚¸˝˛ˇ'];const text='[Analytics] 📤 ❌ 事件落库失败：controlled';const broken=[...new TextEncoder().encode(text)].map(b=>b<128?String.fromCharCode(b):chars[b-128]).join('');const source=row(broken,{encodingStatus:'suspected_mojibake'});const {results}=evaluate(source);const r=results.find(r=>r.testCase.id==='ios_sdk_beyla_data_fail');assert.equal(r.status,'suspected');const e=r.ruleHits[0].entries[0];assert.equal(e.message,text);assert.equal(e.raw,source.raw);assert.equal(e.module,'Foundation');assert.equal(e.id,1);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
const require=createRequire(import.meta.url);
const {build}=createRequire(require.resolve('vite'))('esbuild');
async function load(flag){const b=await build({stdin:{contents:`export * from './src/features/ios/iosPilotMonitoring'; export * from './src/features/ios/iosPilotCases'; export * from './src/features/ios/iosBusinessCases';`,resolveDir:fileURLToPath(new URL('../../',import.meta.url))},bundle:true,write:false,platform:'node',format:'esm',define:{'import.meta.env.VITE_ENABLE_IOS_BUSINESS_CANDIDATES':JSON.stringify(flag)}});return import(`data:text/javascript;base64,${Buffer.from(b.outputFiles[0].text).toString('base64')}`);}
const [m,disabled]=await Promise.all([load('true'),load('false')]);
const tab={id:'config',kind:'test',testBundleId:m.IOS_PILOT_BUNDLE,testRun:{sessionId:'capture',afterSequence:0,key:'round'}};
const status={deviceKey:'ios:one',sessionId:'capture',state:'running',receivedCount:1,emittedCount:1,backendDroppedCount:0,storageError:null};
const prefix='[IncentiveEngineManager]: [Config] ';
const row=(message,patch={})=>({sequence:1,sessionId:'capture',timestamp:'Nov 17 12:00:00',process:'FruitQuest',module:'UnityFramework',pid:123,level:'notice',semanticLevel:null,truncated:false,encodingStatus:'valid',message,raw:`controlled:${message}`,...patch});
function evaluate(source,impl=m,st=status,t=tab){const runtime=impl.createIosPilotRuntime(t,'ios:one');impl.advanceIosPilot(runtime,[source],st,0);return {runtime,result:impl.iosPilotResults(runtime).find(r=>r.testCase.id==='ios_ie_config_missing')};}
// 都为构造分支，不是新一轮真实设备故障。
const samples=[
 ...['privacyPolicyUrl','termsOfServiceUrl','cloudConfigHost','networkConfig.prodBaseUrl','networkConfig.activityCodePrefix','levelConfig.serverConfigKey'].map(f=>[0,`${f} 未配置（必填）`,'fail']),
 ...['cloudConfigTestHost','networkConfig.testBaseUrl'].map(f=>[0,`${f} 未配置（TEST 构建必填，或由 TestEnvInjector 注入）`,'fail']),
 [0,'levelConfig.loopMinLevel 未配置或无效（必填，需 > 0）','fail'],
 [0,'uiConfig.popupPathOverrides[Withdraw] 的 prefabPath 未配置（必填）','fail'],
 ...['iaaConfig 未配置，广告功能将不可用','networkConfig 未配置，网络请求将使用默认地址','audioConfig 未配置，音效功能将静默跳过','levelConfig 未配置，关卡配置功能将不可用','levelConfig.localConfigAsset 未配置，将无本地兜底数据'].map(t=>[1,t,'suspected']),
 [2,'IncentiveEngineConfig not found at Resources/IncentiveEngineConfig，请先创建并配置该资产。','fail'],
 [3,'国家配置未勾选任何支持国家，请至少勾选 Support ID / BR / MY / PH / TH / VN。运行时将兜底为 ID。','fail'],
 [3,'defaultCountry=US 不在支持列表内，请配置为 ID / BR / MY / PH / TH / VN。运行时将回落到已勾选国家。','fail'],
 [3,'defaultCountry=BR，但 Support BR 未勾选。请勾选 Support BR，或将 defaultCountry 改为已勾选国家。运行时将回落到已勾选国家。','fail'],
];
for(const [rule,text,expected] of samples)test(`W01明确配置分支 ${text}`,()=>{const source=row(prefix+text+'\nIncentiveEngine.IncentiveEngineManager:ValidateConfig()');const r=evaluate(source).result;assert.equal(r.status,expected);assert.equal(r.ruleHits[rule].totalCount,1);const e=r.ruleHits[rule].entries[0];assert.equal(e.record,source);assert.equal(e.message,source.message);assert.equal(e.raw,source.raw);assert.equal(e.level,undefined);assert.equal(e.tag,undefined);});
const negatives=[
 'adjustToken 未配置（必填）','antiCheatingPartnerId 未配置，将使用默认值 Gameet','antiCheatingPartnerKey 未配置，将使用默认值 controlled',
 ...['maxKey','splashPid','rewardPid','interPid','mixInterPid','rewardIdCacheArr'].map(f=>`iaaConfig.${f} 未配置（必填）`),
 'unknownKey 未配置（必填）','privacyPolicyUrl 未配置，将使用默认值','国家配置正常','defaultCountry=BR 已勾选',
 'networkConfig.prodBaseUrl 已配置（必填）','cloudConfigTestHost 未配置（Release 可选）',
 'levelConfig.loopMaxLevel 必须 >= loopMinLevel','uiConfig.popupPathOverrides 存在 popupName 为空的项',
];
for(const text of negatives)test(`W01未核实平台字段或非原覆盖范围不误报: ${text}`,()=>assert.equal(evaluate(row(prefix+text)).result.status,'pending'));
test('W01来源/首行/设备/会话/开始边界隔离，不能只凭未配置或国家关键字匹配',()=>{
 const text=samples[0][1];
 for(const message of ['[Other]: [Config] '+text,'[Config] '+text,'[IncentiveEngineManager]: '+text,'Normal\n'+prefix+text,prefix+'unknown.Country 未配置（必填）'])assert.equal(evaluate(row(message)).result.status,'pending');
 for(const patch of [{module:'Foundation'},{module:'UIKitCore'},{process:'Other'},{sessionId:'old'}])assert.equal(evaluate(row(prefix+text,patch)).result.status,'pending');
 assert.equal(evaluate(row(prefix+text),m,{...status,deviceKey:'ios:two'}).result.status,'pending');
 assert.equal(evaluate(row(prefix+text),m,{...status,sessionId:'old'}).result.status,'pending');
 assert.equal(evaluate(row(prefix+text),m,status,{...tab,testRun:{...tab.testRun,afterSequence:1}}).result.status,'pending');
});
test('W01普通构建不匹配必填项缺失，内部开启28候选+2试点，未命中不判通过',()=>{
 assert.equal(m.IOS_BUSINESS_CASE_COUNT,32);assert.equal(m.IOS_PILOT_CASES.length,34);
 const r=evaluate(row(prefix+samples[0][1]),disabled).result;assert.equal(r.status,'pending');assert.ok(r.ruleHits.every(h=>!h.hit&&h.totalCount===0&&h.entries.length===0));
 const tc=m.IOS_PILOT_CASES.find(t=>t.id==='ios_ie_config_missing');assert.deepEqual(tc.scope,{global:false,apps:[m.IOS_PILOT_BUNDLE]});assert.ok(tc.rules.every(r=>r.effect!=='pass'&&!r.absence));assert.equal(evaluate(row('normal')).result.status,'pending');
});
test('W01不依赖Apple级别：error输出的可选项仍warn，warn输出的必填项仍error，重试不清历史',()=>{
 const source=row(prefix+'levelConfig 未配置，关卡配置功能将不可用',{level:'error'});const {runtime,result}=evaluate(source);assert.equal(result.status,'suspected');
 m.advanceIosPilot(runtime,[source],status,1);assert.equal(m.iosPilotResults(runtime).find(r=>r.testCase.id==='ios_ie_config_missing').ruleHits[1].totalCount,1);
 m.advanceIosPilot(runtime,[row(prefix+samples[0][1],{sequence:2,level:'warning'})],{...status,receivedCount:2,emittedCount:2},2);
 m.advanceIosPilot(runtime,[row('configuration valid',{sequence:3})],{...status,receivedCount:3,emittedCount:3},3);
 assert.equal(m.iosPilotResults(runtime).find(r=>r.testCase.id==='ios_ie_config_missing').status,'fail');
});
test('W01中文可逆还原后识别可选缺失，保留原始乱码证据',()=>{
 const chars=[...'ÄÅÇÉÑÖÜáàâäãåçéèêëíìîïñóòôöõúùûü†°¢£§•¶ß®©™´¨≠ÆØ∞±≤≥¥µ∂∑∏π∫ªºΩæø¿¡¬√ƒ≈∆«»… ÀÃÕŒœ–—“”‘’÷◊ÿŸ⁄€‹›ﬁﬂ‡·‚„‰ÂÊÁËÈÍÎÏÌÓÔÒÚÛÙıˆ˜¯˘˙˚¸˝˛ˇ'];const text=prefix+'levelConfig 未配置，关卡配置功能将不可用';const broken=[...new TextEncoder().encode(text)].map(b=>b<128?String.fromCharCode(b):chars[b-128]).join('');const source=row(broken,{encodingStatus:'suspected_mojibake'});const r=evaluate(source).result;assert.equal(r.status,'suspected');assert.equal(r.ruleHits[1].entries[0].message,text);assert.equal(r.ruleHits[1].entries[0].raw,source.raw);
});

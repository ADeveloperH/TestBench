import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
const require = createRequire(import.meta.url);
const { build } = createRequire(require.resolve('vite'))('esbuild');
const stub = `export function useState(init) { const h=globalThis.__searchPrefsHarness; const i=h.cursor++; if (!(i in h.states)) h.states[i]=typeof init==='function'?init():init; return [h.states[i], next=>{h.states[i]=typeof next==='function'?next(h.states[i]):next}]; }
export const useCallback=(fn)=>fn; export const useMemo=(fn)=>fn();
export function useEffect(fn,deps) { const h=globalThis.__searchPrefsHarness; const i=h.cursor++; const old=h.effects[i]; if (!old || !deps || deps.some((d,j)=>d!==old.deps[j])) { old?.cleanup?.(); h.effects[i]={deps}; h.pending.push(()=>{h.effects[i].cleanup=fn()}); } }`;
async function bundle(debug) {
 const result = await build({ stdin: { contents: `export * from './src/features/settings/usePrefs'; export * from './src/features/settings/sharedSearchPreferences'; export * from './src/features/settings/config'; export * from './src/core/builtinRegistry';`, resolveDir: fileURLToPath(new URL('../../',import.meta.url)) }, bundle:true, write:false, format:'esm', platform:'node', define:{'import.meta.env.DEV':String(debug),'import.meta.env.VITE_ENABLE_IOS_PROBE':'"false"'}, plugins:[{name:'react-harness',setup(b){b.onResolve({filter:/^react$/},()=>({path:'react',namespace:'harness'}));b.onLoad({filter:/.*/,namespace:'harness'},()=>({contents:stub}));}}] });
 return import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`);
}
const m=await bundle(false);
const f=(value,description='')=>({value,description});
test('迁移按 value 去重，保留顺序/说明，清空旧源且删除后不复活',()=>{
 const old={searchFavorites:[f('same','shared'),f('fill'), 'legacy-string',null], searchHistory:['android'], tagFavorites:[f('Tag')],iosLog:{favorites:[f('same','ios'),f('fill','补充说明'),f('ios-only')],history:['ios'],markerFavorites:[f('[Marker]')],markerHistory:['marker']}};
 const next=m.migrateSharedSearchFavorites(old);
 assert.deepEqual(next.searchFavorites,[f('same','shared'),f('fill','补充说明'),f('legacy-string'),f('ios-only')]);
 assert.equal(old.iosLog.favorites.length,3);
 assert.deepEqual(next.iosLog.favorites,[]);
 assert.deepEqual(next.searchHistory,['android']); assert.deepEqual(next.iosLog.history,['ios']);
 assert.deepEqual(next.tagFavorites,[f('Tag')]);assert.deepEqual(next.iosLog.markerFavorites,[f('[Marker]')]);
 assert.deepEqual(m.migrateSharedSearchFavorites(next),next);
 const removed={...next,searchFavorites:next.searchFavorites.filter(x=>x.value!=='ios-only')};
 assert.ok(!m.migrateSharedSearchFavorites(removed).searchFavorites.some(x=>x.value==='ios-only'));
});
test('version 2 导入合并先迁移双方，本地 iOS 收藏优先于导入同名共享项，反复导入幂等',()=>{
 const parse=prefs=>m.parseImportConfig(JSON.stringify({version:2,prefs}));
 const local=parse({iosLog:{favorites:[f('same','local-ios')],history:['ios-local']},searchHistory:['android-local']});
 const incoming=parse({searchFavorites:[f('same','incoming'),f('new')],iosLog:{favorites:[f('legacy-ios')],history:['ios-incoming']},searchHistory:['android-incoming']});
 const merged=m.mergeConfig(local,incoming);
 assert.deepEqual(merged.prefs.searchFavorites,[f('same','local-ios'),f('new'),f('legacy-ios')]);
 assert.deepEqual(merged.prefs.iosLog.favorites,[]);
 assert.deepEqual(merged.prefs.searchHistory,['android-local','android-incoming']);
 assert.deepEqual(merged.prefs.iosLog.history,['ios-local','ios-incoming']);
 assert.deepEqual(m.mergeConfig(merged,incoming).prefs,merged.prefs);
 const exported=m.buildExportConfig(merged.prefs,[],[]);
 assert.equal(exported.version,2);assert.deepEqual(m.parseImportConfig(JSON.stringify(exported)).prefs,merged.prefs);
});
for(const debug of [false,true]) test(`真实 usePrefs：本地迁移/共享增删/重启/远程刷新/历史隔离/内置保护，DEV=${debug}`,async()=>{
 const api=debug?await bundle(true):m;
 const storage=new Map([['logcat-prefs-v1',JSON.stringify({searchFavorites:[f('shared')],searchHistory:['android'],iosLog:{favorites:[f('ios-only')],history:['ios'],markerFavorites:[f('[Marker]')]}})]]);
 globalThis.localStorage={getItem:k=>storage.get(k)??null,setItem:(k,v)=>storage.set(k,v)};
 const reset=()=>{globalThis.__searchPrefsHarness={cursor:0,states:[],effects:[],pending:[]};};
 const render=()=>{const h=globalThis.__searchPrefsHarness;h.cursor=0;const p=api.usePrefs();h.pending.splice(0).forEach(fn=>fn());return p;};
 const clean=()=>{globalThis.__searchPrefsHarness.effects.forEach(e=>e?.cleanup?.());};
 api.applyBuiltins({...api.getCodeBuiltins(),searchFavorites:[f('builtin','remote')]});
 reset(); let p=render();p=render();
 assert.ok(p.prefs.searchFavorites.some(x=>x.value==='ios-only'));assert.deepEqual(p.prefs.iosLog.favorites,[]);
 p.addFavorite('search','from-ios','保存');p=render();assert.equal(p.prefs.searchFavorites.find(x=>x.value==='from-ios').description,'保存');
 p.addHistory('search','android-new');p.updateIosLog(current=>({...current,history:['ios-new',...current.history]}));p=render();
 assert.deepEqual(p.prefs.searchHistory,['android-new','android']);assert.deepEqual(p.prefs.iosLog.history,['ios-new','ios']);
 p.removeFavorite('search','ios-only');p=render();clean();reset();p=render();p=render();
 assert.ok(!p.prefs.searchFavorites.some(x=>x.value==='ios-only'));
 p.removeFavorite('search','builtin');p=render();
 assert.equal(p.prefs.searchFavorites.some(x=>x.value==='builtin'),!debug);
 api.applyBuiltins({...api.getCodeBuiltins(),searchFavorites:[f('builtin','updated'),f('new-builtin')]});p=render();
 assert.equal(p.prefs.searchFavorites.some(x=>x.value==='builtin'),!debug);
 assert.ok(p.prefs.searchFavorites.some(x=>x.value==='new-builtin'));
 assert.ok(p.prefs.searchFavorites.some(x=>x.value==='from-ios'));assert.deepEqual(p.prefs.iosLog.markerFavorites,[f('[Marker]')]);
 assert.ok(!p.prefs.searchFavorites.some(x=>x.value==='ios-only'));
 clean();api.resetBuiltinsToCode();
});

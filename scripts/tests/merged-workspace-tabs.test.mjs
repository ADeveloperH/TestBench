import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
const require=createRequire(import.meta.url);
const {build}=createRequire(require.resolve('vite'))('esbuild');
const React=require('react');
const {renderToStaticMarkup}=require('react-dom/server');
const bundle=await build({stdin:{contents:"export {LogTabs} from './src/features/logcat/LogTabs';",resolveDir:fileURLToPath(new URL('../../',import.meta.url))},bundle:true,write:false,format:'cjs',platform:'node',external:['react','react/jsx-runtime']});
const mod={exports:{}};new Function('module','exports','require',bundle.outputFiles[0].text)(mod,mod.exports,require);
const props={tabs:[{id:'one',name:'普通日志',kind:'log',pausedAtId:null},{id:'two',name:'自动化',kind:'automation',pausedAtId:null}],activeTabId:'one',onSelect(){},onCreateLog(){},onClose(){},onRename(){}};
test('共享Tab组件兼容iOS的可选创建回调与禁用测试能力，不要求自动化接口',()=>{
 const html=renderToStaticMarkup(React.createElement(mod.exports.LogTabs,{...props,tabs:[props.tabs[0]],canCreateLog:false,canCreateTest:false}));
 assert.match(html,/普通日志/);assert.doesNotMatch(html,/log-tab-automation/);
});
test('Android自动化运行Tab不能关闭，普通Tab仍可关闭',()=>{
 const html=renderToStaticMarkup(React.createElement(mod.exports.LogTabs,{...props,runningTabId:'two',onCreateAutomation(){}}));
 assert.match(html,/log-tab-automation/);
 assert.match(html,/<button[^>]*disabled=""[^>]*title="请先停止自动化运行"[^>]*aria-label="关闭 自动化"/);
 assert.doesNotMatch(html,/<button[^>]*disabled=""[^>]*aria-label="关闭 普通日志"/);
});

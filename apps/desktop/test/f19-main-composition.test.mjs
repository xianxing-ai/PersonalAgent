import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {isDeepStrictEqual} from 'node:util';

const source=readFileSync(new URL('../electron/main.js',import.meta.url),'utf8');
const block=(start,end)=>{const a=source.indexOf(start),b=source.indexOf(end,a);assert.ok(a>=0&&b>a);return source.slice(a,b);};

test('actual Main F19 assembly keeps original hosts and lazy Runtime, and native selection rejects a replaced window',async()=>{
  const workspace={bindingId:'original',rootPath:'original-workspace'},application={original:true};
  let configurationOptions,options,closed=0,selected,finish;
  const config={snapshot:()=>({revision:'original-revision'})},ports={original:true};
  const context={f19IssueCases:{close(){closed++;}},f19Workflow:undefined,f19ActiveRevision:undefined,runtimeApplication:undefined,
    app:{getPath:()=> 'original-user-data'},safeStorage:{original:true},agentArtsPinned:true,
    codingWorkspace:{readDeveloperConfiguration:()=>workspace},developerDeployment:{snapshot:()=>({configured:true,repository:'original/repo'})},
    nativeExecutionHost:{original:true},authorizeWorkflowExport:async()=>true,toolPresenceHost:{requestPresence:value=>value},
    admin:{isDestroyed:()=>false},dialog:{showOpenDialog:async owner=>{selected=owner;return new Promise(resolve=>{finish=resolve;});}},
    createF19IssueConfiguration:value=>{configurationOptions=value;return config;},
    createConfiguredDesktopF19IssueRepairPorts:value=>{options=value;return ports;}};
  runInNewContext(block('f19IssueCases?.close();','f24Workflow=agentArtsPinned?'),context);
  assert.equal(closed,1);assert.equal(context.f19Workflow,ports);assert.equal(options.nativeExecutionHost,context.nativeExecutionHost);
  assert.equal(options.codingWorkspace,context.codingWorkspace);assert.equal(options.developerDeployment,context.developerDeployment);
  assert.equal(options.issueConfiguration,config);assert.equal(options.authorizeExport,context.authorizeWorkflowExport);
  assert.equal(options.getApplication(),undefined);context.runtimeApplication=application;assert.equal(options.getApplication(),application);
  assert.equal(configurationOptions.readWorkspace(),workspace);assert.equal(configurationOptions.readRepositoryBinding().bindingId,'original');
  const pending=configurationOptions.selectFile();assert.equal(selected,context.admin);context.admin={isDestroyed:()=>false};
  finish({canceled:false,filePaths:['never-accepted.json']});await assert.rejects(pending,/原设置窗口或任务状态已变化/);
});

test('actual Main deduplicates only identical F18/F19 shared reads and preserves both original write tools',()=>{
  const names=['github.issue_snapshot','github.merged_pr_readback','github.issue_close_readback'];
  const tool=name=>({descriptor:{name,version:'1.0.0',sideEffect:'read'},execute(){}});
  const left=names.map(tool),right=names.map(tool),merge=tool('github.registered_merge'),close=tool('github.registered_close_issue');
  const code=block('const sharedF19Reads=','if(computerControlLease)');
  const context={f18Workflow:{tools:[...left,merge]},f19Workflow:{tools:[...right,close]},conversationTools:[...left,merge],isDeepStrictEqual};
  runInNewContext(code,context);assert.deepEqual(context.conversationTools,[...left,merge,close]);
  right[0].descriptor.version='other';assert.throws(()=>runInNewContext(code,{...context}),/原部署只读工具描述不一致/);
  const single={...context,f18Workflow:undefined,conversationTools:[]};runInNewContext(code,single);
  assert.deepEqual(single.conversationTools,[...right,close]);
});

test('actual Main F19 settings allow only inactive original admin native selection with no renderer payload',async()=>{
  let selections=0,published=0;const admin={};
  const context={name:'coding.f19.select',sender:admin,admin,competitionMode:true,syntheticMvp:false,codingWorkspace:{},
    f19IssueCases:{selectFromNativeDialog:async()=>{selections++;}},f19Snapshot:()=>({selectionAvailable:true}),
    payload:undefined,runtimeApplication:{activeTaskCount:0},publish:()=>{published++;},codingSettingsSnapshot:()=>({original:true}),
    ProtocolError:class extends Error{constructor(code,message){super(message);this.code=code;}}};
  const run=()=>runInNewContext('(async()=>{'+block("if(name==='coding.f19.select')","if(name==='coding.f20.configure')")+'})()',context);
  for(const patch of [{sender:{}},{payload:{path:'renderer.json'}},{runtimeApplication:{activeTaskCount:1}},{syntheticMvp:true}]){
    const original={...context};Object.assign(context,patch);await assert.rejects(run());Object.assign(context,original);
  }
  assert.equal(selections,0);assert.equal((await run()).coding.original,true);assert.equal(selections,1);assert.equal(published,1);
});

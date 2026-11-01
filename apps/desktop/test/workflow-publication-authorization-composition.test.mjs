import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

// Actual Main callback; the participating hosts are explicit Fakes. This does
// not establish a native gesture, a user approval, or a real external write.
const text=readFileSync(new URL('../electron/main.js',import.meta.url),'utf8');
const ast=ts.createSourceFile('main.js',text,ts.ScriptTarget.Latest,true,ts.ScriptKind.JS),callbacks=[];
function visit(node){
  if(ts.isPropertyAssignment(node)&&node.name.getText(ast)==='requestToolAuthorization'
    &&ts.isArrowFunction(node.initializer)&&node.initializer.getText(ast).includes('prepareWorkflowHostPreflight'))
    callbacks.push(node.initializer.getText(ast));
  ts.forEachChild(node,visit);
}
visit(ast);assert.equal(callbacks.length,1);

test('Main requires original decision before F16/F18 presence, and a failed presence cannot return allow_once',async()=>{
  for(const decision of ['deny','cancel','allow_once'])for(const failure of [false,true]){
    const events=[],scope={toolName:'github.registered_merge',taskId:'original-task',runId:'original-run'};
    const record=name=>value=>{assert.equal(value,scope);events.push(name);};
    const context=vm.createContext({runtimeApplication:{},prepareWorkflowToolExport:undefined,
      prepareWorkflowHostPreflight:async value=>{assert.equal(value.scope,scope);events.push('preflight');},
      f16F17Workflow:{preparePublicationQuestion:record('f16.prepare'),confirmPublicationPresence:record('f16.presence')},
      f18Workflow:{prepareMergeQuestion:record('f18.prepare'),confirmMergePresence:async value=>{
        record('f18.presence')(value);if(failure)throw Error('original presence changed');}},
      authorizationIntentHost:{prepareQuestion:record('intent')},computerTasks:new Set(),
      calendarMeetingHost:undefined,mailHost:undefined,mailAnalysisHost:undefined,codingWorkspace:undefined,knowledgeSourceConfig:undefined,
      prepareConfiguredWorkflowDecisionQuestion:()=>false,notificationApplicationHost:undefined,connectorWatchHost:undefined,feedsHost:undefined,
      authorizationQuestionHost:{requiresNativeForAuthorization:()=>true,requestToolAuthorization:async value=>{
        record('decision')(value);return decision;}},
      nativeExecutionHost:{prepare:async(value,options)=>{record('native')(value);assert.equal(options.forTaskConsent,true);}}});
    const run=vm.runInContext(`(${callbacks[0]})`,context);
    if(decision==='allow_once'&&failure)await assert.rejects(run(scope),/original presence changed/);
    else assert.equal(await run(scope),decision);
    assert.deepEqual(events,['preflight','f16.prepare','f18.prepare','intent','native','decision',
      ...(decision==='allow_once'?['f16.presence','f18.presence']:[])]);
  }
});

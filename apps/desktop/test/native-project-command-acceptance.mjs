// Explicit real Windows process-boundary check, not a UI, cloud or Policy acceptance.
import assert from 'node:assert/strict';
import {createHash,randomUUID} from 'node:crypto';
import {mkdir,mkdtemp,readFile,realpath,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import * as coding from '@personal-agent/coding-tools';
import {TaskRuntime} from '@personal-agent/runtime';
import {toolArgumentsDigest} from '@personal-agent/tool-gateway';
import {createDesktopNativeExecutionHost} from '../electron/native-execution-host.js';
import {buildWorkspaceCommandRecipes} from '../electron/workspace-command-recipes.js';

assert.equal(process.env.PA_NATIVE_PROJECT_COMMAND_ACCEPTANCE,'1','Explicit real native-process opt-in is required');
assert.equal(process.platform,'win32');
const root=fileURLToPath(new URL('../../../',import.meta.url));
assert.equal(process.version,'v'+(await readFile(path.join(root,'.node-version'),'utf8')).trim());
const node=await realpath(process.env.PA_NATIVE_PROJECT_NODE??process.execPath);
assert.ok(process.env.PA_NATIVE_PROJECT_HELPER&&path.isAbsolute(process.env.PA_NATIVE_PROJECT_HELPER),'Select a trusted native helper');
const helper=await realpath(process.env.PA_NATIVE_PROJECT_HELPER);
const base=path.join(root,'.cache');await mkdir(base,{recursive:true});
const directory=await mkdtemp(path.join(base,'native-project-command-')),workspace=path.join(directory,'workspace');
await mkdir(workspace);
const sources={'metric.cjs':'module.exports = value => value + 1;\n',
  'project.test.cjs':"const assert=require('node:assert/strict');const test=require('node:test');const metric=require('./metric.cjs');test('public project check',()=>assert.equal(metric(2),3));console.log('native-project-command:real-node-child');\n",
  'package.json':JSON.stringify({name:'public-native-command-acceptance',private:true,scripts:{test:'node --test'}})+'\n'};
for(const [name,body]of Object.entries(sources))await writeFile(path.join(workspace,name),body,{flag:'wx'});
const canonicalRoot=await realpath(workspace),runtime=new TaskRuntime(':memory:');
const task=runtime.submitTask({goal:'Explicit public native project-command fixture',conversationId:'native-project-command',idempotencyKey:'original'});
runtime.transitionTask(task.taskId,'planning');runtime.transitionTask(task.taskId,'running');
const input={recipeId:'npm-test'},runId=randomUUID(),deadline=new Date(Date.now()+60_000).toISOString();
const scope={taskId:task.taskId,runId,toolName:'workspace.npm_test',argumentsDigest:toolArgumentsDigest(input),
  deadline,signal:new AbortController().signal};
const report={schemaVersion:1,kind:'real_native_project_command_profile',startedAt:new Date().toISOString(),
  publicFixture:true,fakeNativeExecutor:false,questionHost:'explicit_synthetic_original_scope',
  runtimePolicyAcceptance:'not_run',cloudCalls:0,physicalHumanClick:'not_run',helperSourceBuildProvenance:'not_reestablished'};
const same=current=>current.taskId===scope.taskId&&current.runId===scope.runId;
const policy={ref:'explicit-native-project-policy',revision:1,mode:'workspace-write'};
const host=createDesktopNativeExecutionHost({coding,
  readConfiguration:()=>({rootPath:canonicalRoot,nodeExecutable:node,bindingId:'explicit-native-project-binding'}),
  ensureHelper:async()=>helper,probeRootPath:directory,systemRoot:process.env.SystemRoot,localAppData:directory,
  getApplication:()=>({runtime,readAuthorizationQuestionInvocation:(taskId,originalRun)=>
    taskId===scope.taskId&&originalRun===runId?{}:undefined}),
  question:{prepare(current,{assertCurrent}){assert.equal(same(current),true);assert.equal(assertCurrent(),true);},
    readExecutionPolicy:current=>{assert.equal(same(current),true);return policy;},
    currentRequirement:current=>assert.equal(same(current),true)}});
try {
  await host.prepare(scope);
  const {recipes}=buildWorkspaceCommandRecipes({workspaceRoot:canonicalRoot,authorizedWorkspaceRoot:canonicalRoot,
    nodeExecutable:node,jobHelperExecutable:helper,npmCliPath:path.join(path.dirname(node),'node_modules/npm/bin/npm-cli.js'),
    allowProjectScripts:true,nativeNodeResolution:true,checkFiles:[]});
  assert.equal(recipes.length,1);assert.equal(recipes[0].id,'npm-test');
  const tool=host.createCommandTool({rootPath:canonicalRoot,recipes,maxDurationMs:30_000});
  const result=await tool.execute(input,{...scope,authorizationRef:runId,scopes:['workspace:execute']});
  await writeFile(path.join(directory,'public-command-result.json'),JSON.stringify(result,null,2)+'\n');
  assert.equal(result.exitCode,0,result.stderr);assert.match(result.stdout,/native-project-command:real-node-child/);
  assert.match(result.stdout,/pass 1\b/);
  const [execution]=runtime.loadCheckpoint(task.taskId,'native-sandbox-execution:'+runId);
  assert.equal(execution.backend,'windows-psec');assert.equal(execution.enforced,true);
  assert.equal(execution.executionStarted,true);assert.equal(execution.stopped,true);assert.equal(execution.exitCode,0);
  for(const [name,body]of Object.entries(sources))assert.equal(await readFile(path.join(workspace,name),'utf8'),body);
  Object.assign(report,{status:'passed',nodeVersion:process.version,onlyProjectRecipe:true,sourceFilesUnchanged:true,
    helperSha256:coding.readWindowsNativeHelperAttestation(helper).helperSha256,execution,
    nativeHostSourceSha256:createHash('sha256').update(await readFile(new URL('../electron/native-execution-host.js',import.meta.url))).digest('hex')});
}catch(error){report.status='failed';report.errorCode=error?.code??'NATIVE_ACCEPTANCE_FAILED';throw error;}
finally{host.close();runtime.close();report.finishedAt=new Date().toISOString();
  await writeFile(path.join(directory,'receipt.json'),JSON.stringify(report,null,2)+'\n');
  console.log(JSON.stringify({status:report.status,receipt:path.join(directory,'receipt.json')}));}

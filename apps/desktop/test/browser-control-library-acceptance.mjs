// Explicit manual library acceptance: real visible Chromium + synthetic local page.
// This does not use accounts, AgentArts, a model, or prove the real Runtime/Policy loop.
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {randomUUID} from 'node:crypto';
import {mkdir,writeFile} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import * as playwright from 'playwright';
import {toolArgumentsDigest} from '@personal-agent/tool-gateway';
import {createBrowserControlHost} from '../electron/browser-control-host.js';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../../..');
const directory=path.join(root,'.cache','browser-control-acceptance',randomUUID());
await mkdir(directory,{recursive:true});
const server=createServer((_request,response)=>{response.writeHead(200,{'content-type':'text/html; charset=utf-8'});
  response.end('<!doctype html><title>PersonalAgent synthetic browser acceptance</title><h1>Synthetic fixture</h1>'
    +'<label>Note <input aria-label="Note" type="text"></label><button id="add">Add note</button><p id="result">No note yet</p>'
    +'<label>Password <input type="password" value="fixture-secret"></label>'
    +'<script>document.querySelector("#add").onclick=()=>document.querySelector("#result").textContent="Saved fixture: "+document.querySelector("input").value</script>');});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const origin='http://127.0.0.1:'+server.address().port,deadline=new Date(Date.now()+60_000).toISOString();
const records=new Map(),checkpoints=new Map(),signal=new AbortController().signal;
const runtime={listTasks:()=>({items:[]}),getTask:()=>({state:'running'}),
  readToolExecutions:taskId=>[...records.values()].filter(run=>run.taskId===taskId),
  loadCheckpoint:(_task,key)=>key==='application-deadline'?deadline:undefined,
  matchesToolExecutionInput:(record,input)=>record.digest===toolArgumentsDigest(input.arguments)&&record.authorizationRef===input.scopeRef,
  saveCheckpointOnce(taskId,key,value){const id=taskId+':'+key;if(checkpoints.has(id))return false;checkpoints.set(id,value);return true;}};
const permissions=[];
const browserChannel=existsSync(playwright.chromium.executablePath())?'bundled-chromium':'msedge';
const driver={chromium:{launchPersistentContext:(profile,options)=>playwright.chromium.launchPersistentContext(profile,
  {...options,...(browserChannel==='msedge'?{channel:'msedge'}:{})})}};
const host=createBrowserControlHost({userDataPath:directory,playwright:driver,testOnlyAllowedOrigins:[origin],
  authorizePresence:async request=>{permissions.push({phase:request.phase,toolName:request.toolName});return request.origin===undefined||request.origin===origin;}});
host.bind({runtime});
let sequence=0;
async function invoke(name,args={}) {
  const runId='fixture-'+(++sequence),toolName='browser.'+name,authorizationRef='fixture-grant-'+sequence;
  const scope={taskId:'synthetic-browser-acceptance',runId,authorizationRef,argumentsDigest:toolArgumentsDigest(args),deadline,signal,scopes:['browser:control']};
  records.set(runId,{taskId:scope.taskId,evidenceId:runId,toolName,toolVersion:'1.0.0',state:'started',policyDecision:'allow',executionStarted:true,
    authorizationRef,digest:scope.argumentsDigest});
  const result=await host.tools.find(tool=>tool.descriptor.name===toolName).execute(args,scope);
  return host.competitionToolExports.find(policy=>policy.toolName===toolName).project({taskId:scope.taskId,proposalId:runId,result,signal});
}
try {
  const opened=await invoke('open',{url:origin});
  assert.equal(opened.controls.some(control=>control.inputType==='password'),false);
  const note=opened.controls.find(control=>control.name==='Note');assert.ok(note);
  const typed=await invoke('type',{targetRef:opened.targetRef,ref:note.ref,text:'hello from controlled Playwright'});
  const add=typed.controls.find(control=>control.name==='Add note');assert.ok(add);
  const clicked=await invoke('click',{targetRef:typed.targetRef,ref:add.ref});
  assert.ok(clicked.text.includes('Saved fixture: hello from controlled Playwright'));
  const screenshot=await invoke('screenshot',{targetRef:clicked.targetRef});
  const image=await host.readScreenshotArtifact({artifactId:screenshot.artifact.artifactId,taskId:'synthetic-browser-acceptance',signal,deadline});
  assert.deepEqual([...image.bytes.subarray(0,8)],[137,80,78,71,13,10,26,10]);
  assert.equal((await invoke('close')).state,'closed');
  assert.equal((await host.stop()).connected,false);
  const receipt={evidenceLevel:'real_playwright_synthetic_page_with_runtime_fixture',recordedAt:new Date().toISOString(),
    realRuntimePolicyAgentArtsAcceptance:'not_run',accountsUsed:false,modelCalls:0,visibleBrowser:true,browserChannel,
    checks:{openObserveTypeClickReadback:true,passwordControlExcluded:true,screenshotMetadataOnly:true,
      screenshotTrustedByteRead:true,ownedBrowserClosed:true},writeCheckpoints:checkpoints.size,permissionChecks:permissions.length,
    artifact:screenshot.artifact};
  const receiptPath=path.join(directory,'receipt.json');await writeFile(receiptPath,JSON.stringify(receipt,null,2)+'\n');
  console.log(JSON.stringify({receiptPath,...receipt},null,2));
}finally{await host.close();await new Promise(resolve=>server.close(resolve));}

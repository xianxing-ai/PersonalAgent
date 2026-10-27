// Manual: real visible browser + public-network guard's explicit synthetic origin.
// Runtime records are fixtures; this does not prove AgentArts/real Runtime acceptance.
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {randomUUID,createHash} from 'node:crypto';
import {mkdir,writeFile,readFile,readdir} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {gzipSync} from 'node:zlib';
import * as playwright from 'playwright';
import {ToolNotStartedError} from '@personal-agent/contracts';
import {toolArgumentsDigest} from '@personal-agent/tool-gateway';
import {createBrowserControlHost} from '../electron/browser-control-host.js';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../../..');
const directory=path.join(root,'.cache','browser-control-download-acceptance',randomUUID()),downloadDirectory=path.join(directory,'downloads');
await mkdir(directory,{recursive:true});const payload=Buffer.from('synthetic attachment only\n');
let origin,largeRequests=0,gzipRequests=0;
const server=createServer((request,response)=>{
  if(request.url==='/attachment'){
    response.writeHead(200,{'content-type':'application/octet-stream','content-disposition':'attachment; filename="fixture.txt"','content-length':payload.length});response.end(payload);
  }else if(request.url==='/gzip'){
    gzipRequests++;const bytes=gzipSync(Buffer.alloc(262144,65));
    response.writeHead(200,{'content-type':'application/octet-stream','content-encoding':'gzip','content-disposition':'attachment; filename="expanded.txt"','content-length':bytes.length});response.end(bytes);
  }else if(request.url==='/large'){
    largeRequests++;response.writeHead(200,{'content-type':'application/octet-stream','content-disposition':'attachment; filename="large.bin"','content-length':32768});
    response.end(Buffer.alloc(32768,65));
  }else{
    response.writeHead(200,{'content-type':'text/html; charset=utf-8'});
    response.end('<!doctype html><title>Controlled download fixture</title><h1>Synthetic fixture</h1>'
      +'<a href="/attachment" download="fixture.txt">Small attachment</a> '
      +'<a href="/large" download="large.bin">Oversized attachment</a> '
      +'<a href="/gzip" download="expanded.txt">Compressed attachment</a> '
      +'<a href="http://127.0.0.1:1/private" download>Different origin</a>');
  }
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));origin='http://127.0.0.1:'+server.address().port;
const deadline=new Date(Date.now()+60_000).toISOString(),signal=new AbortController().signal,records=new Map(),checkpoints=new Map();
const runtime={listTasks:()=>({items:[]}),getTask:()=>({state:'running'}),
  readToolExecutions:taskId=>[...records.values()].filter(record=>record.taskId===taskId),
  loadCheckpoint:(_task,key)=>key==='application-deadline'?deadline:undefined,
  matchesToolExecutionInput:(record,input)=>record.digest===toolArgumentsDigest(input.arguments)&&record.authorizationRef===input.scopeRef,
  saveCheckpointOnce(taskId,key,value){const id=taskId+':'+key;if(checkpoints.has(id))return false;checkpoints.set(id,value);return true;}};
const browserChannel=existsSync(playwright.chromium.executablePath())?'bundled-chromium':'msedge';
const driver={chromium:{launchPersistentContext:(profile,options)=>playwright.chromium.launchPersistentContext(profile,
  {...options,...(browserChannel==='msedge'?{channel:'msedge'}:{})})}};
let taskId='synthetic-download-acceptance',host=createBrowserControlHost({userDataPath:directory,downloadDirectory,maxDownloadBytes:4096,playwright:driver,
  testOnlyAllowedOrigins:[origin],authorizePresence:async request=>request.origin===undefined||request.origin===origin});host.bind({runtime});
let sequence=0;
async function invoke(name,args={}){
  const runId='download-fixture-'+(++sequence),authorizationRef='fixture-grant-'+sequence,toolName='browser.'+name;
  const scope={taskId,runId,authorizationRef,argumentsDigest:toolArgumentsDigest(args),deadline,signal,scopes:['browser:control']};
  records.set(runId,{taskId:scope.taskId,evidenceId:runId,toolName,toolVersion:'1.0.0',state:'started',policyDecision:'allow',executionStarted:true,
    authorizationRef,digest:scope.argumentsDigest});
  const result=await host.tools.find(tool=>tool.descriptor.name===toolName).execute(args,scope);
  return host.competitionToolExports.find(policy=>policy.toolName===toolName).project({taskId:scope.taskId,proposalId:runId,result,signal});
}
try{
  const opened=await invoke('open',{url:origin});
  const external=opened.controls.find(control=>control.name==='Different origin');
  await assert.rejects(invoke('download',{targetRef:opened.targetRef,ref:external.ref}),error=>error instanceof ToolNotStartedError&&error.code==='UNAUTHORIZED');
  const link=opened.controls.find(control=>control.name==='Small attachment');assert.ok(link);
  const result=await invoke('download',{targetRef:opened.targetRef,ref:link.ref});assert.equal(result.state,'downloaded');
  assert.equal(result.artifact.byteLength,payload.length);assert.equal(result.artifact.sha256,createHash('sha256').update(payload).digest('hex'));
  assert.deepEqual(Object.keys(result.artifact).sort(),['artifactId','byteLength','name','sha256']);
  assert.equal(JSON.stringify(result).includes(directory),false);assert.equal(JSON.stringify(result).includes(payload.toString()),false);
  const files=await readdir(downloadDirectory);assert.equal(files.length,1);assert.deepEqual(await readFile(path.join(downloadDirectory,files[0])),payload);
  await assert.rejects(invoke('download',{targetRef:opened.targetRef,ref:link.ref}),error=>error instanceof ToolNotStartedError);
  const current=await invoke('observe'),large=current.controls.find(control=>control.name==='Oversized attachment');
  await assert.rejects(invoke('download',{targetRef:current.targetRef,ref:large.ref}),{code:'RESULT_UNKNOWN'});
  assert.equal(host.snapshot().state,'blocked');assert.equal(largeRequests,1);
  assert.equal((await readdir(downloadDirectory)).filter(name=>name.startsWith('.pa-download-')).length,0);
  await host.close();
  // An independent synthetic task/profile tests compressed-response rejection;
  // it never resumes or replays the preceding unknown oversized operation.
  taskId='synthetic-compression-rejection';const compressionDirectory=path.join(directory,'compression-case');
  host=createBrowserControlHost({userDataPath:compressionDirectory,maxDownloadBytes:4096,playwright:driver,testOnlyAllowedOrigins:[origin],
    authorizePresence:async request=>request.origin===undefined||request.origin===origin});host.bind({runtime});
  const compressionPage=await invoke('open',{url:origin}),compressed=compressionPage.controls.find(control=>control.name==='Compressed attachment');
  await assert.rejects(invoke('download',{targetRef:compressionPage.targetRef,ref:compressed.ref}),{code:'RESULT_UNKNOWN'});
  assert.match(host.snapshot().failure.message,/响应编码/);assert.equal(gzipRequests,1);
  assert.deepEqual(await readdir(path.join(compressionDirectory,'downloads')),[]);await host.close();
  const receipt={evidenceLevel:'real_playwright_synthetic_download_with_runtime_fixture',recordedAt:new Date().toISOString(),browserChannel,
    accountsUsed:false,modelCalls:0,realRuntimePolicyAgentArtsAcceptance:'not_run',visibleBrowser:true,
    checks:{sameOriginAttachmentSaved:true,artifactHashReadback:true,metadataOnly:true,noAutomaticOpenOrExecution:true,
      crossOriginRejectedBeforeDispatch:true,targetRefReplayRejected:true,oversizedDownloadCancelledUnknown:true,
      unknownBlocksReplay:true,compressedResponseRejectedAtHeaderGate:true,partialDirectoriesRemoved:true,ownedBrowserClosed:true},maxDownloadBytes:4096,artifact:result.artifact};
  const receiptPath=path.join(directory,'receipt.json');await writeFile(receiptPath,JSON.stringify(receipt,null,2)+'\n');console.log(JSON.stringify({receiptPath,...receipt},null,2));
}finally{await host.close();await new Promise(resolve=>server.close(resolve));}

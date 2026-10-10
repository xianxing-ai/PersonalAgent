import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import {EventEmitter} from 'node:events';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import * as fs from 'node:fs';
import {mkdtemp,readFile,writeFile,rm,mkdir} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import * as url from 'node:url';
import * as crypto from 'node:crypto';
import {AgentArtsCloudAgentPort} from '@personal-agent/coordination';

const filename=url.fileURLToPath(import.meta.url),support=path.dirname(filename),run=promisify(execFile);
const unknownScenarios=['timeout','cancelled','network-error','http-503','unreadable-200','malformed-200'];
async function syntheticCall(scenario){
  // Original Host and wrapper source, actual public CloudAgentPort and real
  // synthetic lock. Electron, configuration, spawn and cloud transport are Fake.
  // This does not run native Electron or read any saved user configuration.
  const directory=await mkdtemp(path.join(os.tmpdir(),'saved-agentarts-control-'));
  try {
    const virtualSupport=path.join(directory,'tests/manual/agentarts/support'),cache=path.join(directory,'.cache/agentarts-development');
    await mkdir(virtualSupport,{recursive:true});await mkdir(cache,{recursive:true});
    const inputFile=path.join(directory,'public-request.json'),lock=path.join(cache,'call.lock');
    const input={goal:'Synthetic public request',deadline:new Date(Date.now()+1000).toISOString(),
      dataClass:scenario==='invalid-input'?'private':'synthetic',responseMode:'text'};
    await writeFile(inputFile,JSON.stringify(input));
    if(scenario==='existing-lock')await writeFile(lock,'synthetic existing unknown lock\n');
    const originalHost=await readFile(path.join(support,'saved-config-call-host.cjs'),'utf8');
    const originalWrapper=await readFile(path.join(support,'run-saved-config-call.mjs'),'utf8');
    let networkCalls=0,spawnCalls=0,hostController;const reports=[];
    class RealmPort extends AgentArtsCloudAgentPort {
      // VM prototypes are intentionally rejected by the public validator. Only
      // data objects are rehomed; invocation and deadline controls stay actual.
      constructor(options,...ports){super({...options},...ports);}
      invoke(options){return super.invoke({...options});}
    }
    class HostAbortController extends AbortController {constructor(){super();hostController=this;}}
    const binding={gatewayUrl:'https://synthetic-agentarts.invalid',runtimeName:'synthetic'};
    const moduleFor=async(exports,context)=>{
      const module=new vm.SyntheticModule(Object.keys(exports),function(){for(const [key,value] of Object.entries(exports))this.setExport(key,value);},{context});
      await module.link(()=>{});await module.evaluate();return module;
    };
    const launchHost=async()=>{
      let resolveExit;const exited=new Promise(resolve=>resolveExit=resolve);
      const hostFs={...fs,existsSync:name=>name.endsWith('Local State')?true:fs.existsSync(name),copyFileSync(){}};
      const electron={app:{setPath(){},whenReady:()=>Promise.resolve(),exit:resolveExit},safeStorage:{},
        session:{defaultSession:{resolveProxy:async()=>'DIRECT'}},net:{fetch:async()=>{
          networkCalls++;
          if(scenario==='network-error')throw Error('synthetic-private-network-error');
          if(scenario==='timeout'||scenario==='cancelled'){
            if(scenario==='cancelled')setImmediate(()=>hostController.abort());
            return new Promise(()=>{});
          }
          if(scenario==='known-401'||scenario==='known-403')return new Response('synthetic-private-response-not-for-output',
            {status:scenario==='known-401'?401:403});
          if(scenario==='http-503')return new Response('synthetic-private-service-error',{status:503});
          if(scenario==='unreadable-200')return new Response(new ReadableStream({start(controller){controller.error(Error('synthetic-private-read-error'));}}),
            {headers:{'content-type':'application/json'}});
          if(scenario==='malformed-200')return new Response('synthetic-private-invalid-result',{headers:{'content-type':'application/json'}});
          return new Response(JSON.stringify([{event:'message',data:{text:'Synthetic terminal reply'}},{event:'task_end'},{event:'end'}]),
            {headers:{'content-type':'application/json'}});
        }}};
      const builtins={electron,'node:fs':hostFs,'node:path':path,'node:url':url,'node:crypto':crypto};
      const context=vm.createContext({require:name=>builtins[name],__dirname:virtualSupport,
        process:{argv:['node','synthetic-host',scenario==='describe'?'--describe':inputFile]},
        console:{log:value=>reports.push(JSON.parse(value))},URL,AbortController:HostAbortController});
      const script=new vm.Script(originalHost,{filename:path.join(support,'saved-config-call-host.cjs'),
        importModuleDynamically:identifier=>moduleFor(identifier.includes('agentarts-config.js')?
          {createAgentArtsConfig:()=>({snapshot:()=>({configured:true}),binding:()=>binding,
            readAuthorization:async()=> 'Bearer synthetic-credential'})}:{AgentArtsCloudAgentPort:RealmPort},context)});
      script.runInContext(context);return exited;
    };
    const wrapperProcess=Object.assign(new EventEmitter(),{env:{},argv:['node','synthetic-wrapper',scenario==='describe'?'--describe':inputFile]});
    const fakeSpawn=()=>{
      spawnCalls++;const child=new EventEmitter();child.kill=()=>hostController?.abort();
      setImmediate(async()=>{child.emit('spawn');try{child.emit('exit',await launchHost(),null);}catch(error){child.emit('error',error);}});return child;
    };
    const evaluateWrapper=async()=>{
      const context=vm.createContext({process:wrapperProcess});
      const builtins={'node:child_process':{spawn:fakeSpawn},'node:fs':fs,'node:path':{default:path},'node:url':url};
      const identifier=url.pathToFileURL(path.join(virtualSupport,'run-saved-config-call.mjs')).href;
      const module=new vm.SourceTextModule(originalWrapper,{context,identifier,initializeImportMeta:meta=>meta.url=identifier});
      await module.link(specifier=>moduleFor(builtins[specifier],context));
      await module.evaluate();
    };
    let rejected=false;try{await evaluateWrapper();}catch{rejected=true;}
    const firstCalls=networkCalls,firstSpawns=spawnCalls,lockRetained=fs.existsSync(lock),
      firstReport=reports.at(-1),firstExit=wrapperProcess.exitCode??null;
    let repeatedBlocked=false;
    if(unknownScenarios.includes(scenario)){try{await evaluateWrapper();}catch{repeatedBlocked=true;}}
    return {scenario,networkCalls,spawnCalls,firstCalls,firstSpawns,wrapperExit:firstExit,
      report:firstReport,lockRetained,rejected,repeatedBlocked,
      fakeElectron:true,actualPublicPort:true,actualWrapper:true,syntheticLock:true,externalNetwork:false};
  } finally {await rm(directory,{recursive:true,force:true});}
}
if(process.argv.includes('--synthetic-fixture-child')) {
  console.log(JSON.stringify(await syntheticCall(process.argv.at(-1))));
} else {
  const invoke=async scenario=>JSON.parse((await run(process.execPath,['--experimental-vm-modules',filename,
    '--synthetic-fixture-child',scenario],{timeout:10000})).stdout);
  for(const scenario of unknownScenarios)test(`saved call ${scenario} preserves unknown result and actual synthetic shared lock`,async t=>{
    const result=await invoke(scenario);
    t.diagnostic(JSON.stringify({scenario,firstCalls:result.firstCalls,networkCalls:result.networkCalls,wrapperExit:result.wrapperExit,
      status:result.report.status,diagnostic:result.report.diagnostic,lockRetained:result.lockRetained,repeatedBlocked:result.repeatedBlocked}));
    assert.equal(result.report.status,'unknown');
    assert.equal(result.report.errorCode,scenario==='timeout'?'TIMEOUT':scenario==='cancelled'?'CANCELLED':'EXTERNAL_FAILURE');assert.notEqual(result.wrapperExit,0);
    assert.equal(result.lockRetained,true);assert.equal(result.repeatedBlocked,true);
    assert.equal(result.networkCalls,1);assert.equal(result.spawnCalls,1);assert.equal(result.firstCalls,1);
  });
  for(const scenario of ['success','known-401','known-403','invalid-input','describe'])test(`saved call ${scenario} preserves known completion and lock release`,async()=>{
    const result=await invoke(scenario);assert.equal(result.lockRetained,false);assert.equal(result.rejected,false);
    assert.equal(result.spawnCalls,1);assert.equal(result.networkCalls,['success','known-401','known-403'].includes(scenario)?1:0);
    assert.equal(result.wrapperExit,scenario==='invalid-input'?2:0);
    assert.equal(result.report.status,{'success':'succeeded','known-401':'failed','known-403':'failed','invalid-input':'invalid_request','describe':'configured'}[scenario]);
    assert.doesNotMatch(JSON.stringify(result.report),/synthetic-private-response|synthetic-credential/);
  });
  test('an existing shared unknown lock blocks dispatch without reading credentials or invoking cloud',async()=>{
    const result=await invoke('existing-lock');assert.equal(result.rejected,true);assert.equal(result.lockRetained,true);
    assert.equal(result.networkCalls,0);assert.equal(result.spawnCalls,0);
  });
}

import assert from 'node:assert/strict';
import {fork,execFileSync} from 'node:child_process';
import {mkdirSync,mkdtempSync,readFileSync,writeFileSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {fixture,descriptor,directory} from '../../../packages/mcp/test/remote-http-fixture.mjs';
import {remoteMcpDirectoryDigest} from '@personal-agent/mcp';

const base=fileURLToPath(new URL('../../../.cache/mcp-tls/',import.meta.url));mkdirSync(base,{recursive:true});
const location=mkdtempSync(path.join(base,'case-')),token='synthetic-tls-token-only';
let currentCase='certificate-generation';
const worker=fileURLToPath(new URL('./remote-tls-worker.mjs',import.meta.url));
const environment=Object.fromEntries(['SystemRoot','WINDIR','TEMP','TMP','USERPROFILE','HOMEDRIVE','HOMEPATH','APPDATA','LOCALAPPDATA','PATH','COMSPEC'].filter(key=>process.env[key]).map(key=>[key,process.env[key]]));
function certificate(name,san){
  const key=path.join(location,name+'-key.pem'),cert=path.join(location,name+'-cert.pem');
  execFileSync(process.env.PA_TEST_OPENSSL??'openssl',['req','-x509','-newkey','rsa:2048','-noenc','-days','1',
    '-subj','/CN=PersonalAgent Synthetic TLS Test','-addext','basicConstraints=critical,CA:TRUE',
    '-addext','subjectAltName='+san,'-keyout',key,'-out',cert],{env:environment,stdio:'ignore',windowsHide:true,timeout:30000});
  return {options:{key:readFileSync(key),cert:readFileSync(cert)},file:cert};
}
async function child(input,ca,check){
  return new Promise((resolve,reject)=>{
    const childProcess=fork(worker,[],{env:{...environment,...(ca?{NODE_EXTRA_CA_CERTS:ca}:{})},stdio:['ignore','pipe','pipe','ipc'],windowsHide:true});
    let receipt,failed;
    const timer=setTimeout(()=>{failed=Error('Synthetic TLS worker timed out');childProcess.kill();},40000);
    // Drain diagnostics without echoing transport headers, tokens or local paths.
    childProcess.stdout.on('data',()=>{});childProcess.stderr.on('data',()=>{});
    childProcess.on('message',message=>{
      if(message.phase){try{check(message.phase);childProcess.send({phase:message.phase,ok:true});}catch(error){failed=error;childProcess.send({phase:message.phase,ok:false});}}
      if(message.receipt)receipt=message.receipt;if(message.error)failed=Object.assign(Error('Synthetic TLS worker failed'),message.error);
    });
    childProcess.once('error',error=>{clearTimeout(timer);reject(error);});
    childProcess.once('exit',code=>{clearTimeout(timer);failed||code!==0||!receipt?reject(failed??Error('Synthetic TLS worker exited without confirmation')):resolve(receipt);});
    childProcess.send(input);
  });
}
async function run(){
  const trusted=certificate('trusted','IP:127.0.0.1'),wrongHost=certificate('wrong-host','DNS:wrong.invalid');
  const receipts=[];
  for(const mode of ['success','untrusted-ca','hostname-mismatch','directory-mismatch','redirect']){
    currentCase=mode;
    const tls=mode==='hostname-mismatch'?wrongHost:trusted;
    const destination=mode==='redirect'?await fixture({tls:trusted.options}):undefined;
    const service=await fixture({tls:tls.options,requiredAuthorization:'Bearer '+token,
      ...(destination?{status:307,location:destination.secureEndpoint}:{})});
    try{
      const definition={endpoint:service.secureEndpoint,server:{name:'synthetic-reference',version:'1.0.0'},
        tool:{remoteName:'reference',descriptor:{...descriptor,version:'2.0.0'}},
        directoryDigest:mode==='directory-mismatch'?'0'.repeat(64):remoteMcpDirectoryDigest(directory())};
      const userData=path.join(location,mode);mkdirSync(userData);
      let requestsBeforeRestart;
      const receipt=await child({mode,userData,definition},mode==='untrusted-ca'?undefined:tls.file,phase=>{
        assert.equal(service.calls().length,phase==='before-approval'?0:1);
        if(phase==='before-restart')requestsBeforeRestart=service.requests.length;
        if(phase==='after-restart')assert.equal(service.requests.length,requestsBeforeRestart,'restart cannot connect or replay requests');
        assert.ok(service.requests.filter(request=>request.method==='POST').every(request=>request.headers.authorization==='Bearer '+token));
      });
      if(['untrusted-ca','hostname-mismatch'].includes(mode))assert.equal(service.requests.length,0,'TLS failure cannot deliver HTTP headers');
      assert.equal(service.calls().length,mode==='success'?1:0);if(destination)assert.equal(destination.requests.length,0,'redirect cannot forward credentials');
      receipts.push({...receipt,toolCalls:service.calls().length,httpRequests:service.requests.length,
        ...(destination?{redirectDestinationRequests:destination.requests.length}:{})});
    }finally{await service.close();await destination?.close();}
  }
  const receipt={status:'passed',cases:receipts,transport:'actual loopback HTTPS/TLS',systemTrustChanged:false,
    processLocalCA:true,tlsVerificationDisabled:false,modelCalls:0,agentArtsCalls:0};
  writeFileSync(path.join(location,'receipt.json'),JSON.stringify(receipt,null,2));console.log(JSON.stringify(receipt));
}
void run().catch(error=>{console.error(JSON.stringify({status:'failed',case:currentCase,stage:error.stage??'setup-or-readback',type:error.type??error.name,code:error.code??'UNEXPECTED_FAILURE'}));process.exitCode=1;});

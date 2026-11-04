import {createServer} from 'node:net';
import {openSync,closeSync,writeFileSync,readFileSync,existsSync,mkdirSync,realpathSync,statSync,statfsSync,unlinkSync,chmodSync} from 'node:fs';
import {isAbsolute,join,dirname,resolve} from 'node:path';
import {randomUUID,createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {createAgentArtsRuntimeApplication,createCloudPersistentRuntimeHost} from '@personal-agent/runtime/application';
import {parseCloudPersistentCommand} from '@personal-agent/contracts/cloud-persistent';
import {readRuntimeBuildIdentity} from '@personal-agent/runtime';
import {verifyJob} from './remote-runner-service.mjs';
import {createCloudRuntimeContext} from './cloud-runtime-context.mjs';
import {createCloudRuntimeFeeds} from './cloud-runtime-feeds.mjs';

const MAX_BYTES=1024*1024;
const fail=(code,message)=>{throw Object.assign(new Error(message),{code});};
const hash=value=>createHash('sha256').update(value).digest('hex');
/** Never expire or remove an unowned lock. Recovery first checks the original process and operations. */
export function acquireCloudRuntimeDirectory(directory) {
  if(!isAbsolute(directory))fail('INVALID_ARGUMENT','Absolute cloud Runtime directory required');
  mkdirSync(directory,{recursive:true,mode:0o700});
  const root=realpathSync(directory),file=join(root,'.runtime-owner.lock'),identity=JSON.stringify({version:1,pid:process.pid,instanceId:randomUUID()});
  let fd;
  try{fd=openSync(file,'wx',0o600);}catch{fail('REVISION_CONFLICT','Cloud Runtime directory already has an owner; inspect it before recovery');}
  writeFileSync(fd,identity);let closed=false;
  const assertCurrent=()=>{
    if(closed||realpathSync(directory)!==root||readFileSync(file,'utf8')!==identity)fail('REVISION_CONFLICT','Cloud Runtime process ownership changed');
  };
  return {directory:root,assertCurrent,release(){assertCurrent();closed=true;closeSync(fd);unlinkSync(file);}};
}
function secret(file) {
  if(!isAbsolute(file)||!statSync(file).isFile()||(statSync(file).mode&0o007)!==0)fail('UNAUTHORIZED','Cloud secret file is not private');
  const value=readFileSync(file,'utf8').trim();if(value.length<16)fail('UNAUTHORIZED','Cloud secret is unavailable');return value;
}
export async function startCloudRuntimeService(configFile) {
  let lease,application,server,publicContext,feedHost,stopping=false;
  try {
  if(process.platform!=='linux')fail('UNSUPPORTED_CAPABILITY','Independent cloud Runtime requires the qualified Linux host');
  if(!isAbsolute(configFile))fail('INVALID_ARGUMENT','Absolute cloud Runtime configuration required');
  const raw=readFileSync(configFile,'utf8'),config=JSON.parse(raw),qualification=config.qualification;
  if(config.version!==1||!qualification||qualification.runtimeId!==config.owner?.runtimeId||qualification.hostId!==config.owner?.hostId
    ||!qualification.storageEvidenceRef||!qualification.independentHostEvidenceRef||!/^[a-f0-9]{40}$/.test(qualification.sourceRevision??''))
    fail('UNSUPPORTED_CAPABILITY','Fixed cloud host qualification evidence is required');
  const socketPath=process.env.PA_CLOUD_RUNTIME_SOCKET||'/run/personal-agent-cloud-runtime/runtime.sock';
  if(!isAbsolute(socketPath)||existsSync(socketPath))fail('REVISION_CONFLICT','Private cloud Runtime socket must be unused');
  lease=acquireCloudRuntimeDirectory(config.dataDirectory);
  if(realpathSync(qualification.dataDirectory)!==lease.directory||Number(statfsSync(lease.directory).type)===0x01021994)
    fail('UNSUPPORTED_CAPABILITY','Qualified persistent Runtime volume is unavailable');
  const artifact=readRuntimeBuildIdentity();
  if(!artifact||artifact!==qualification.runtimeArtifactRef)fail('UNSUPPORTED_CAPABILITY','Qualified Runtime artifact differs');
  const assertCurrent=()=>{if(stopping)fail('CANCELLED','Cloud Runtime is stopping');lease.assertCurrent();if(hash(readFileSync(configFile,'utf8'))!==hash(raw)||readRuntimeBuildIdentity()!==artifact)
    fail('REVISION_CONFLICT','Cloud Runtime configuration or artifacts changed');};
  const rawAgent=config.agentarts,agent={gatewayUrl:rawAgent?.gatewayUrl,runtimeName:rawAgent?.runtimeName,deploymentVersion:rawAgent?.deploymentVersion,
    ...(rawAgent?.websocketUrl?{websocketUrl:rawAgent.websocketUrl,transport:'wss'}:{}),invokeMode:'published',allowHttpsFallback:false};
  if(agent?.deploymentVersion!==config.owner.deploymentVersion||!agent.gatewayUrl||!agent.runtimeName)
    fail('UNSUPPORTED_CAPABILITY','Fixed Competition deployment is required');
  // No dynamic plugins, provider replacements, DB/grant import or automatic approvals.
  const authorizationProvider={read:async()=>{assertCurrent();return 'Bearer '+secret(config.agentAuthorizationFile);}};
  const hostAuthorizationProvider={read:async()=>{assertCurrent();return 'Bearer '+secret(config.hostAuthorizationFile);}};
  if(config.feeds!==undefined)feedHost=createCloudRuntimeFeeds({getApplication:()=>application,namespace:config.owner.runtimeId,
    subscriptions:config.feeds,assertCurrent});
  application=createAgentArtsRuntimeApplication({path:join(lease.directory,'runtime.sqlite'),hostUserNamespace:config.owner.runtimeId,
    ...agent,assertDeploymentBinding:assertCurrent,beforeCompetitionSend:assertCurrent,authorizationProvider,websocketAuthorizationProvider:hostAuthorizationProvider,
    proactiveWorkflows:true,responseMode:'tool-proposal-json',initialRequestMode:'goal-with-tools-json',continuationContext:'goal',
    ...(feedHost?{tools:feedHost.tools,hostOnlyTools:feedHost.tools.map(tool=>tool.descriptor.name)}:{})});
  publicContext=await createCloudRuntimeContext({application,dataDirectory:lease.directory,owner:config.owner,
    knowledge:config.publicKnowledge,assertCurrent});
  const host=createCloudPersistentRuntimeHost(application,{owner:config.owner,assertCurrent,qualificationEvidenceRef:qualification.independentHostEvidenceRef,
    image:{config:agent,authorizationProvider,hostAuthorizationProvider,assertDeploymentBinding:assertCurrent,receiptSecret:secret(config.receiptSecretFile)},
    context:publicContext.context,
    ...(feedHost?{feeds:feedHost}:{}),
    bindings:[{kind:'teacher_decision',toolName:'proactive.teacher_decision',toolVersion:'1.0.0',location:'cloud_persistent',effect:'read'}]});
  // Only after exclusive directory/owner validation. This is the original Runtime recovery:
  // interrupted runs become reconciliation work, never new tasks or fresh tool attempts.
  application.runtime.recoverInterruptedTasks();
  const token=process.env.RUNNER_TOKEN||secret(config.runnerTokenFile);
  server=createServer(socket=>{
    let input=Buffer.alloc(0),handled=false;const controller=new AbortController();
    const connectionTimer=setTimeout(()=>{controller.abort();socket.destroy();},60_000);
    socket.on('close',()=>{clearTimeout(connectionTimer);controller.abort();});socket.on('error',()=>{});
    socket.on('data',chunk=>{
      if(handled)return;input=Buffer.concat([input,chunk]);
      if(input.length>MAX_BYTES){handled=true;socket.destroy();return;}
      const newline=input.indexOf(10);if(newline<0)return;
      handled=true;
      void (async()=>{
        let message;
        try{
          if(input.subarray(newline+1).toString().trim())fail('INVALID_ARGUMENT','One cloud command per connection');
          message=JSON.parse(input.subarray(0,newline).toString('utf8'));
          if(message.kind!=='cloud-persistent'||message.v!==1||!verifyJob(message,token))fail('UNAUTHORIZED','Cloud transport identity is invalid');
          const command=parseCloudPersistentCommand(message.payload);
          if(command.deadline!==message.deadline||message.idempotencyKey!=='cloud-persistent:'+command.owner.runtimeId+':'+command.commandId)
            fail('UNAUTHORIZED','Original cloud command transport binding differs');
          const ms=Date.parse(command.deadline)-Date.now();if(ms<=0||ms>60_000)fail('TIMEOUT','Original cloud command deadline expired');
          const timeout=setTimeout(()=>controller.abort(),ms);
          try{const data=await host.handle(command,controller.signal);
            socket.end(JSON.stringify({v:1,jobId:message.id,idempotencyKey:message.idempotencyKey,kind:message.kind,state:'succeeded',data,redo:false}));
          }finally{clearTimeout(timeout);}
        }catch(error){
          const state=error?.code==='RESULT_UNKNOWN'||controller.signal.aborted?'unknown':'rejected';
          socket.end(JSON.stringify({v:1,jobId:message?.id,idempotencyKey:message?.idempotencyKey,kind:'cloud-persistent',state,
            data:{code:['INVALID_ARGUMENT','UNAUTHORIZED','UNSUPPORTED_CAPABILITY','REVISION_CONFLICT','NOT_FOUND','TIMEOUT','CANCELLED','RESULT_UNKNOWN'].includes(error?.code)?error.code:'HOST_UNAVAILABLE'},redo:false}));
        }
      })();
    });
  });
  mkdirSync(dirname(socketPath),{recursive:true,mode:0o750});
  await new Promise((ok,no)=>{server.once('error',no);server.listen(socketPath,ok);});chmodSync(socketPath,0o660);
  // Maintenance delegates every wake/state change to the existing TaskRuntime Scheduler and worker.
  const timer=setInterval(()=>{void host.tick().catch(()=>{});},1000);
  return {owner:host.owner,close(){stopping=true;clearInterval(timer);server.close();application.close();feedHost?.close();publicContext.close();lease.release();}};
  }catch(error){
    // Before admission, release only this process's own lock after the original app confirms it is idle.
    // If any worker started, close() rejects and the lock deliberately remains for explicit recovery.
    let idle=true;try{server?.close();application?.close();feedHost?.close();publicContext?.close();}catch{idle=false;}
    if(idle&&lease){try{lease.release();}catch{}}
    throw error;
  }
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href) {
  try{const service=await startCloudRuntimeService(process.env.PA_CLOUD_RUNTIME_CONFIG||'/etc/personal-agent-cloud-runtime/config.json');
    const stop=()=>{try{service.close();process.exitCode=0;}catch{process.exitCode=1;}setTimeout(()=>process.exit(process.exitCode),50).unref();};
    process.once('SIGINT',stop);process.once('SIGTERM',stop);
    process.stdout.write(JSON.stringify({state:'listening',owner:service.owner})+'\n');
  }catch{process.stderr.write('Cloud Runtime unavailable; inspect fixed host configuration and ownership.\n');process.exitCode=1;}
}

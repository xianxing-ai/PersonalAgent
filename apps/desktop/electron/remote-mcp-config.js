import {existsSync,mkdirSync,readFileSync,renameSync,unlinkSync,writeFileSync} from 'node:fs';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {ProtocolError,validateContract} from '@personal-agent/contracts';

const uuid=value=>typeof value==='string' && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(value);
const exact=(value,allowed,required=allowed)=>value && typeof value==='object' && !Array.isArray(value)
  && Object.keys(value).every(key=>allowed.includes(key)) && required.every(key=>Object.hasOwn(value,key));
const text=(value,max)=>typeof value==='string' && value.length>0 && value.length<=max && !/[\u0000-\u001f\u007f]/.test(value);
const token=value=>typeof value==='string' && value.length>0 && value.length<=8192 && /^[A-Za-z0-9._~+/-]+=*$/.test(value);
const date=value=>text(value,64) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString()===value;
function fail(code){throw new ProtocolError(code,'远程 MCP 配置操作未完成，请检查本机安全存储或重新装配');}
function connection(value){
  if(!exact(value,['endpoint','server','tool','directoryDigest']) || !text(value.endpoint,2048)
    || !exact(value.server,['name','version']) || !text(value.server.name,256) || !text(value.server.version,128)
    || !exact(value.tool,['remoteName','descriptor']) || !text(value.tool.remoteName,256)
    || !exact(value.tool.descriptor,['name','version','inputSchema','outputSchema','requiredScopes'])
    || !/^[a-f0-9]{64}$/.test(value.directoryDigest))throw Error();
  const endpoint=new URL(value.endpoint);
  if(endpoint.protocol!=='https:' || endpoint.username || endpoint.password || endpoint.search || endpoint.hash
    || value.tool.descriptor.inputSchema?.type!=='object' || value.tool.descriptor.outputSchema?.type!=='object'
    || !value.tool.descriptor.requiredScopes?.length)throw Error();
  validateContract('tool',{...value.tool.descriptor,sideEffect:'read',requiresPresence:false,idempotencySupport:true,recoverySupport:false});
  return structuredClone({...value,endpoint:endpoint.href});
}
function validSaved(value){
  if(!exact(value,['configurationId','revision','connection','credential'],['configurationId','revision','connection'])
    || !uuid(value.configurationId) || !Number.isSafeInteger(value.revision) || value.revision<1)throw Error();
  const normalized=connection(value.connection);
  if(normalized.endpoint!==value.connection.endpoint)throw Error();
  if(Object.hasOwn(value,'credential') && (!value.credential || !exact(value.credential,['secretRef','revision','token','expiresAt']) || !uuid(value.credential.secretRef)
    || value.credential.revision!==value.revision || !token(value.credential.token) || !date(value.credential.expiresAt)))throw Error();
  return value;
}

/** One trusted main-process owner per userData. Saving never connects or grants tools. */
export function createRemoteMcpConfig({userData,safeStorage}){
  const target=path.join(userData,'remote-mcp-config.json'),sessionId=randomUUID();
  let saved,failure='',closed=false,controller=new AbortController();
  if(existsSync(target)){
    try{
      const raw=readFileSync(target);
      if(raw.length>512*1024 || !safeStorage.isEncryptionAvailable())throw Error();
      const stored=JSON.parse(raw.toString('utf8'));
      if(!exact(stored,['version','encrypted']) || stored.version!==1 || !/^[A-Za-z0-9+/=]+$/.test(stored.encrypted))throw Error();
      saved=validSaved(JSON.parse(safeStorage.decryptString(Buffer.from(stored.encrypted,'base64'))));
    }catch{failure='unavailable';}
  }
  const snapshot=()=>({configured:!!saved,hasCredentials:!!saved?.credential,connected:false,sessionAllowed:false,toolAvailable:false,remoteVerified:false,
    status:closed?'unavailable':failure || (!saved?'unconfigured':saved.credential && Date.parse(saved.credential.expiresAt)<=Date.now()?'expired':'saved_disconnected')});
  function binding(){
    if(closed || !saved)return undefined;
    return {configurationRef:`${saved.configurationId}:${sessionId}`,revision:saved.revision,directoryDigest:saved.connection.directoryDigest,
      ...(saved.credential?{credential:{secretRef:saved.credential.secretRef,revision:saved.credential.revision,resource:saved.connection.endpoint,expiresAt:saved.credential.expiresAt}}:{})};
  }
  const invalidate=()=>{const previous=controller;controller=new AbortController();previous.abort();};
  return Object.freeze({snapshot,binding,revocationSignal:()=>controller.signal,
    hostConfiguration(){if(closed || !saved)return undefined;return {...structuredClone(saved.connection),binding:binding()};},
    secretStore:Object.freeze({read(ref,signal){
      if(signal.aborted)fail('CANCELLED');
      if(closed || !saved?.credential || ref!==saved.credential.secretRef || Date.parse(saved.credential.expiresAt)<=Date.now())fail('UNAUTHORIZED');
      return saved.credential.token;
    }}),
    configure(input){
      if(closed)fail('UNSUPPORTED_CAPABILITY');
      let value;
      try{
        if(!exact(input,['endpoint','server','tool','directoryDigest','credential'],['endpoint','server','tool','directoryDigest']))throw Error();
        const {credential,...settings}=input,normalized=connection(settings);
        if(credential!==undefined && (!exact(credential,['token','expiresAt']) || !token(credential.token) || !date(credential.expiresAt) || Date.parse(credential.expiresAt)<=Date.now()))throw Error();
        if(saved?.revision===Number.MAX_SAFE_INTEGER)throw Error();
        const revision=(saved?.revision??0)+1;
        value={configurationId:saved?.configurationId??randomUUID(),revision,connection:normalized,
          ...(credential?{credential:{...credential,secretRef:randomUUID(),revision}}:{})};
        if(Buffer.byteLength(JSON.stringify(value))>256*1024)throw Error();
      }catch{fail('INVALID_ARGUMENT');}
      let temporary;
      try{
        if(!safeStorage.isEncryptionAvailable())throw Error();
        const encrypted=safeStorage.encryptString(JSON.stringify(value)).toString('base64');
        mkdirSync(userData,{recursive:true});temporary=`${target}.tmp-${process.pid}-${randomUUID()}`;
        writeFileSync(temporary,JSON.stringify({version:1,encrypted}),{encoding:'utf8',flag:'wx'});
        renameSync(temporary,target);
      }catch{
        if(temporary){try{unlinkSync(temporary);}catch{/* Retain the original file; no plaintext was written. */}}
        fail('EXTERNAL_FAILURE');
      }
      saved=value;failure='';invalidate();return snapshot();
    },
    revoke(){
      if(closed)fail('UNSUPPORTED_CAPABILITY');
      saved=undefined;invalidate();failure='';
      try{if(existsSync(target))unlinkSync(target);}catch{failure='revoke_pending';fail('EXTERNAL_FAILURE');}
      return snapshot();
    },
    dispose(){if(closed)return;closed=true;saved=undefined;controller.abort();},
  });
}

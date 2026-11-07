import {existsSync,mkdirSync,readFileSync,writeFileSync,renameSync} from 'node:fs';
import {join} from 'node:path';
import {randomUUID,createHash} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import {ProtocolError} from '@personal-agent/contracts';
import {createF25ConfigurationWorkflowPorts} from '@personal-agent/runtime/application';

const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const fail=(code='UNAUTHORIZED',message='原 F25 账户、知识来源或范围提案已变化')=>{throw new ProtocolError(code,message);};

/** A reference to the existing encrypted account and Knowledge scope, never a
 * second credential store. Native settings stage a proposal; N04 applies it. */
export function createDesktopF25Configuration({userData,safeStorage,getAgentArtsConfig,getKnowledgeSourceConfig}={}) {
  if(!userData||typeof safeStorage?.encryptString!=='function'||typeof safeStorage.decryptString!=='function'
    ||typeof getAgentArtsConfig!=='function'||typeof getKnowledgeSourceConfig!=='function')fail('UNSUPPORTED_CAPABILITY');
  const file=join(userData,'f25-data-scope.json');let entry,closed=false;
  if(existsSync(file)){
    try{if(!safeStorage.isEncryptionAvailable())throw Error();const envelope=JSON.parse(readFileSync(file,'utf8'));
      if(envelope.version!==1||typeof envelope.encrypted!=='string')throw Error();
      entry=JSON.parse(safeStorage.decryptString(Buffer.from(envelope.encrypted,'base64')));
      if(entry.version!==1||!Number.isSafeInteger(entry.revision)||entry.revision<1||typeof entry.accountRef!=='string'
        ||!entry.sourceBefore||!entry.desired)throw Error();
    }catch{fail('UNSUPPORTED_CAPABILITY','F25 安全范围提案无法恢复，请重新配置');}
  }
  function account(){const host=getAgentArtsConfig(),snapshot=host?.snapshot(),ref=host?.readCredentialReference?.();
    if(closed||!snapshot?.configured||typeof ref!=='string'||!ref)fail('UNSUPPORTED_CAPABILITY','原 AgentArts 安全账户不可用');return ref;}
  function source(){const host=getKnowledgeSourceConfig(),state=host?.snapshot();
    if(closed||!state?.configured||!state.available||typeof host.readDataScopeConfiguration!=='function')fail('UNSUPPORTED_CAPABILITY','原知识范围不可用');
    return {host,state,configuration:host.readDataScopeConfiguration()};}
  function persist(next){
    if(!safeStorage.isEncryptionAvailable())fail('UNSUPPORTED_CAPABILITY','本机安全存储不可用');
    const encrypted=safeStorage.encryptString(JSON.stringify(next)).toString('base64');mkdirSync(userData,{recursive:true});
    const temporary=file+'.'+randomUUID()+'.tmp';writeFileSync(temporary,JSON.stringify({version:1,encrypted}),{encoding:'utf8',mode:0o600,flag:'wx'});
    renameSync(temporary,file);entry=next;
  }
  function selection(){if(!entry||account()!==entry.accountRef)fail();return structuredClone({revision:entry.revision,
    accountRef:entry.accountRef,sourceBefore:entry.sourceBefore,desired:entry.desired});}
  function assertSelection(expected){if(!isDeepStrictEqual(selection(),expected))fail();}
  function readSaved(expected,scope){
    assertSelection(expected);if(!entry.applied)return;
    if(entry.applied.taskId!==scope.taskId||!isDeepStrictEqual(source().configuration,entry.applied.sourceAfter))fail('REVISION_CONFLICT');
    return structuredClone(entry.applied.result);
  }
  const host={
    snapshot(){return {configured:!!entry,revision:entry?.revision??0,stage:entry?.applied?'saved':'selected',
      sourceId:entry?.sourceBefore.sourceId??'',dataLevel:entry?.desired.dataLevel??'private',cloudExportAllowed:entry?.desired.cloudExportAllowed??false,
      accountConfigured:!closed&&!!getAgentArtsConfig()?.snapshot().configured,pingConnected:'unverified',capabilityTested:'unverified'};},
    configure(input){
      if(!input||Object.keys(input).some(key=>!['expectedRevision','dataLevel','cloudExportAllowed','publicQueries'].includes(key))
        ||input.expectedRevision!==(entry?.revision??0)||!['private','public'].includes(input.dataLevel)||typeof input.cloudExportAllowed!=='boolean'
        ||!Array.isArray(input.publicQueries)||input.publicQueries.length>16||input.publicQueries.some(value=>typeof value!=='string'||!value.trim()||value.length>128)
        ||input.cloudExportAllowed&&(input.dataLevel!=='public'||!input.publicQueries.length))fail('INVALID_ARGUMENT','F25 范围提案无效');
      const before=source().configuration,desired={...before,dataLevel:input.dataLevel,cloudExportAllowed:input.cloudExportAllowed,
        publicQueries:input.cloudExportAllowed?[...input.publicQueries]:[]};
      persist({version:1,revision:(entry?.revision??0)+1,accountRef:account(),sourceBefore:before,desired});return host.snapshot();
    },
    readSelection:selection,readSaved,
    assertCurrent(expected,scope){assertSelection(expected);if(entry.applied){readSaved(expected,scope);return;}
      if(!isDeepStrictEqual(source().configuration,expected.sourceBefore))fail('REVISION_CONFLICT');},
    readOutboundContext(expected,scope){host.assertCurrent(expected,scope);const {state}=source();
      return {sourceId:state.sourceId,revision:state.configRevision,dataLevel:state.dataLevel,cloudExportAllowed:state.cloudExportAllowed,
        payload:{sourceId:state.sourceId,displayName:state.displayName,allowedNotePaths:[...state.allowedNotePaths],publicQueries:[...state.publicQueries]}};},
    async apply(expected,scope){
      host.assertCurrent(expected,scope);const prior=readSaved(expected,scope);if(prior)return prior;
      const initial=source(),check=()=>{if(scope.signal.aborted||Date.now()>=Date.parse(scope.deadline))fail('CANCELLED');
        if(getKnowledgeSourceConfig()!==initial.host)fail();host.assertCurrent(expected,scope);};
      check();await initial.host.configure(expected.desired,{assertCurrent:check,signal:scope.signal,deadline:scope.deadline});
      if(scope.signal.aborted||Date.now()>=Date.parse(scope.deadline)||account()!==expected.accountRef)fail('RESULT_UNKNOWN');
      const after=source().configuration,wanted={...expected.desired,configRevision:expected.sourceBefore.configRevision+1};
      if(isDeepStrictEqual(after,expected.sourceBefore))fail('UNAUTHORIZED','原知识范围修改未被批准');
      if(!isDeepStrictEqual(after,wanted))fail('RESULT_UNKNOWN','原知识范围修改需独立读回');
      const result={saved:true,configurationRef:'f25:'+hash([expected,after]),sourceId:after.sourceId,sourceRevision:after.configRevision,
        dataLevel:after.dataLevel,cloudExportAllowed:after.cloudExportAllowed,pingConnected:'unverified',capabilityTested:'unverified',
        accountActive:'unverified',privateDataBlocked:after.dataLevel!=='public'||!after.cloudExportAllowed};
      persist({...entry,applied:{taskId:scope.taskId,sourceAfter:after,result}});return readSaved(expected,scope);
    },close(){closed=true;}};
  return host;
}

export function createDesktopF25WorkflowWorkerPorts({getApplication,configuration,authorizeExport}={}) {
  if(typeof getApplication!=='function'||!configuration||typeof authorizeExport!=='function')
    return {tools:[],configuredWorkflowWorkerPorts:[],unavailable:'f25_desktop_configuration_unavailable'};
  const runtime=new Proxy({},{get(_target,name){const value=getApplication()?.runtime?.[name];
    if(value===undefined)fail('UNSUPPORTED_CAPABILITY','F25 Runtime 不可用');return typeof value==='function'?value.bind(getApplication().runtime):value;}});
  const application=new Proxy({runtime},{get(target,name){if(name==='runtime')return target.runtime;const app=getApplication();
    if(!app)fail('UNSUPPORTED_CAPABILITY','F25 Runtime 不可用');const value=app[name];return typeof value==='function'?value.bind(app):value;}});
  return createF25ConfigurationWorkflowPorts({application,configuration,authorizeExport});
}

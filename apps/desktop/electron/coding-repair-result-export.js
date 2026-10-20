import {createHash} from 'node:crypto';
import {ProtocolError} from '@personal-agent/contracts';
import {parseCodingRepairInput,parseCodingRepairSnapshot,parseCodingRepairCheckReadback,
  parseCodingRepairVerificationReceipt,parseCodingRepairPublishReadback} from '@personal-agent/contracts/coding-repair';

const aliases={'workspace.coding_snapshot':'snapshot','workflow.host.f15_n04':'preview',
  'workflow.host.f15_n05':'check','workflow.host.f15_n06':'publish'};
export const codingRepairExportOperation=name=>name.startsWith('coding.repair.')?name.slice('coding.repair.'.length):aliases[name];
const fail=()=>{throw new ProtocolError('PROTOCOL_MISMATCH','Invalid coding repair result metadata');};
const bool=value=>typeof value==='boolean'?value:fail();
const id=value=>typeof value==='string'&&/^[A-Za-z0-9@][A-Za-z0-9_.:@/-]*$/.test(value)
  &&!value.startsWith('/')&&!/^[A-Za-z]:/.test(value)?value:fail();
const relative=(value,root=false)=>root&&value==='.'?value:typeof value==='string'&&value.length>0
  &&!/[\\:\0]/.test(value)&&!value.startsWith('/')&&!value.split('/').some(part=>!part||part==='.'||part==='..')?value:fail();
const sha=value=>value===null||typeof value==='string'&&/^[a-f0-9]{64}$/.test(value)?value:fail();
const list=(value,parse)=>Array.isArray(value)?value.map(parse):fail();
const files=values=>values.map(({path,sha256,packageId,kind})=>({path:relative(path),sha256,packageId:id(packageId),kind}));
const snapshot=value=>{const parsed=parseCodingRepairSnapshot(value);return {...parsed,files:files(parsed.files)};};
const verification=value=>{const parsed=parseCodingRepairVerificationReceipt(value);
  // Free-form diagnostic text/source/code may contain local paths, source or secrets.
  return {...parsed,files:files(parsed.files),evidenceRefs:parsed.evidenceRefs.map(id),diagnostics:[]};};
const publish=value=>{const parsed=parseCodingRepairPublishReadback(value);return {...parsed,
  files:parsed.files.map(file=>({...file,path:relative(file.path)})),evidenceRefs:parsed.evidenceRefs.map(id)};};
const patch=value=>({path:relative(value.path),beforeSha256:sha(value.beforeSha256),afterSha256:sha(value.afterSha256),changed:bool(value.changed)});

/** Projection only. Original ToolGateway result/cache/Evidence remains unchanged. */
export function projectCodingRepairResult(name,result) {
  const operation=codingRepairExportOperation(name);
  switch(operation) {
    case 'start': {const parsed=parseCodingRepairInput(result);return {...parsed,initialSnapshot:snapshot(parsed.initialSnapshot)};}
    case 'snapshot':return snapshot(result);
    case 'readback':case 'check': {const parsed=parseCodingRepairCheckReadback(result);
      return {...parsed,snapshot:snapshot(parsed.snapshot),verification:parsed.verification.map(verification)};}
    case 'verify':return verification(result);
    case 'publish':return publish(result);
    case 'preview':return {sessionId:id(result.sessionId),approved:bool(result.approved),previewed:bool(result.previewed),patches:list(result.patches,patch)};
    case 'patch':return {...patch(result),applied:bool(result.applied)};
    case 'read': {
      if(result.encoding!=='utf-8'||typeof result.content!=='string'||!Number.isSafeInteger(result.byteLength)||result.byteLength<0)fail();
      const digest=createHash('sha256').update(result.content,'utf8').digest('hex');
      // The existing reader hashes raw bytes; UTF-8 decoding can remove a BOM.
      if(result.sha256===undefined&&Buffer.byteLength(result.content,'utf8')!==result.byteLength)fail();
      const contentDigest=result.sha256===undefined?digest:sha(result.sha256);if(contentDigest===null)fail();
      return {path:relative(result.path),encoding:'utf-8',byteLength:result.byteLength,sha256:contentDigest,read:true};
    }
    case 'list':return {path:relative(result.path,true),entries:list(result.entries,value=>{
      if(!['file','directory'].includes(value.kind)||typeof value.name!=='string'||value.name.includes('/'))fail();
      return {name:relative(value.name),kind:value.kind};}),truncated:bool(result.truncated)};
    case 'reconcile': {
      if(!['clear','in_progress','unknown'].includes(result.state))fail();
      return {state:result.state,...(result.delivery===undefined?{}:{delivery:publish(result.delivery)})};
    }
    default:throw new ProtocolError('UNSUPPORTED_CAPABILITY','Coding repair result export is unavailable');
  }
}

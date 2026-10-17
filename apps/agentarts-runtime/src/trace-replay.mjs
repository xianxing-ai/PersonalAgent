import {createHash} from 'node:crypto';
import {ProtocolError} from '@personal-agent/contracts';

const plain=value=>!!value&&typeof value==='object'&&!Array.isArray(value);
const exact=(value,keys)=>plain(value)&&Object.keys(value).length===keys.length&&keys.every(key=>Object.hasOwn(value,key));
const text=value=>typeof value==='string'&&!!value.trim();
const validDate=value=>typeof value==='string'&&Number.isFinite(Date.parse(value));
const fail=(code,message)=>{throw new ProtocolError(code,message);};
function canonical(value) {
  if(value===null||typeof value!=='object') {
    if(value===undefined||['function','symbol','bigint'].includes(typeof value)||typeof value==='number'&&!Number.isFinite(value))
      fail('INVALID_ARGUMENT','Frozen trace values must be finite JSON');
    return JSON.stringify(value);
  }
  if(Array.isArray(value))return '['+value.map(canonical).join(',')+']';
  if(!plain(value)||![Object.prototype,null].includes(Object.getPrototypeOf(value)))fail('INVALID_ARGUMENT','Frozen trace must be plain JSON');
  return '{'+Object.keys(value).sort().map(key=>JSON.stringify(key)+':'+canonical(value[key])).join(',')+'}';
}
export const workflowTraceDigest=value=>createHash('sha256').update(canonical(value)).digest('hex');
const versions=value=>plain(value)&&Object.keys(value).length>0&&Object.entries(value).every(([key,version])=>text(key)&&text(version));
const same=(a,b)=>workflowTraceDigest(a)===workflowTraceDigest(b);
const key=value=>workflowTraceDigest({toolName:value.toolName,toolVersion:value.toolVersion,argumentsDigest:value.argumentsDigest,sourceVersions:value.sourceVersions});
const baseKeys=['recordId','kind','observedAt','sourceVersions','state','result','resultDigest','evidenceRefs','effect'];
/** Data-only replay of a trusted host's signed frozen export. This function has no
 * tool/model port, authorization issuer, history store, retry loop or write path.
 * Only the shadow controller authenticates export provenance; current applicability
 * and counterfactual execution are deliberately NOT inferred from old Evidence.
 */
export function replayFrozenWorkflowTrace({snapshot,requestedActions},{signal,deadline}) {
  const active=()=>{
    if(!(signal instanceof AbortSignal))fail('INVALID_ARGUMENT','Replay cancellation signal required');
    if(signal.aborted)fail('CANCELLED','Frozen trace replay cancelled');
    if(!validDate(deadline)||Date.now()>=Date.parse(deadline))fail('TIMEOUT','Original replay task deadline expired');
  };
  active();snapshot=structuredClone(snapshot);requestedActions=structuredClone(requestedActions);
  if(!exact(snapshot,['asOf','sourceVersions','records'])||!validDate(snapshot.asOf)||Date.parse(snapshot.asOf)>Date.now()
    ||!versions(snapshot.sourceVersions)||!Array.isArray(snapshot.records)||!Array.isArray(requestedActions))
    fail('INVALID_ARGUMENT','Frozen asOf/source versions/records and requested actions required');
  const ids=new Set(),calls=new Map();
  for(const record of snapshot.records) {
    active();
    const tool=record?.kind==='tool',specific=tool?['toolName','toolVersion','arguments','argumentsDigest']:['name','version','input','inputDigest'];
    if(!exact(record,[...baseKeys,...specific])||!['tool','decision','model'].includes(record.kind)||!text(record.recordId)||ids.has(record.recordId)
      ||!validDate(record.observedAt)||Date.parse(record.observedAt)>Date.parse(snapshot.asOf)
      ||!['confirmed','failed','unknown'].includes(record.state)||!Array.isArray(record.evidenceRefs)||!record.evidenceRefs.every(text)
      ||!versions(record.sourceVersions)||!same(record.sourceVersions,snapshot.sourceVersions)
      ||record.resultDigest!==workflowTraceDigest(record.result))
      fail('INVALID_ARGUMENT','Frozen record identity/time/version/result Evidence is inconsistent');
    ids.add(record.recordId);
    if(tool) {
      if(!text(record.toolName)||!text(record.toolVersion)||!plain(record.arguments)||!['read','write'].includes(record.effect)
        ||record.argumentsDigest!==workflowTraceDigest(record.arguments))fail('INVALID_ARGUMENT','Frozen tool invocation digest or effect is inconsistent');
      const callKey=key(record),prior=calls.get(callKey)??[];
      if(prior.some(item=>item.resultDigest!==record.resultDigest||item.state!==record.state||item.effect!==record.effect))
        fail('REVISION_CONFLICT','Ambiguous identical historical invocation has different results/state/effect');
      prior.push(record);calls.set(callKey,prior);
    } else if(!text(record.name)||!text(record.version)||record.effect!=='none'||record.inputDigest!==workflowTraceDigest(record.input))
      fail('INVALID_ARGUMENT','Frozen decision/model input digest is inconsistent');
  }
  const actionIds=new Set();
  const actions=requestedActions.map(action=>{
    active();
    if(!exact(action,['actionId','toolName','toolVersion','arguments','argumentsDigest','sourceVersions'])||!text(action.actionId)||actionIds.has(action.actionId)
      ||!text(action.toolName)||!text(action.toolVersion)||!plain(action.arguments)||action.argumentsDigest!==workflowTraceDigest(action.arguments)
      ||!versions(action.sourceVersions)||!same(action.sourceVersions,snapshot.sourceVersions))
      fail('INVALID_ARGUMENT','Replay action identity/digest/source version is inconsistent');
    actionIds.add(action.actionId);
    const matches=calls.get(key(action))??[],refs=[...new Set(matches.flatMap(record=>record.evidenceRefs))];
    const base={actionId:action.actionId,originalRecordIds:matches.map(record=>record.recordId),evidenceRefs:refs,
      actualExecutionVerified:false,counterfactualExecutionVerified:false};
    if(!matches.length)return {...base,state:'counterfactual_unknown',comparability:'counterfactual_unknown',reason:'no_identical_historical_invocation'};
    if(matches.some(record=>record.effect==='write'))return {...base,state:'counterfactual_unknown',comparability:'write_not_replayed',reason:'historical_write_is_timeline_only'};
    const evidenced=matches.filter(record=>record.evidenceRefs.length);
    if(!evidenced.length)return {...base,state:'counterfactual_unknown',comparability:'missing_evidence',reason:'no_confirmed_host_evidence_references'};
    const original=evidenced[0];
    if(original.state==='unknown')return {...base,state:'historical_unknown',historicalState:'unknown',comparability:'historical_unknown',recordedResult:original.result,resultDigest:original.resultDigest};
    return {...base,state:original.state==='failed'?'historical_failed':'reused_historical_read',historicalState:original.state,
      comparability:'exact_historical_read',result:original.result,resultDigest:original.resultDigest};
  });
  const timeline=[...snapshot.records].sort((a,b)=>Date.parse(a.observedAt)-Date.parse(b.observedAt)||a.recordId.localeCompare(b.recordId)).map(record=>({
    record,evidenceStatus:record.evidenceRefs.length?'host_exported_evidence_references':'missing_evidence',
    toolEvidence:record.kind==='tool'&&record.evidenceRefs.length>0,executedDuringReplay:false}));
  active();
  return {snapshotAsOf:snapshot.asOf,sourceVersions:snapshot.sourceVersions,snapshotDigest:workflowTraceDigest(snapshot),timeline,actions,
    actualToolCalls:0,actualModelCalls:0,authority:'data_only_no_tool_grant',currentResultValidity:'not_independently_verified',
    counterfactualComparison:'unknown',provenance:'host_signed_frozen_export_not_new_execution',trainingPerformed:false};
}

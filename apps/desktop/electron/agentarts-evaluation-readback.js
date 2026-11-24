import {isDeepStrictEqual} from 'node:util';
import {ProtocolError} from '@personal-agent/contracts';
import {workflowShadowReleaseDigest as digest} from '@personal-agent/agentarts';
const fail=code=>{throw new ProtocolError(code,'原 AgentArts 评估结果尚未核实');};
const identity=value=>typeof value==='string'&&/^[A-Za-z0-9_.-]{1,128}$/.test(value);

/** Official ListOpsEvaluationTaskResults, bounded to a complete 1–100 item evaluation.
 * The expected input/output hashes must come from original execution, never a score form. */
export async function readAgentArtsEvaluation({taskId,datasetId,datasetVersion,evaluatorId,evaluatorVersion,expected,
  deadline,signal,authorize,assertCurrent,fetchImpl=fetch}){
  if(![taskId,datasetId,datasetVersion,evaluatorId,evaluatorVersion].every(identity)||!Array.isArray(expected)||!expected.length||expected.length>100
    ||new Set(expected.map(item=>item.itemId)).size!==expected.length
    ||expected.some(item=>!identity(item.itemId)||![/^[a-f0-9]{64}$/.test(item.inputDigest),/^[a-f0-9]{64}$/.test(item.outputDigest)].every(Boolean))
    ||typeof authorize!=='function'||typeof assertCurrent!=='function'||!(signal instanceof AbortSignal))fail('INVALID_ARGUMENT');
  const active=()=>{if(signal.aborted)fail('CANCELLED');const remaining=Date.parse(deadline)-Date.now();
    if(!Number.isFinite(remaining)||remaining<=0||remaining>2147483647)fail('TIMEOUT');
    if(assertCurrent()!==undefined)fail('UNAUTHORIZED');return remaining;};
  const url='https://agentarts.cn-southwest-2.myhuaweicloud.com/v1/ops/evaluation-tasks/'+taskId+'/results';
  const body=JSON.stringify({offset:0,limit:100}),headers={Host:new URL(url).hostname,'Content-Type':'application/json',Accept:'application/json'};
  async function read(){
    active();const signed=await authorize({method:'POST',url,body,headers,deadline,signal});active();
    const normalized=new Headers(signed);
    if(!/^SDK-HMAC-SHA256 Access=/.test(normalized.get('authorization')??'')
      ||Object.entries(headers).some(([key,value])=>normalized.get(key)!==value)
      ||[...normalized.keys()].some(key=>!['host','content-type','accept','authorization','x-sdk-date','x-security-token'].includes(key)))fail('UNAUTHORIZED');
    let response;try{response=await fetchImpl(url,{method:'POST',body,headers:signed,redirect:'error',signal:AbortSignal.any([signal,AbortSignal.timeout(active())])});}
    catch{active();fail('EXTERNAL_FAILURE');}
    if(response.status!==200||!response.headers.get('content-type')?.includes('application/json')){await response.body?.cancel().catch(()=>{});fail('EXTERNAL_FAILURE');}
    const reader=response.body?.getReader();if(!reader)fail('PROTOCOL_MISMATCH');let size=0;const chunks=[];
    try{for(;;){const part=await reader.read();active();if(part.done)break;size+=part.value.length;
      if(size>1048576){await reader.cancel();fail('PROTOCOL_MISMATCH');}chunks.push(Buffer.from(part.value));}}
    finally{reader.releaseLock();}
    let data;try{data=JSON.parse(Buffer.concat(chunks).toString('utf8')).data;}catch{fail('PROTOCOL_MISMATCH');}
    if(data?.total!==expected.length||!Array.isArray(data.items)||data.items.length!==expected.length
      ||new Set(data.items.map(item=>item.item_id)).size!==expected.length)fail('REVISION_CONFLICT');
    return expected.map(original=>{
      const item=data.items.find(item=>item.item_id===original.itemId);
      if(!item||item.task_id!==taskId||item.dataset_id!==datasetId||item.dataset_version!==datasetVersion
        ||!Array.isArray(item.item_data)||!Array.isArray(item.agent_output)||item.agent_output.some(value=>typeof value!=='string')
        ||digest(item.item_data)!==original.inputDigest||digest(item.agent_output)!==original.outputDigest
        ||!Array.isArray(item.evaluations))fail('REVISION_CONFLICT');
      const matches=item.evaluations.filter(row=>row.evaluator_id===evaluatorId&&row.evaluator_version===evaluatorVersion),row=matches[0];
      if(matches.length!==1||!Number.isFinite(row.score)||!Number.isFinite(row.latency_s)||row.latency_s<0||row.error
        ||row.correction&&Object.keys(row.correction).length||!Number.isFinite(Date.parse(row.created_at))
        ||row.status_code!==undefined&&!['0','200','SUCCESS','success'].includes(row.status_code))fail('RESULT_UNKNOWN');
      return {...original,score:row.score,evaluatorLatencyMs:row.latency_s*1000,evaluatedAt:row.created_at};
    });
  }
  const items=await read();active();
  if(!isDeepStrictEqual(items,await read()))fail('REVISION_CONFLICT');
  return {taskId,datasetId,datasetVersion,evaluatorId,evaluatorVersion,items,qualityScore:items.reduce((sum,item)=>sum+item.score,0)/items.length,
    source:'agentarts_evaluation_api',digest:digest({taskId,datasetId,datasetVersion,evaluatorId,evaluatorVersion,items})};
}

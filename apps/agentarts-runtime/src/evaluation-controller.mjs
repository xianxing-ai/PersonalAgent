import {createHash} from 'node:crypto';
import {ProtocolError} from '@personal-agent/contracts';
const digest=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const fail=()=>{throw new ProtocolError('INVALID_ARGUMENT','Invalid pinned evaluation experiment');};
const exact=(value,keys)=>value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).sort().join(',')===[...keys].sort().join(',');

/** Read-only paired inference through the same registry consumed by F03. No tools or answer keys. */
export function createEvaluationController({executionModels}){
  if(typeof executionModels?.resolve!=='function')throw new TypeError('Execution model registry required');
  return async({value,deadline,signal,requestId,sessionId})=>{
    if(!exact(value,['evaluationVersion','operation','main','shadow','cases'])||value.evaluationVersion!==1
      ||value.operation!=='paired_model_outputs'||!Array.isArray(value.cases)||value.cases.length<1||value.cases.length>10
      ||new Set(value.cases.map(item=>item?.id)).size!==value.cases.length
      ||value.cases.some(item=>!exact(item,['id','messages'])||typeof item.id!=='string'||!/^[A-Za-z0-9_-]{1,64}$/.test(item.id)
        ||!Array.isArray(item.messages)||!item.messages.length||item.messages.length>10
        ||item.messages.some(message=>!exact(message,['role','content'])||!['system','user'].includes(message.role)
          ||typeof message.content!=='string'||!message.content.trim()||message.content.length>16000)))fail();
    const input=structuredClone(value),models={main:executionModels.resolve(input.main),shadow:executionModels.resolve(input.shadow)};
    const active=()=>{signal.throwIfAborted();if(!Number.isFinite(Date.parse(deadline))||Date.now()>=Date.parse(deadline))
      throw new ProtocolError('TIMEOUT','Original evaluation deadline expired');};
    const branches={main:[],shadow:[]};
    for(const item of input.cases)for(const branch of ['main','shadow']){
      active();const startedAt=new Date().toISOString(),start=performance.now();
      const result=await models[branch].complete({messages:item.messages,tools:[],deadline,signal});active();
      if(result?.response?.kind!=='final'||typeof result.response.text!=='string'||!result.response.text.trim()
        ||result.response.text.length>64000)throw new ProtocolError('PROTOCOL_MISMATCH','Evaluation requires actual final model text');
      branches[branch].push({id:item.id,inputDigest:digest(item.messages),output:result.response.text,startedAt,
        finishedAt:new Date().toISOString(),wallMs:performance.now()-start,modelCalls:1,deployment:result.deployment});
    }
    return {evaluationVersion:1,requestId,sessionId,inputDigest:digest(input),branches};
  };
}

import assert from 'node:assert/strict';

// Explicit test-only transport. Never import this helper from a manual/live run.
export const syntheticPublicPayloadGate=async scope=>({assertBeforeSend(actual){
  assert.equal(scope.signal.aborted,false);assert.ok(Date.parse(scope.deadline)>Date.now());
  assert.equal(scope.isCurrent(),true);assert.equal(actual.destination,scope.destination);assert.equal(actual.payload,scope.payload);
}});

function requestEnvelope(payload,{workflowGoalInput:key}={}){
  const encoded=key===undefined?payload.query:payload.inputs[key],envelope=JSON.parse(encoded);
  assert.deepEqual(Object.keys(envelope).sort(),['executionEpoch','executionEpochVersion','query']);
  assert.equal(envelope.executionEpochVersion,1);assert.ok(Number.isSafeInteger(envelope.executionEpoch)&&envelope.executionEpoch>=0);
  assert.equal(typeof envelope.query,'string');return envelope;
}
export const syntheticAgentArtsQuery=(payload,options)=>requestEnvelope(payload,options).query;
export function syntheticAgentArtsResult(payload,result,options){
  const {executionEpoch}=requestEnvelope(payload,options);
  return JSON.stringify({executionEpochVersion:1,executionEpoch,result});
}

export function syntheticAgentArtsOptions(options){
  assert.equal(typeof options.fetchImpl,'function','Synthetic composition requires its explicit fake fetch');
  const fakeFetch=options.fetchImpl;
  return {...options,preparePayload:options.preparePayload??syntheticPublicPayloadGate,
    fetchImpl:async(url,init)=>{
      const body=JSON.parse(init.body),key=options.workflowGoalInput;
      const envelope=requestEnvelope(body,options);
      const payload=key===undefined?{...body,query:envelope.query}:{...body,inputs:{...body.inputs,[key]:envelope.query}};
      const response=await fakeFetch(url,{...init,body:JSON.stringify(payload)});
      if(!response.ok||!response.headers.get('content-type')?.startsWith('application/json'))return response;
      const text=await response.clone().text();let value;try{value=JSON.parse(text);}catch{return response;}
      const messages=(Array.isArray(value)?value:[value]).filter(item=>item?.event==='message'&&typeof item.data?.text==='string');
      if(messages.length!==1)return response;
      let result=messages[0].data.text;
      if(options.responseMode==='tool-proposal-json'){try{result=JSON.parse(result);}catch{return response;}}
      messages[0].data.text=JSON.stringify({executionEpochVersion:1,executionEpoch:envelope.executionEpoch,result});
      return new Response(JSON.stringify(value),{status:response.status,statusText:response.statusText,headers:response.headers});
    }};
}

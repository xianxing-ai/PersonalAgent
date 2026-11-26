// Explicit synthetic transport for the actual Competition main/preload/renderer.
// No real account, model, microphone or external network is used.
const revision='a'.repeat(64);
const catalog={version:'1.0',revision,defaultModelId:'deepseek-v4.1-flash',models:[
  {id:'deepseek-v4.1-flash',displayName:'Synthetic A',type:'text',availability:'available',requestProfile:'standard',reasoningEfforts:['low','medium','high']},
  {id:'qwen3.8-max',displayName:'Synthetic B',type:'text',availability:'available',requestProfile:'standard',reasoningEfforts:['max']},
  {id:'glm-5.3',displayName:'Synthetic Default',type:'text',availability:'available',requestProfile:'standard',reasoningEfforts:[]},
  {id:'synthetic-catalog-only',displayName:'Catalog-only model',type:'text',availability:'available',requestProfile:'standard',reasoningEfforts:[]},
]};
globalThis.reasoningSliderSmoke={queries:[],unexpectedRequests:0};
globalThis.fetch=async(url,init)=>{
  if(String(url)!=='https://synthetic.huaweicloud-agentarts.com/runtimes/synthetic-slider/invocations'){
    globalThis.reasoningSliderSmoke.unexpectedRequests++;throw Error('No external network permitted by slider fixture');
  }
  const envelope=JSON.parse(JSON.parse(init.body).query);
  const epoch=envelope.executionEpochVersion===1?envelope.executionEpoch:undefined;
  const query=epoch===undefined?envelope:JSON.parse(envelope.query);
  if(query.modelCatalogVersion==='1.0')return new Response(JSON.stringify([
    {event:'message',data:{text:JSON.stringify(catalog),index:0}},{event:'task_end',data:{}},{event:'end',data:{}},
  ]),{headers:{'content-type':'application/json'}});
  globalThis.reasoningSliderSmoke.queries.push(query);
  const result={kind:'text',text:'synthetic slider response'};
  const payload=epoch===undefined?result:{executionEpochVersion:1,executionEpoch:epoch,result};
  return new Response(JSON.stringify({event:'message',data:{text:JSON.stringify(payload),index:0}}),{headers:{'content-type':'application/json'}});
};
await import('../electron/main.js');

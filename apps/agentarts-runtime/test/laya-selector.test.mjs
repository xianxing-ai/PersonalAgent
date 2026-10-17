import assert from 'node:assert/strict';
import test from 'node:test';
import {createOwnedLayaSelector} from '../src/laya-selector.mjs';

const input=()=>({context:'Synthetic candidate data, not authorization',requestId:'synthetic',
  candidates:[{id:'proposal',description:'Use exact validated proposal'},{id:'review',description:'Review insufficient evidence'}],
  deadline:new Date(Date.now()+1000).toISOString(),signal:new AbortController().signal});
const completeWindow=()=>({formatVersion:'1.0.0',encoderMaxTokens:8192,maxLength:1024,headMaxLength:256,
  headerTokens:[39],stateTokens:[60],requiredSequenceTokens:[100],expectedInputTokens:[100],encodedTokens:100,droppedTokens:0,truncated:false});
const answer=(overrides={})=>({tokenWindow:completeWindow(),answers:{decision:{choice:'candidate_0',probabilities:{candidate_0:0.8,candidate_1:0.2},answer_confidence:0.8,confidence:0.7,...overrides}}});
test('owned selector uses same typed choice API, original deadline and a loopback bearer only',async()=>{
  let payload;
  const selector=createOwnedLayaSelector({port:8123,getApiKey:()=> 'synthetic-key',request:async(url,options)=>{
    assert.equal(url,'http://127.0.0.1:8123/v1/systemone');assert.equal(options.headers.authorization,'Bearer synthetic-key');
    assert.equal(options.redirect,'error');payload=JSON.parse(options.body);return Response.json(answer());
  }});
  const original=input();assert.equal(await selector.select(original),'proposal');assert.equal(payload.deadline,original.deadline);
  assert.equal(payload.model,'multilingual');assert.deepEqual(Object.keys(payload.questions.decision.criteria),['candidate_0','candidate_1']);
  assert.equal(typeof payload.state,'string');assert.ok(payload.state.includes(original.context));
  assert.ok(payload.state.includes('"criterion":"candidate_0","id":"proposal"'));
  assert.equal(JSON.stringify(payload).includes('synthetic-key'),false);
});
test('shared selector retains legacy input/proposal without inventing a current workflow node',async()=>{
  let payload;const context=JSON.stringify({input:{goal:'Check a public proposal'},proposal:{kind:'text',text:'public source-supported candidate'}});
  const selector=createOwnedLayaSelector({port:8123,getApiKey:()=> 'synthetic-key',request:async(_url,options)=>{
    payload=JSON.parse(options.body);return Response.json(answer());
  }});
  assert.equal(await selector.select({...input(),context}),'proposal');
  assert.ok(payload.state.includes(context));assert.equal(payload.state.includes('"nodeContract"'),false);
  assert.equal(payload.state.includes('"currentCandidateBoundary"'),false);
  assert.match(payload.questions.decision.instructions,/When a current-node contract and candidate boundary are supplied/);
  assert.match(payload.questions.decision.instructions,/Otherwise assess the supplied proposal/);
});
test('long JSON context and full descriptions survive as raw state with explicit candidate identities',async()=>{
  const context=JSON.stringify({source:'public source '.repeat(100),tail:'last evidence must remain'});
  const description='public supported detail '.repeat(70)+'description tail';let payload,receipt;
  const selector=createOwnedLayaSelector({port:8123,getApiKey:()=> 'synthetic-key',onDecision:value=>receipt=value,
    request:async(_url,options)=>{
      payload=JSON.parse(options.body);const value=answer();
      value.tokenWindow={...completeWindow(),maxLength:1500,stateTokens:[1400],headerTokens:[39],
        requiredSequenceTokens:[1440],expectedInputTokens:[1440],encodedTokens:1440};return Response.json(value);
    }});
  assert.equal(await selector.select({...input(),context,candidates:[{id:'proposal',description},{id:'review',description:'Review'}]}),'proposal');
  assert.ok(payload.state.includes(context),'JSON text is not escaped inside another context JSON string');
  assert.ok(payload.state.includes(description),'The full description is in state despite SDK short option headers');
  assert.equal(receipt.tokenWindow.droppedTokens,0);assert.ok(receipt.tokenWindow.encodedTokens>1024);
  assert.ok(Number.isFinite(receipt.queueWaitMs));
});
test('missing or truncated token readback cannot admit a candidate',async()=>{
  for(const window of [undefined,{...completeWindow(),truncated:true},{...completeWindow(),droppedTokens:1},
    {...completeWindow(),encodedTokens:99},{...completeWindow(),maxLength:8193},{...completeWindow(),headerTokens:[1]}]) {
    const selector=createOwnedLayaSelector({port:8123,getApiKey:()=> 'synthetic-key',request:async()=>{
      const value=answer();value.tokenWindow=window;return Response.json(value);
    }});
    await assert.rejects(selector.select(input()),{code:'EXTERNAL_FAILURE'});
  }
});
test('encoder overflow requests scoped evidence and does not fabricate a review selection or retry',async()=>{
  let calls=0;const selector=createOwnedLayaSelector({port:8123,getApiKey:()=> 'synthetic-key',request:async()=>{
    calls++;return Response.json({detail:{code:'CONTEXT_WINDOW_EXCEEDED'}},{status:413});
  }});
  await assert.rejects(selector.select(input()),{code:'UNSUPPORTED_CAPABILITY'});assert.equal(calls,1);
});
test('413 diagnostics distinguish encoder overflow from input bounds without leaking arbitrary error fields',async()=>{
  for(const detail of [{code:'CONTEXT_WINDOW_EXCEEDED',requiredTokens:8193,encoderMaxTokens:8192,
    scope:'synthetic-private-scope',path:'synthetic-private-path'},'synthetic-private-error-text']) {
    let receipt;const selector=createOwnedLayaSelector({port:8123,getApiKey:()=> 'synthetic-key',onDecision:value=>receipt=value,
      request:async()=>Response.json({detail},{status:413})});
    await assert.rejects(selector.select(input()),{code:'UNSUPPORTED_CAPABILITY'});
    assert.equal(receipt.event,'laya_rejected');assert.equal(receipt.httpStatus,413);assert.equal(receipt.candidateCount,2);
    assert.equal(Object.hasOwn(receipt,'candidateId'),false,'No model selection is invented');
    assert.equal(receipt.errorCode,typeof detail==='string'?'HTTP_413':'CONTEXT_WINDOW_EXCEEDED');
    if(typeof detail!=='string')assert.equal(receipt.requiredTokens,8193);
    assert.equal(JSON.stringify(receipt).includes('synthetic-private'),false);
  }
});
test('delay diagnostics distinguish phases and project numeric cgroup fields without source text',async()=>{
  let receipt;const selector=createOwnedLayaSelector({port:8123,getApiKey:()=> 'synthetic-key',onDecision:value=>receipt=value,
    request:async()=>{
      const result=answer();result.tokenWindow.privateText='synthetic-private-context';
      result.inferenceMetrics={formatVersion:'1.0.0',precheckMs:1,forwardMs:2,processCpuMs:3,
        precheckProcessCpuMs:1,forwardProcessCpuMs:2,forwardScope:'sdk_predict_batch',privateText:'synthetic-private-context',
        cgroupBefore:{status:'available',cpuStat:{status:'available',values:{usage_usec:10,privateText:'synthetic-private-context'}},
          cpuMax:{status:'available',quotaUs:200000,periodUs:100000},memoryCurrent:{status:'missing'},memoryMax:{status:'unsupported'}},
        cgroupAfter:{status:'missing'},cgroupCpuDelta:{status:'available',values:{usage_usec:3}}};
      return Response.json(result);
    }});
  await selector.select(input());assert.equal(receipt.candidateCount,2);assert.equal(receipt.encodedTokens,100);
  for(const field of ['queueWaitMs','busyWaitMs','internalHttpMs','responseValidationMs','choiceWallMs','endToEndMs']) {
    assert.ok(Number.isFinite(receipt[field])&&receipt[field]>=0);
  }
  assert.equal(receipt.inferenceMetrics.precheckMs,1);assert.equal(receipt.inferenceMetrics.forwardMs,2);
  assert.deepEqual(receipt.inferenceMetrics.cgroupBefore.memoryCurrent,{status:'missing'});
  assert.equal(JSON.stringify(receipt).includes('synthetic-private-context'),false);
});
test('invalid selection, probability identity or confidence cannot manufacture a candidate',async()=>{
  for(const overrides of [{choice:'execute-anything'},{probabilities:{candidate_0:0.8,candidate_7:0.2}},
    {choice:'candidate_1'},{answer_confidence:1},{probabilities:{candidate_0:0.8,candidate_1:0.8}}]) {
    const selector=createOwnedLayaSelector({port:8123,getApiKey:()=> 'synthetic-key',request:async()=>Response.json(answer(overrides))});
    await assert.rejects(selector.select(input()),error=>error.code==='EXTERNAL_FAILURE');
  }
});
test('cancellation, expired deadline and unavailable instance never start another inference',async()=>{
  let calls=0;const selector=createOwnedLayaSelector({port:8123,getApiKey:()=> 'synthetic-key',request:async()=>{calls++;return Response.json(answer());}});
  const original=input(), control=new AbortController();control.abort();
  await assert.rejects(selector.select({...original,signal:control.signal}),error=>error.code==='CANCELLED');
  await assert.rejects(selector.select({...original,deadline:'2020-01-01T00:00:00Z'}),error=>error.code==='TIMEOUT');
  assert.equal(calls,0);
  const unavailable=createOwnedLayaSelector({port:8123,getApiKey:()=> 'synthetic-key',isReady:()=>false,request:async()=>{calls++;}});
  await assert.rejects(unavailable.select(input()),error=>error.code==='EXTERNAL_FAILURE');assert.equal(calls,0);
});
test('accepted-call timeout and service failure remain explicit without inference replay or fallback',async()=>{
  for(const [status,code] of [[408,'TIMEOUT'],[503,'EXTERNAL_FAILURE']]) {
    let calls=0;const selector=createOwnedLayaSelector({port:8123,getApiKey:()=> 'synthetic-key',request:async()=>{calls++;return new Response('',{status});}});
    await assert.rejects(selector.select(input()),error=>error.code===code);assert.equal(calls,1);
  }
});
test('concurrent decisions share one forward queue and keep independent original candidates',async()=>{
  let release, started, posts=0, inFlight=0, peak=0;
  const first=new Promise(resolve=>release=resolve), entered=new Promise(resolve=>started=resolve);
  const selector=createOwnedLayaSelector({port:8123,getApiKey:()=> 'synthetic-key',request:async(_url,options)=>{
    posts++;inFlight++;peak=Math.max(peak,inFlight);if(posts===1){started();await first;}
    const response=Response.json(answer());inFlight--;return response;
  }});
  const a=selector.select(input());await entered;
  const b=selector.select({...input(),candidates:[{id:'other-proposal',description:'other unchanged proposal'}, {id:'other-review',description:'other review'}]});
  await new Promise(resolve=>setImmediate(resolve));assert.equal(posts,1);release();
  assert.deepEqual(await Promise.all([a,b]),['proposal','other-proposal']);assert.equal(peak,1);
});
test('queued cancellation and expiry never submit, renew deadline or consume another candidate result',async()=>{
  let release, started, posts=0;
  const first=new Promise(resolve=>release=resolve), entered=new Promise(resolve=>started=resolve);
  const selector=createOwnedLayaSelector({port:8123,getApiKey:()=> 'synthetic-key',request:async()=>{
    posts++;if(posts===1){started();await first;}return Response.json(answer());
  }});
  const a=selector.select(input());await entered;
  const cancellation=new AbortController();
  const b=selector.select({...input(),signal:cancellation.signal});const cancelled=assert.rejects(b,error=>error.code==='CANCELLED');cancellation.abort();await cancelled;
  const c=selector.select({...input(),deadline:new Date(Date.now()+20).toISOString()});await assert.rejects(c,error=>error.code==='TIMEOUT');
  assert.equal(posts,1);release();assert.equal(await a,'proposal');
  assert.equal(await selector.select(input()),'proposal');assert.equal(posts,2);
});
test('rejected 429 waits for authenticated prior CPU completion before one accepted forward',async()=>{
  let posts=0,healthReads=0;
  const selector=createOwnedLayaSelector({port:8123,getApiKey:()=> 'synthetic-key',request:async(url,options)=>{
    if(url.endsWith('/health')) {
      healthReads++;assert.equal(options.headers.authorization,'Bearer synthetic-key');
      return Response.json({status:'ok',model:'multilingual',warmed:true,inferenceBusy:healthReads<2});
    }
    posts++;return posts===1?new Response('',{status:429}):Response.json(answer());
  }});
  assert.equal(await selector.select(input()),'proposal');assert.equal(posts,2);assert.equal(healthReads,2);
});
test('after an accepted timeout the next choice checks CPU admission instead of overlapping it',async()=>{
  let posts=0,healthReads=0;
  const selector=createOwnedLayaSelector({port:8123,getApiKey:()=> 'synthetic-key',request:async(url)=>{
    if(url.endsWith('/health')) {healthReads++;return Response.json({status:'ok',model:'multilingual',warmed:true,inferenceBusy:healthReads<2});}
    posts++;return posts===1?new Response('',{status:408}):Response.json(answer());
  }});
  await assert.rejects(selector.select(input()),error=>error.code==='TIMEOUT');
  assert.equal(await selector.select(input()),'proposal');assert.equal(posts,2);assert.equal(healthReads,2);
});

const independentMetrics=()=>({formatVersion:'1.0.0',precheckMs:1,forwardMs:2,processCpuMs:3,
  precheckProcessCpuMs:1,forwardProcessCpuMs:2,forwardScope:'sdk_heterogeneous_forward'});
const independentResult=(payload,result=answer(),size=payload.items.length)=>({...result,
  sharedForward:{batchId:payload.batchId,batchSize:size},inferenceMetrics:independentMetrics()});
const independentReply=(payload,edit=items=>items)=>({batching:'independent_items',batchId:payload.batchId,
  items:edit(payload.items.map(item=>({itemId:item.itemId,result:independentResult(payload)})))});
const decisionFor=(keys,index)=>answer({choice:keys[index],probabilities:Object.fromEntries(keys.map((key,i)=>[key,i===index?0.8:0.2/(keys.length-1)]))});

test('same-turn independent contexts and criteria use one batch and opaque identities despite repeated requestId',async()=>{
  let payload,posts=0;const receipts=[];
  const selector=createOwnedLayaSelector({cpuExecutionPolicy:'packed',port:8123,getApiKey:()=> 'synthetic-key',onDecision:value=>receipts.push(value),
    request:async(url,options)=>{
      posts++;assert.ok(url.endsWith('/v1/systemone/independent-batch'));payload=JSON.parse(options.body);
      assert.notEqual(payload.items[0].itemId,payload.items[1].itemId);
      assert.equal(payload.items[0].state.includes('first private-to-item context'),true);
      assert.equal(payload.items[1].state.includes('first private-to-item context'),false);
      assert.deepEqual(Object.keys(payload.items[1].questions.decision.criteria),['candidate_0','candidate_1','candidate_2']);
      return Response.json(independentReply(payload,rows=>[
        {...rows[1],result:independentResult(payload,decisionFor(['candidate_0','candidate_1','candidate_2'],2))},
        {...rows[0],result:independentResult(payload,decisionFor(['candidate_0','candidate_1'],1))}]));
    }});
  const a=input(),b={...input(),context:'second distinct context',candidates:[{id:'second-A',description:'A'},
    {id:'second-B',description:'B'},{id:'second-C',description:'C'}]};a.context='first private-to-item context';
  const promises=[selector.select(a),selector.select(b)];b.candidates[2].description='MUTATED AFTER SNAPSHOT';
  assert.deepEqual(await Promise.all(promises),['review','second-C']);assert.equal(posts,1);
  assert.equal(JSON.stringify(payload).includes('MUTATED AFTER SNAPSHOT'),false);
  assert.equal(payload.items[0].deadline,a.deadline);assert.equal(payload.items[1].deadline,b.deadline);
  assert.equal(receipts.length,2);assert.equal(receipts[0].batchId,receipts[1].batchId);
  assert.equal(receipts[0].batchSize,2);assert.equal(receipts[0].sharedForwardScope,'sdk_heterogeneous_forward');
});

test('five same-turn requests preserve FIFO and cap the first batch at four',async()=>{
  const groups=[];const selector=createOwnedLayaSelector({cpuExecutionPolicy:'packed',port:8123,getApiKey:()=> 'synthetic-key',request:async(_url,options)=>{
    const payload=JSON.parse(options.body);groups.push(payload.items?.map(item=>item.state)??[payload.state]);
    return Response.json(payload.items?independentReply(payload):answer());
  }});
  assert.deepEqual(await Promise.all(Array.from({length:5},(_,index)=>selector.select({...input(),context:'FIFO-'+index}))),Array(5).fill('proposal'));
  assert.deepEqual(groups.map(group=>group.length),[4,1]);
  groups.flat().forEach((state,index)=>assert.ok(state.includes('FIFO-'+index)));
});

test('cancelling one admitted batch item leaves its sibling HTTP and result alive',async()=>{
  let release,entered,transportSignal;const started=new Promise(resolve=>entered=resolve),blocked=new Promise(resolve=>release=resolve),receipts=[];
  const selector=createOwnedLayaSelector({cpuExecutionPolicy:'packed',port:8123,getApiKey:()=> 'synthetic-key',onDecision:value=>receipts.push(value),
    request:async(_url,options)=>{transportSignal=options.signal;const payload=JSON.parse(options.body);entered();await blocked;return Response.json(independentReply(payload));}});
  const cancellation=new AbortController(),a=selector.select({...input(),signal:cancellation.signal}),b=selector.select({...input(),requestId:'survivor'});
  const rejected=assert.rejects(a,{code:'CANCELLED'});await started;cancellation.abort();await rejected;
  assert.equal(transportSignal.aborted,false);release();assert.equal(await b,'proposal');
  assert.deepEqual(receipts.map(receipt=>receipt.requestId),['survivor']);
});

test('one original deadline expiring in a batch cannot shorten another item deadline or revive late result',async()=>{
  let transportSignal;const receipts=[];
  const selector=createOwnedLayaSelector({cpuExecutionPolicy:'packed',port:8123,getApiKey:()=> 'synthetic-key',onDecision:value=>receipts.push(value),request:async(_url,options)=>{
    transportSignal=options.signal;const payload=JSON.parse(options.body);await new Promise(resolve=>setTimeout(resolve,70));
    assert.equal(transportSignal.aborted,false);return Response.json(independentReply(payload));
  }});
  const a=selector.select({...input(),deadline:new Date(Date.now()+25).toISOString(),requestId:'expired'}),b=selector.select({...input(),requestId:'live'});
  await assert.rejects(a,{code:'TIMEOUT'});assert.equal(await b,'proposal');assert.deepEqual(receipts.map(item=>item.requestId),['live']);
});

test('all abandoned batch items abort HTTP but next batch waits for non-preemptible CPU admission',async()=>{
  let entered,healthEntered,releaseCpu,posts=0,healthReads=0,cpuBusy=true;
  const started=new Promise(resolve=>entered=resolve),healthStarted=new Promise(resolve=>healthEntered=resolve);
  const selector=createOwnedLayaSelector({cpuExecutionPolicy:'packed',port:8123,getApiKey:()=> 'synthetic-key',request:async(url,options)=>{
    if(url.endsWith('/health')){healthReads++;healthEntered();return Response.json({status:'ok',model:'multilingual',warmed:true,inferenceBusy:cpuBusy});}
    posts++;if(posts===1){entered();return new Promise((resolve,reject)=>{
      options.signal.addEventListener('abort',()=>reject(new Error('synthetic HTTP waiter ended')),{once:true});releaseCpu=()=>{cpuBusy=false;};
    });}return Response.json(answer());
  }});
  const ca=new AbortController(),cb=new AbortController();
  const a=selector.select({...input(),signal:ca.signal}),b=selector.select({...input(),signal:cb.signal});
  const rejected=Promise.all([assert.rejects(a,{code:'CANCELLED'}),assert.rejects(b,{code:'CANCELLED'})]);
  await started;ca.abort();cb.abort();await rejected;
  const c=selector.select(input());await healthStarted;assert.equal(posts,1);releaseCpu();
  assert.equal(await c,'proposal');assert.equal(posts,2);assert.ok(healthReads>=2);
});

test('batch identity corruption is rejected before any candidate is delivered',async()=>{
  for(const corrupt of [value=>({...value,batchId:'other-batch'}),value=>({...value,items:value.items.slice(1)}),
    value=>({...value,items:[value.items[0],value.items[0]]}),
    value=>({...value,items:[value.items[0],{...value.items[1],itemId:'unknown-item'}]}),
    value=>({...value,items:[value.items[0],{...value.items[1],error:{status:400,code:'INVALID_ARGUMENT'}}]})]) {
    const receipts=[];let posts=0;
    const selector=createOwnedLayaSelector({cpuExecutionPolicy:'packed',port:8123,getApiKey:()=> 'synthetic-key',onDecision:value=>receipts.push(value),request:async(_url,options)=>{
      posts++;return Response.json(corrupt(independentReply(JSON.parse(options.body))));
    }});
    const result=await Promise.allSettled([selector.select(input()),selector.select(input())]);
    assert.equal(result.every(item=>item.status==='rejected'&&item.reason.code==='EXTERNAL_FAILURE'),true);
    assert.equal(receipts.length,0);assert.equal(posts,1);
  }
});

test('one invalid result or explicit context overflow cannot contaminate a good independent item',async()=>{
  for(const bad of [{result:answer({choice:'not-a-candidate'})},{error:{status:413,code:'CONTEXT_WINDOW_EXCEEDED',requiredTokens:9000,encoderMaxTokens:8192}}]) {
    let posts=0;const selector=createOwnedLayaSelector({cpuExecutionPolicy:'packed',port:8123,getApiKey:()=> 'synthetic-key',request:async(_url,options)=>{
      posts++;const payload=JSON.parse(options.body);return Response.json(independentReply(payload,rows=>[{itemId:rows[0].itemId,...bad},rows[1]]));
    }});
    const result=await Promise.allSettled([selector.select(input()),selector.select(input())]);
    assert.equal(result[0].status,'rejected');assert.equal(result[0].reason.code,bad.error?'UNSUPPORTED_CAPABILITY':'EXTERNAL_FAILURE');
    assert.deepEqual(result[1],{status:'fulfilled',value:'proposal'});assert.equal(posts,1);
  }
});

test('precise UTF-8 admission splits large items and rejects an oversized item without blocking a sibling',async()=>{
  let posts=0;const selector=createOwnedLayaSelector({cpuExecutionPolicy:'packed',port:8123,getApiKey:()=> 'synthetic-key',request:async(url,options)=>{
    posts++;assert.ok(url.endsWith('/v1/systemone'));assert.ok(Buffer.byteLength(options.body,'utf8')<=131072);return Response.json(answer());
  }});
  const large={...input(),candidates:[{id:'proposal',description:'中文'.repeat(4000)},{id:'review',description:'中文'.repeat(4000)}]};
  assert.deepEqual(await Promise.all([selector.select(large),selector.select(large)]),['proposal','proposal']);assert.equal(posts,2);
  const oversized=selector.select({...input(),context:'x'.repeat(50001)}),good=selector.select(input());
  await assert.rejects(oversized,{code:'UNSUPPORTED_CAPABILITY'});assert.equal(await good,'proposal');assert.equal(posts,3);
});

test('shared forward provenance is checked and actual forward size is distinct from submitted size',async()=>{
  for(const corrupt of [value=>{delete value.sharedForward;},value=>{value.sharedForward.batchId='wrong';},
    value=>{value.sharedForward.batchSize=3;},value=>{value.inferenceMetrics.forwardScope='sdk_predict_batch';}]) {
    const selector=createOwnedLayaSelector({cpuExecutionPolicy:'packed',port:8123,getApiKey:()=> 'synthetic-key',request:async(_url,options)=>{
      const payload=JSON.parse(options.body),value=independentReply(payload);corrupt(value.items[0].result);return Response.json(value);
    }});
    const result=await Promise.allSettled([selector.select(input()),selector.select(input())]);
    assert.equal(result[0].status,'rejected');assert.equal(result[0].reason.code,'EXTERNAL_FAILURE');
    assert.deepEqual(result[1],{status:'fulfilled',value:'proposal'});
  }
  const receipts=[];const selector=createOwnedLayaSelector({cpuExecutionPolicy:'packed',port:8123,getApiKey:()=> 'synthetic-key',onDecision:value=>receipts.push(value),
    request:async(_url,options)=>{
      const payload=JSON.parse(options.body);return Response.json(independentReply(payload,rows=>[
        {itemId:rows[0].itemId,error:{status:413,code:'INVALID_ARGUMENT'}},
        {itemId:rows[1].itemId,result:independentResult(payload,answer(),1)}]));
    }});
  const result=await Promise.allSettled([selector.select(input()),selector.select(input())]);
  assert.equal(result[0].reason.code,'UNSUPPORTED_CAPABILITY');assert.equal(result[1].value,'proposal');
  const choice=receipts.find(value=>value.event==='laya_choice'),rejected=receipts.find(value=>value.event==='laya_rejected');
  assert.equal(choice.submittedBatchSize,2);assert.equal(choice.batchSize,1);
  assert.equal(rejected.stage,'bound_rejection');assert.equal(rejected.errorCode,'HTTP_413');
  assert.notEqual(choice.batchItemId,rejected.batchItemId);
});

test('only explicitly rejected batch admission is retried after authenticated idle readback',async()=>{
  let posts=0,reads=0,firstPayload;
  const selector=createOwnedLayaSelector({cpuExecutionPolicy:'packed',port:8123,getApiKey:()=> 'synthetic-key',request:async(url,options)=>{
    if(url.endsWith('/health')){reads++;return Response.json({status:'ok',model:'multilingual',warmed:true,inferenceBusy:false});}
    const payload=JSON.parse(options.body);posts++;
    if(posts===1){firstPayload=payload;return new Response('',{status:429});}
    assert.deepEqual(payload,firstPayload);return Response.json(independentReply(payload));
  }});
  assert.deepEqual(await Promise.all([selector.select(input()),selector.select(input())]),['proposal','proposal']);
  assert.equal(posts,2);assert.equal(reads,1);
});

test('default CPU strategy dispatches one item immediately and delivers it before a queued sibling',async()=>{
  let releaseFirst,releaseSecond,posts=0;const receipts=[];
  const first=new Promise(resolve=>releaseFirst=resolve),second=new Promise(resolve=>releaseSecond=resolve);
  const selector=createOwnedLayaSelector({port:8123,getApiKey:()=> 'synthetic-key',onDecision:value=>receipts.push(value),request:async(url,options)=>{
    posts++;assert.ok(url.endsWith('/v1/systemone'));assert.equal(JSON.parse(options.body).items,undefined);
    if(posts===1)await first;else await second;return Response.json(answer());
  }});
  const a=selector.select({...input(),requestId:'first'});assert.equal(posts,1,'No batching timer delays the first CPU item');
  let bDone=false;const b=selector.select({...input(),requestId:'second'}).then(value=>{bDone=true;return value;});
  assert.equal(posts,1);releaseFirst();assert.equal(await a,'proposal');assert.equal(bDone,false);
  await new Promise(resolve=>setImmediate(resolve));assert.equal(posts,2);releaseSecond();assert.equal(await b,'proposal');
  assert.equal(receipts.length,2);assert.notEqual(receipts[0].forwardId,receipts[1].forwardId);
  for(const receipt of receipts){assert.equal(receipt.executionPolicy,'sequential');assert.equal(receipt.forwardCount,1);assert.equal(receipt.batchSize,1);assert.equal(receipt.sharedForwardScope,undefined);}
});

test('unknown CPU policy cannot silently select packed execution',()=>{
  assert.throws(()=>createOwnedLayaSelector({port:8123,getApiKey:()=> 'synthetic-key',cpuExecutionPolicy:'online-autotune'}),{code:'INVALID_ARGUMENT'});
});

test('new packed execution metadata binds an actual forward and rejects a mismatched trusted policy',async()=>{
  for(const mismatch of [false,true]) {
    const receipts=[];const selector=createOwnedLayaSelector({cpuExecutionPolicy:'packed',port:8123,getApiKey:()=> 'synthetic-key',onDecision:value=>receipts.push(value),
      request:async(_url,options)=>{
        const payload=JSON.parse(options.body),data=independentReply(payload);
        data.execution={policy:mismatch?'sequential':'packed',forwardCount:1};
        data.preparationMetrics={wallMs:5,processCpuMs:3,privateText:'never exported'};
        for(const row of data.items){row.result.forward={forwardId:'aa000000-0000-4000-8000-000000000000',index:1,itemCount:2,
          scope:'sdk_heterogeneous_forward',batchId:payload.batchId};row.result.inferenceMetrics.precheckScope='forward_group_collation';}
        return Response.json(data);
      }});
    const result=await Promise.allSettled([selector.select(input()),selector.select(input())]);
    if(mismatch){assert.equal(result.every(item=>item.status==='rejected'),true);assert.equal(receipts.length,0);}
    else {assert.equal(result.every(item=>item.status==='fulfilled'),true);assert.equal(receipts[0].forwardId,receipts[1].forwardId);assert.equal(receipts[0].forwardCount,1);
      assert.deepEqual(receipts[0].preparationMetrics,{scope:'http_batch_preparation',batchId:receipts[0].batchId,wallMs:5,processCpuMs:3});
      assert.deepEqual(receipts[0].preparationMetrics,receipts[1].preparationMetrics);
      assert.equal(receipts[0].inferenceMetrics.precheckScope,'forward_group_collation');assert.equal(JSON.stringify(receipts).includes('never exported'),false);}
  }
});

test('new execution receipts cannot hide missing or invalid HTTP preparation cost',async()=>{
  for(const preparationMetrics of [undefined,{wallMs:-1,processCpuMs:0},{wallMs:1,processCpuMs:null}]) {
    const selector=createOwnedLayaSelector({cpuExecutionPolicy:'packed',port:8123,getApiKey:()=> 'synthetic-key',request:async(_url,options)=>{
      const payload=JSON.parse(options.body),data=independentReply(payload);data.execution={policy:'packed',forwardCount:1};
      data.preparationMetrics=preparationMetrics;return Response.json(data);
    }});
    const result=await Promise.allSettled([selector.select(input()),selector.select(input())]);
    assert.equal(result.every(item=>item.status==='rejected'&&item.reason.code==='EXTERNAL_FAILURE'),true);
  }
});

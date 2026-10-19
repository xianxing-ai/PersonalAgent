// Synthetic public pelican fixture only. Diagnostic timings include observation overhead.
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {randomBytes,createHash} from 'node:crypto';
import {readFile,writeFile,mkdir,mkdtemp} from 'node:fs/promises';
import {createInterface} from 'node:readline';
import {createServer} from 'node:net';
import {resolve,join} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {once} from 'node:events';

const root=fileURLToPath(new URL('../../../',import.meta.url)),chunks=[];
for await(const chunk of process.stdin)chunks.push(chunk);
const config=JSON.parse(Buffer.concat(chunks).toString('utf8'));
const sourceRoot=resolve(config.implementationRoot);
const source=JSON.parse(await readFile(join(sourceRoot,'tests/manual/agentarts/fixtures/pelican-source-read-decision.json'),'utf8'));
const {createOwnedLayaSelector}=await import(pathToFileURL(join(sourceRoot,'apps/agentarts-runtime/src/laya-selector.mjs')));
const sha=value=>createHash('sha256').update(typeof value==='string'?value:JSON.stringify(value)).digest('hex');
const deadline=new Date(Date.now()+15*60*1000).toISOString();
const parent=join(root,'.cache','laya-controlled');await mkdir(parent,{recursive:true});
const directory=await mkdtemp(join(parent,'run-'));
const originalContext=JSON.parse(source.context);
const plan={schemaVersion:1,createdAt:new Date().toISOString(),purpose:'Causal diagnostic, not architecture acceptance or a general accuracy benchmark',
  study:config.study??'main',
  harnessSha256:sha(await readFile(fileURLToPath(import.meta.url),'utf8')),
  workerSha256:sha(await readFile(new URL('./laya-controlled-worker.py',import.meta.url),'utf8')),
  inputConstraints:{canonicalSourceField:'requestedFile',originalSourceField:'targetFile'},
  sourceDecisionSha256:sha(source),modelManifestSha256:sha(await readFile(join(config.modelPath,'asset-manifest.json'),'utf8')),
  controls:{modelInstances:1,device:'cuda',torchComputeThreads:1,interOpThreads:1,basePrecision:'SDK stock BF16',
    requests:'sequential',maasCalls:0,businessToolCalls:0,weightUpdates:0,published:false},
  sources:{},cases:[],routes:[]};
for(const relative of ['apps/agentarts-runtime/src/laya-selector.mjs','scripts/laya/batch-server.py'])
  plan.sources[relative]=sha(await readFile(join(sourceRoot,relative),'utf8'));
const originals=[];
async function capture(value) {
  let captured;
  const selector=createOwnedLayaSelector({port:44174,getApiKey:()=> 'synthetic-capture-only',request:async(_url,options)=>{
    captured=options.body;throw Error('PAYLOAD_CAPTURE_ONLY_NO_INFERENCE');}});
  await selector.select({...value,deadline,signal:new AbortController().signal}).catch(()=>{});
  assert.ok(captured);return captured;
}
for(const negative of [false,true])for(const reversed of [false,true]) {
  const value=structuredClone(source),context=JSON.parse(value.context);
  if(negative)context.candidateValues[0].value.arguments.path='outside-requested-scope.svg';
  if(reversed)value.candidates.reverse();value.context=JSON.stringify(context);
  const body=await capture(value),payload=JSON.parse(body),readIndex=value.candidates.findIndex(row=>row.id==='bound-source-read');
  originals.push({id:`original-${negative?'wrong':'match'}-${reversed?'reversed':'normal'}`,negative,reversed,value,body,payload,
    readKey:'candidate_'+readIndex,reviewKey:'candidate_'+(1-readIndex)});
}
for(let repeat=0;repeat<2;repeat++)for(const specimen of originals) {
  const routes=repeat===0?['selector_http','raw_http','direct_sdk']:['direct_sdk','raw_http','selector_http'];
  for(const route of routes)plan.routes.push({id:`transport-${specimen.id}-${repeat}-${route}`,specimenId:specimen.id,repeat,route});
}
function register(id,group,payload,{readKey='A',reviewKey='B',expected='read',parentId=null,factor='baseline',...extra}={}) {
  assert.ok(Object.hasOwn(payload.questions.decision.criteria,readKey));
  assert.ok(Object.hasOwn(payload.questions.decision.criteria,reviewKey));
  const row={id,group,payload,modelInputSha256:sha({state:payload.state,questions:payload.questions}),
    readKey,reviewKey,expected,parentId,factor,...extra};plan.cases.push(row);return row;
}
const seeds=[['pelican.svg','outside-requested-scope.svg'],['wheel.svg','frame.svg'],['scene.svg','diagram.svg'],
  ['assets/pelican.svg','assets/heron.svg'],['鹈鹕.svg','海鸥.svg'],['illustrations/bicycle.svg','illustrations/scooter.svg']];
const instruction='Choose the next action. Read the proposed file only when its path exactly matches requestedFile and is included in allowedPaths. Otherwise request review.';
const baseDescriptions=['Read the proposed file.','Request review without reading a file.'];
const labelPairs=[['A','B'],['candidate_0','candidate_1'],['read','review'],['match','mismatch'],['yes','no']];
const canonical=[];
for(let seed=0;seed<seeds.length;seed++)for(const negative of [false,true])for(const reversed of [false,true]) {
  const state={requestedFile:seeds[seed][0],proposedRead:{toolName:'workspace.read_text',arguments:{path:seeds[seed][negative?1:0]}},allowedPaths:[seeds[seed][0]]};
  let entries=[['A',baseDescriptions[0]],['B',baseDescriptions[1]]];if(reversed)entries.reverse();
  const payload={model:'multilingual',state,deadline,questions:{decision:{type:'choice',instructions:instruction,criteria:Object.fromEntries(entries)}}};
  const base=register(`canonical-${seed}-${negative}-${reversed}`,'canonical',payload,{expected:negative?'review':'read',seed,negative,reversed});
  canonical.push(base);
  for(const labels of labelPairs.slice(1)) {
    const variant=structuredClone(payload),pairs=[[labels[0],baseDescriptions[0]],[labels[1],baseDescriptions[1]]];if(reversed)pairs.reverse();
    variant.questions.decision.criteria=Object.fromEntries(pairs);
    register(`${base.id}-labels-${labels.join('_')}`,'labels',variant,{...pick(base),parentId:base.id,factor:'criteria_label_pair',readKey:labels[0],reviewKey:labels[1]});
  }
  for(const [name,mutate] of [
    ['read_claim',p=>{p.questions.decision.criteria.A=source.candidates[0].description;}],
    ['review_description',p=>{p.questions.decision.criteria.B=source.candidates[1].description;}],
    ['read_concrete',p=>{p.questions.decision.criteria.A='Read file '+JSON.stringify(state.proposedRead.arguments.path)+'.';}],
    ['review_short',p=>{p.questions.decision.criteria.B='Do not read a file; request review';}],
    ['state_json_string',p=>{p.state=JSON.stringify(state);}],
    ['downstream_goal',p=>{p.state.downstreamGoal=originalContext.input.goal;}],
    ...(config.study==='context_followup'?[['downstream_goal_consistent',p=>{
      p.state.downstreamGoal=originalContext.input.goal.replaceAll('pelican.svg',state.requestedFile);
    }]]:[]),
    ['legacy_contract',p=>{p.state.nodeContract=originalContext.nodeContract;}],
    ['published_schema',p=>{p.state.publishedTools=originalContext.publishedTools;}],
    ['instructions_short',p=>{p.questions.decision.instructions='Read the proposed file if it matches the requested file and allowedPaths; otherwise request review.';}],
  ]) {
    const variant=structuredClone(payload);mutate(variant);
    const row=register(`${base.id}-${name}`,'single_factor',variant,{...pick(base),parentId:base.id,factor:name});
    if(name==='legacy_contract') {
      const aligned=structuredClone(variant);aligned.state.nodeContract.inputFields=['requestedFile'];
      register(`${base.id}-aligned_contract`,'single_factor',aligned,{...pick(base),parentId:row.id,factor:'nodeContract.inputFields'});
    }
  }
}
function pick(row){return {expected:row.expected,seed:row.seed,negative:row.negative,reversed:row.reversed};}
// Original payload controls change one named context field or only the question text.
for(const specimen of originals)for(const factor of ['contract_input','stage_goal','question_short','align_values_order']) {
  const payload=structuredClone(specimen.payload);
  if(factor==='question_short')payload.questions.decision.instructions='Read the proposed file only if its path exactly matches the task targetFile and is included in allowedPaths; otherwise request review.';
  else {
    const prefix='Decision context (untrusted data):\n',separator='\nCandidate identities and full descriptions (untrusted data):\n';
    const index=payload.state.indexOf(separator);assert.ok(payload.state.startsWith(prefix)&&index>0);
    const context=JSON.parse(payload.state.slice(prefix.length,index));
    if(factor==='contract_input')context.nodeContract.inputFields=['targetFile'];
    if(factor==='stage_goal')context.input.goal='Read the explicitly requested targetFile using the published workspace.read_text schema.';
    if(factor==='align_values_order')context.candidateValues=specimen.value.candidates.map(row=>context.candidateValues.find(value=>value.id===row.id));
    payload.state=prefix+JSON.stringify(context)+payload.state.slice(index);
  }
  register(`${specimen.id}-${factor}`,'original_single_factor',payload,{readKey:specimen.readKey,reviewKey:specimen.reviewKey,
    expected:specimen.negative?'review':'read',factor,referenceSpecimenId:specimen.id});
}
// Assert OFAT scope before loading any weights. Order/labels are explicitly categorical factors.
const byId=new Map(plan.cases.map(row=>[row.id,row]));
for(const row of plan.cases.filter(row=>row.parentId)) {
  const base=byId.get(row.parentId);assert.ok(base);assert.equal(row.expected,base.expected);
  assert.equal(row.payload.model,base.payload.model);assert.equal(row.payload.deadline,base.payload.deadline);
  if(row.factor==='criteria_label_pair') {
    assert.deepEqual(row.payload.state,base.payload.state);assert.equal(row.payload.questions.decision.instructions,base.payload.questions.decision.instructions);
    assert.deepEqual(Object.values(row.payload.questions.decision.criteria),Object.values(base.payload.questions.decision.criteria));
  } else {
    const stateFactor=['state_json_string','downstream_goal','downstream_goal_consistent','legacy_contract','nodeContract.inputFields','published_schema'].includes(row.factor);
    if(stateFactor)assert.deepEqual(row.payload.questions,base.payload.questions);
    else assert.deepEqual(row.payload.state,base.payload.state);
    if(row.factor!=='instructions_short'&&!stateFactor)assert.equal(row.payload.questions.decision.instructions,base.payload.questions.decision.instructions);
    const paths={read_claim:['questions','decision','criteria','A'],read_concrete:['questions','decision','criteria','A'],
      review_description:['questions','decision','criteria','B'],review_short:['questions','decision','criteria','B'],
      instructions_short:['questions','decision','instructions'],state_json_string:['state'],
      downstream_goal:['state','downstreamGoal'],downstream_goal_consistent:['state','downstreamGoal'],legacy_contract:['state','nodeContract'],
      'nodeContract.inputFields':['state','nodeContract','inputFields'],published_schema:['state','publishedTools']};
    const path=paths[row.factor];assert.ok(path,'A single-factor mutation must declare its precise path');
    const restored=structuredClone(row.payload);let target=restored,original=base.payload;
    for(const key of path.slice(0,-1)){target=target[key];original=original[key];}
    const last=path.at(-1);if(Object.hasOwn(original,last))target[last]=structuredClone(original[last]);else delete target[last];
    assert.deepEqual(restored,base.payload,'Only the declared factor may change');
    if(row.factor==='state_json_string')assert.deepEqual(JSON.parse(row.payload.state),base.payload.state);
    if(row.factor==='nodeContract.inputFields')
      assert.ok(row.payload.state.nodeContract.inputFields.every(field=>Object.hasOwn(row.payload.state,field)));
  }
}
for(const positive of canonical.filter(row=>!row.negative)) {
  const negative=byId.get(`canonical-${positive.seed}-true-${positive.reversed}`),restored=structuredClone(negative.payload);
  restored.state.proposedRead.arguments.path=positive.payload.state.proposedRead.arguments.path;
  assert.deepEqual(restored,positive.payload,'Counterexample changes only the proposed path');
}
for(const normal of canonical.filter(row=>!row.reversed)) {
  const reversed=byId.get(`canonical-${normal.seed}-${normal.negative}-true`);
  assert.deepEqual(reversed.payload.state,normal.payload.state);
  assert.deepEqual(Object.entries(reversed.payload.questions.decision.criteria),Object.entries(normal.payload.questions.decision.criteria).reverse());
}
plan.ofatValidation={childVariants:plan.cases.filter(row=>row.parentId).length,
  counterfactualPathPairs:canonical.filter(row=>!row.negative).length,optionOrderPairs:canonical.filter(row=>!row.reversed).length};
if(config.study==='calibration_holdout') {
  const prior=JSON.parse(await readFile(config.calibrationReport,'utf8'));
  const training=prior.variants.filter(row=>row.group==='canonical'&&row.seed===0);assert.equal(training.length,4);
  const minPositive=Math.min(...training.filter(row=>!row.negative).map(row=>row.readProbability));
  const maxNegative=Math.max(...training.filter(row=>row.negative).map(row=>row.readProbability));
  assert.ok(minPositive>maxNegative,'Do not invent a threshold when the calibration pair is inseparable');
  plan.calibration={sourceReportSha256:sha(await readFile(config.calibrationReport,'utf8')),
    trainingCaseIds:training.map(row=>row.id),minPositive,maxNegative,threshold:(minPositive+maxNegative)/2,
    formula:'Midpoint between smallest positive and largest negative score, seed 0 only; never fit on new holdout labels',
    qualification:'Exploratory calibration hypothesis from the prior experiment; new filenames below are frozen before inference. No production change.'};
  plan.routes=[];plan.cases=[];
  const nonce=randomBytes(4).toString('hex');plan.holdoutNonce=nonce;
  const heldout=[];
  for(let index=0;index<20;index++) {
    let target,other;
    if(index<10){target=`board-${nonce}-${index}a.svg`;other=`board-${nonce}-${index}b.svg`;}
    else if(index<15){target=`assets-${index}/board-${nonce}.svg`;other=`backup-${index}/board-${nonce}.svg`;}
    else {target=`图纸-${nonce}-${index}.svg`;other=`草图-${nonce}-${index}.svg`;}
    heldout.push([target,other]);
  }
  plan.holdoutPairs=heldout;
  for(let seed=0;seed<heldout.length;seed++)for(const negative of [false,true])for(const reversed of [false,true]) {
    const state={requestedFile:heldout[seed][0],proposedRead:{toolName:'workspace.read_text',arguments:{path:heldout[seed][negative?1:0]}},allowedPaths:[heldout[seed][0]]};
    let entries=[['A',baseDescriptions[0]],['B',baseDescriptions[1]]];if(reversed)entries.reverse();
    register(`holdout-${seed}-${negative}-${reversed}`,'calibration_holdout',{
      model:'multilingual',deadline,state,questions:{decision:{type:'choice',instructions:instruction,criteria:Object.fromEntries(entries)}}},
      {expected:negative?'review':'read',seed,negative,reversed});
  }
  for(const row of canonical.filter(row=>row.seed===0))plan.cases.push({...row,id:'calibration-reference-'+row.id,group:'calibration_reference'});
  plan.ofatValidation={holdoutPairs:20,observations:80,seed0References:4,
    onlyModelInputChange:'filenames; question, labels, descriptions and state schema identical to original canonical baseline',
    postprocessingFactor:'argmax versus frozen seed0-only threshold, applied to the very same returned scores'};
}
if(config.study==='context_followup') {
  plan.routes=[];plan.cases=plan.cases.filter(row=>row.group==='canonical'||row.factor==='downstream_goal_consistent');
  plan.ofatValidation.childVariants=plan.cases.filter(row=>row.parentId).length;
  const observations=[
    ['The pelican SVG loads and is visible, but its wheel and pedal animations never start.','read'],
    ['The pelican SVG file could not be found, so no source text could be loaded.','review'],
    ['The pelican and bicycle render normally; only the existing animation stays motionless.','read'],
    ['Reading the pelican SVG returned file-not-found; rendering never started.','review']];
  for(let observation=0;observation<observations.length;observation++)for(const reversed of [false,true]) {
    let entries=[['A','The SVG loaded, but the animation does not run.'],['B','The SVG source file could not be loaded.']];
    if(reversed)entries.reverse();
    register(`semantic-control-${observation}-${reversed}`,'semantic_control',{
      model:'multilingual',deadline,state:{observation:observations[observation][0]},questions:{decision:{type:'choice',
        instructions:'Which observed problem is described?',criteria:Object.fromEntries(entries)}}},
      {expected:observations[observation][1],factor:'separate_semantic_positive_control',reversed,observation});
  }
}
plan.plannedForwards=plan.routes.length+plan.cases.length+(['context_followup','calibration_holdout'].includes(config.study)?0:canonical.length*2+originals.length);
await writeFile(join(directory,'plan.json'),JSON.stringify({...plan,originals},null,2)+'\n');
console.log(JSON.stringify({event:'plan_frozen',directory,variants:plan.cases.length,transportCalls:plan.routes.length,planSha256:sha(await readFile(join(directory,'plan.json'),'utf8'))}));
if(process.argv.includes('--plan-only'))process.exit(0);

const key=randomBytes(32).toString('hex'),reservation=createServer();await new Promise(r=>reservation.listen(0,'127.0.0.1',r));
const port=reservation.address().port;await new Promise(r=>reservation.close(r));
const scratch=join(directory,'scratch');await mkdir(scratch);
const child=spawn(config.python,[fileURLToPath(new URL('./laya-controlled-worker.py',import.meta.url))],{
  windowsHide:true,stdio:['pipe','pipe','pipe'],env:{...process.env,PYTHONDONTWRITEBYTECODE:'1',PYTHONUNBUFFERED:'1',
    PYTHONPATH:config.pythonModulePath,PYTHONIOENCODING:'utf-8',OMP_NUM_THREADS:'1',MKL_NUM_THREADS:'1',TOKENIZERS_PARALLELISM:'false',
    HF_HUB_OFFLINE:'1',TRANSFORMERS_OFFLINE:'1',TEMP:scratch,TMP:scratch,CUDA_CACHE_PATH:scratch}});
const audits=[],pending=new Map();let readyResolve,readyReject,sequence=0,stderr='';
const ready=new Promise((r,j)=>{readyResolve=r;readyReject=j;});
const ended=once(child,'exit');
child.stderr.on('data',bytes=>{stderr+=bytes.toString();});
child.on('error',error=>readyReject(error));
child.on('exit',()=>{const error=Error('Controlled worker exited');readyReject(error);for(const item of pending.values())item.reject(error);});
createInterface({input:child.stdout}).on('line',line=>{
  if(!line.startsWith('@@LAYA_CONTROL@@'))return;
  const event=JSON.parse(line.slice('@@LAYA_CONTROL@@'.length));
  if(event.kind==='ready')readyResolve(event);
  else if(event.kind==='fatal'){readyReject(Error(event.error));for(const item of pending.values())item.reject(Error(event.error));}
  else if(event.kind==='forward')audits.push(event);
  else if(event.kind==='reply'){const item=pending.get(event.id);if(item){pending.delete(event.id);event.error?item.reject(Error(event.error)):item.resolve(event);}}
});
child.stdin.write(JSON.stringify({implementationRoot:sourceRoot,modelPath:config.modelPath,key,port})+'\n');
const command=value=>new Promise((resolve,reject)=>{const id=++sequence;pending.set(id,{resolve,reject});child.stdin.write(JSON.stringify({id,...value})+'\n');});
const report={schemaVersion:1,planSha256:sha(await readFile(join(directory,'plan.json'),'utf8')),startedAt:new Date().toISOString(),
  status:'running',transport:[],variants:[],precision:[],sourceChecks:[],timingScope:'Observed SDK; duplicate encoding for audit. Not a speed benchmark.'};
async function raw(body){const response=await fetch(`http://127.0.0.1:${port}/v1/systemone`,{method:'POST',
  headers:{'content-type':'application/json',authorization:'Bearer '+key},body,signal:AbortSignal.timeout(Math.max(1,Date.parse(deadline)-Date.now()))});
  assert.equal(response.status,200,await response.clone().text());return response.json();}
async function audited(invoke) {const count=audits.length,value=await invoke();
  // The forward event is emitted before the response; drain the stdout pipe if HTTP wins that delivery race.
  while(audits.length===count)await new Promise(r=>setTimeout(r,1));
  assert.equal(audits.length,count+1,'Exactly one real SDK forward per observation');return {value,audit:audits[count]};}
function answerRow(id,payload,answer,audit,extra={}) {
  assert.ok(Object.hasOwn(payload.questions.decision.criteria,answer.choice));
  return {id,answer,auditIndex:audit.index,encodedSha256:audit.encodedSha256,sdkArgumentsSha256:audit.sdkArgumentsSha256,
    encodedLengths:audit.encodedLengths,precision:{autocastEnabled:audit.autocastEnabled,dtype:audit.dtype},...extra};
}
try {
  report.runtime=await ready;console.log(JSON.stringify({event:'worker_ready',...report.runtime}));
  for(const row of plan.routes) {
    const specimen=originals.find(item=>item.id===row.specimenId);
    let result,selected;
    const observed=await audited(async()=>{
      if(row.route==='direct_sdk')return (await command({op:'direct',payload:specimen.payload})).result;
      if(row.route==='raw_http')return raw(specimen.body);
      const selector=createOwnedLayaSelector({port,getApiKey:()=>key,request:async(url,options)=>{
        assert.equal(options.body,specimen.body,'The production selector must send the frozen exact bytes');
        const response=await fetch(url,options);result=await response.clone().json();return response;}});
      selected=await selector.select({...specimen.value,deadline,signal:new AbortController().signal});return result;
    });
    const answer=observed.value.answers.decision,action=answer.choice===specimen.readKey?'read':'review';
    if(row.route==='selector_http')assert.equal(selected,action==='read'?'bound-source-read':'owned-review');
    report.transport.push(answerRow(row.id,specimen.payload,answer,observed.audit,{...row,action,
      correct:action===(specimen.negative?'review':'read'),payloadSha256:sha(specimen.body)}));
  }
  console.log(JSON.stringify({event:'transport_complete',calls:report.transport.length}));
  for(const specimen of plan.cases) {
    const observed=await audited(async()=> (await command({op:'direct',payload:specimen.payload})).result);
    const answer=observed.value.answers.decision,action=answer.choice===specimen.readKey?'read':'review';
    report.variants.push(answerRow(specimen.id,specimen.payload,answer,observed.audit,{group:specimen.group,factor:specimen.factor,
      parentId:specimen.parentId,expected:specimen.expected,action,correct:action===specimen.expected,
      readProbability:answer.probabilities[specimen.readKey],seed:specimen.seed,negative:specimen.negative,reversed:specimen.reversed}));
    if(report.variants.length%48===0)console.log(JSON.stringify({event:'variants_progress',completed:report.variants.length,total:plan.cases.length}));
  }
  // Precision-only pairs, same model instance, payload and explicit token windows.
  for(const precision of ['context_followup','calibration_holdout'].includes(config.study)?[]:['float32','stock']) {
    await command({op:'precision',value:precision});
    for(const specimen of canonical) {
      const observed=await audited(async()=> (await command({op:'direct',payload:specimen.payload})).result);
      const answer=observed.value.answers.decision;
      report.precision.push(answerRow(`${specimen.id}-${precision}`,specimen.payload,answer,observed.audit,{referenceId:specimen.id,
        requestedPrecision:precision,correct:(answer.choice===specimen.readKey?'read':'review')===specimen.expected}));
    }
  }
  // SDK default-window check is separate from the identical-encoding transport comparison.
  report.defaultWindow=[];
  for(const specimen of ['context_followup','calibration_holdout'].includes(config.study)?[]:originals) {
    const observed=await audited(async()=> (await command({op:'direct',payload:specimen.payload,window:'defaults'})).result);
    report.defaultWindow.push(answerRow(specimen.id,specimen.payload,observed.value.answers.decision,observed.audit));
  }
  for(const [relative,before] of Object.entries(plan.sources)) {
    const after=sha(await readFile(join(sourceRoot,relative),'utf8'));assert.equal(after,before);
    report.sourceChecks.push({relative,sha256:after,unchanged:true});
  }
  report.status='measured';
} catch(error) {report.status='failed_or_partial';report.failure={name:error.name,message:error.message};process.exitCode=1;}
finally {
  if(child.exitCode===null){await command({op:'stop'}).catch(()=>{});child.stdin.end();await ended;}
  report.finishedAt=new Date().toISOString();report.forwardCount=audits.length;
  await writeFile(join(directory,'report.json'),JSON.stringify(report,null,2)+'\n');
  await writeFile(join(directory,'forward-audit.json'),JSON.stringify(audits,null,2)+'\n');
  await writeFile(join(directory,'worker-stderr.log'),stderr);
  console.log(JSON.stringify({event:'finished',directory,status:report.status,forwardCount:audits.length,failure:report.failure}));
}

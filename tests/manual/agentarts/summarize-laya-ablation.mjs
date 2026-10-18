import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir,copyFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {createHash} from 'node:crypto';

const directory=resolve(process.argv[2]);
const read=async name=>JSON.parse(await readFile(join(directory,name),'utf8'));
const plan=await read('plan.json'),report=await read('report.json'),audits=await read('forward-audit.json');
assert.equal(report.status,'measured');
assert.equal(report.planSha256,createHash('sha256').update(await readFile(join(directory,'plan.json'))).digest('hex'));
assert.equal(report.forwardCount,audits.length);assert.equal(audits.length,plan.plannedForwards??452);
const score=rows=>({correct:rows.filter(row=>row.correct).length,total:rows.length,
  positives:{correct:rows.filter(row=>row.expected==='read'&&row.correct).length,total:rows.filter(row=>row.expected==='read').length},
  negatives:{correct:rows.filter(row=>row.expected==='review'&&row.correct).length,total:rows.filter(row=>row.expected==='review').length}});
const byId=new Map(report.variants.map(row=>[row.id,row]));
const planById=new Map(plan.cases.map(row=>[row.id,row]));
const summary={schemaVersion:1,scope:'Synthetic file-read choice only, six filename pairs; no architecture or broad capability acceptance',
  study:plan.study??'main',
  architectureStatus:'undecided',deployed:false,trainingPerformed:false,realForwards:audits.length,runtime:report.runtime,
  countScope:'Real observed SDK predict_batch calls, not independent user tasks or GPU kernel count',
  ofatValidation:plan.ofatValidation,transport:{groups:[],routes:{}},labels:{},factors:{},originalFactors:{},order:{},precision:{},defaultWindow:[]};
const maxDiff=(a,b)=>Math.max(...Object.keys(a.probabilities).map(key=>Math.abs(a.probabilities[key]-b.probabilities[key])));
for(const specimen of report.transport.length?plan.originals:[])for(const repeat of [0,1]) {
  const rows=report.transport.filter(row=>row.specimenId===specimen.id&&row.repeat===repeat);assert.equal(rows.length,3);
  const reference=rows[0];
  summary.transport.groups.push({specimenId:specimen.id,repeat,
    samePayloadBytes:rows.every(row=>row.payloadSha256===reference.payloadSha256),
    sameSdkArguments:rows.every(row=>row.sdkArgumentsSha256===reference.sdkArgumentsSha256),
    sameEncodedTokensAndMarkers:rows.every(row=>row.encodedSha256===reference.encodedSha256),
    sameChoice:rows.every(row=>row.action===reference.action),maximumProbabilityDifference:Math.max(...rows.map(row=>maxDiff(reference.answer,row.answer)))});
}
for(const route of ['selector_http','raw_http','direct_sdk']) {
  const rows=report.transport.filter(row=>row.route===route);
  summary.transport.routes[route]={correct:rows.filter(row=>row.correct).length,total:rows.length};
}
for(const row of report.variants.filter(row=>['canonical','labels'].includes(row.group))) {
  const specimen=planById.get(row.id),key=specimen.readKey+'/'+specimen.reviewKey;
  (summary.labels[key]??=[]).push(row);
}
for(const [key,rows] of Object.entries(summary.labels))summary.labels[key]={...score(rows),
  seenSeed:score(rows.filter(row=>row.seed===0)),heldOutFilenamePairs:score(rows.filter(row=>row.seed!==0))};
for(const factor of new Set(report.variants.filter(row=>row.group==='single_factor').map(row=>row.factor))) {
  const rows=report.variants.filter(row=>row.group==='single_factor'&&row.factor===factor);
  summary.factors[factor]={...score(rows),parentCorrect:rows.filter(row=>byId.get(row.parentId).correct).length,
    fixedErrors:rows.filter(row=>!byId.get(row.parentId).correct&&row.correct).length,
    brokeCorrect:rows.filter(row=>byId.get(row.parentId).correct&&!row.correct).length,
    changedAction:rows.filter(row=>byId.get(row.parentId).action!==row.action).length};
}
for(const factor of new Set(report.variants.filter(row=>row.group==='original_single_factor').map(row=>row.factor))) {
  const rows=report.variants.filter(row=>row.group==='original_single_factor'&&row.factor===factor);
  summary.originalFactors[factor]={...score(rows),cases:rows.map(row=>({id:row.id,expected:row.expected,action:row.action,readProbability:row.readProbability}))};
}
for(const labels of [['A','B'],['candidate_0','candidate_1'],['read','review'],['match','mismatch'],['yes','no']]) {
  const pairs=[];
  for(let seed=0;seed<6;seed++)for(const negative of [false,true]) {
    const suffix=labels[0]==='A'?'':`-labels-${labels.join('_')}`;
    const normal=byId.get(`canonical-${seed}-${negative}-false${suffix}`),reversed=byId.get(`canonical-${seed}-${negative}-true${suffix}`);
    if(!normal||!reversed)continue;
    pairs.push({seed,negative,normal:normal.action,reversed:reversed.action,changed:normal.action!==reversed.action});
  }
  if(pairs.length)summary.order[labels.join('/') ]={changed:pairs.filter(row=>row.changed).length,total:pairs.length,pairs};
}
for(const mode of ['float32','stock']) {
  const rows=report.precision.filter(row=>row.requestedPrecision===mode);
  if(!rows.length)continue;
  summary.precision[mode]={correct:rows.filter(row=>row.correct).length,total:rows.length,
    changedFromBaseline:rows.filter(row=>row.answer.choice!==byId.get(row.referenceId).answer.choice).length,
    maxProbabilityDifference:Math.max(...rows.map(row=>maxDiff(byId.get(row.referenceId).answer,row.answer)))};
}
const semantics=report.variants.filter(row=>row.group==='semantic_control');
if(semantics.length)summary.semanticControl={...score(semantics),
  mapping:{read:'animation_not_running',review:'source_not_loaded'},
  qualification:'Separate functional positive control, not an OFAT causal comparison to filename equality'};
function ranking(rows) {
  const positives=rows.filter(row=>row.expected==='read'),negatives=rows.filter(row=>row.expected==='review');
  if(!positives.length||!negatives.length)return null;
  let wins=0;for(const p of positives)for(const n of negatives)wins+=p.readProbability>n.readProbability?1:p.readProbability===n.readProbability?.5:0;
  const pairs=[];
  for(const positive of positives) {
    const negative=negatives.find(row=>row.seed===positive.seed&&row.reversed===positive.reversed);
    if(negative)pairs.push({seed:positive.seed,reversed:positive.reversed,positive:positive.readProbability,negative:negative.readProbability,
      delta:positive.readProbability-negative.readProbability});
  }
  return {auc:wins/(positives.length*negatives.length),pairedCorrectDirection:pairs.filter(row=>row.delta>0).length,pairCount:pairs.length,
    positiveRange:[Math.min(...positives.map(row=>row.readProbability)),Math.max(...positives.map(row=>row.readProbability))],
    negativeRange:[Math.min(...negatives.map(row=>row.readProbability)),Math.max(...negatives.map(row=>row.readProbability))],pairs};
}
summary.canonicalScoreRanking=ranking(report.variants.filter(row=>row.group==='canonical'));
if(plan.calibration) {
  const heldout=report.variants.filter(row=>row.group==='calibration_holdout');
  const calibrated=heldout.map(row=>({...row,correct:(row.readProbability>=plan.calibration.threshold?'read':'review')===row.expected}));
  summary.calibration={...plan.calibration,newFilenamePairs:plan.holdoutPairs.length,argmax:score(heldout),
    fixedBoundary:score(calibrated),ranking:ranking(heldout),referenceScores:report.variants.filter(row=>row.group==='calibration_reference')};
}
if(summary.factors.downstream_goal)summary.factors.downstream_goal.qualification=
  'Frozen original goal names pelican.svg. Held-out seeds introduce conflicting filenames; this is a stale-context stress test, not clean irrelevant-context accuracy.';
for(const row of report.defaultWindow) {
  const base=report.transport.find(item=>item.specimenId===row.id&&item.route==='direct_sdk');
  summary.defaultWindow.push({id:row.id,matchedWindowChoice:base.answer.choice,defaultWindowChoice:row.answer.choice,
    matchedEncodingLengths:base.encodedLengths,defaultEncodingLengths:row.encodedLengths,
    encodingChanged:row.encodedSha256!==base.encodedSha256,choiceChanged:row.answer.choice!==base.answer.choice});
}
const destination=process.argv[3]?resolve(process.argv[3]):directory;await mkdir(destination,{recursive:true});
await writeFile(join(destination,'summary.json'),JSON.stringify(summary,null,2)+'\n');
if(destination!==directory)for(const name of ['plan.json','report.json','forward-audit.json'])
  await copyFile(join(directory,name),join(destination,name));
console.log(JSON.stringify({destination,...summary},null,2));

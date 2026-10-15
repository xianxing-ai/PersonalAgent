import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {createTimingRecorder,timedProvider,assertCurrentDelivery,browserObservation,injectPausedAnimations} from './wukong-test-version.mjs';

const checker=fileURLToPath(new URL('./check-wukong.py',import.meta.url));
// Explicit minimal protocol fixture. This is not the real model-generated artwork or visual acceptance.
const drawing=`<!doctype html><html><body><svg xmlns="http://www.w3.org/2000/svg"><title>孙悟空骑白龙马 fixture</title>
<g id="rider-motion"><animateTransform id="rider-bob" attributeName="transform" type="translate" values="0 0;0 4;0 0" begin="0s" dur="1s" repeatCount="indefinite"/><g id="wukong"><circle r="5"/></g></g>
<g id="horse-motion"><animateTransform id="horse-gallop" attributeName="transform" type="translate" values="0 0;4 0;0 0" begin="0s" dur="1s" repeatCount="indefinite"/><g id="white-dragon-horse"><ellipse rx="10" ry="5"/></g></g>
</svg></body></html>`;
function check(value) {const result=spawnSync(process.env.PA_TEST_PYTHON??'python',[checker,'-'],{input:value,encoding:'utf8',shell:false,windowsHide:true});assert.ifError(result.error);const report=JSON.parse(result.stdout);assert.equal(result.status,report.passed?0:1);return report;}

test('explicit fixture: checker rejects inactive animation and external active content without treating labels as visual proof',()=>{
  assert.equal(check(drawing).passed,true);
  assert.equal(check(drawing.replaceAll('begin="0s"','begin="indefinite"')).passed,false);
  for(const extra of ['<script>alert(1)</script>','<img src="https://example.invalid/a">','<style>@import "remote";</style>','<svg onload="x()"></svg>'])assert.equal(check(drawing+extra).passed,false);
  assert.match(check(drawing).scope,/visual review/);
});

test('phase and model failure endpoints are synchronously durable before the caller receives failure',async()=>{
  const {appendFileSync,readFileSync,mkdtempSync,rmSync}=await import('node:fs');
  const {tmpdir}=await import('node:os');const {join}=await import('node:path');
  const directory=mkdtempSync(join(tmpdir(),'pa-stage-evidence-')),path=join(directory,'stages.jsonl'),records=[];
  try {
    const timed=createTimingRecorder(records,undefined,undefined,row=>appendFileSync(path,JSON.stringify(row)+'\n'));
    const provider=timedProvider({complete:async()=>{throw Error('explicit offline model failure');}},'fixture',records,timed);
    await assert.rejects(timed('phase','main',()=>provider.complete({})),/explicit offline/);
    await timed('phase','shadow',async()=>({status:'failed'}));
    const rows=readFileSync(path,'utf8').trim().split('\n').map(JSON.parse);
    assert.deepEqual(rows.filter(row=>row.event==='stage_finished').map(row=>[row.kind,row.label,row.outcome]),[['model','fixture','failed'],['phase','main','failed'],['phase','shadow','failed']]);
    assert.equal(rows.filter(row=>row.event==='stage_started').length,3);
    assert.ok(rows.every(row=>Number.isFinite(Date.parse(row.startedAt))));
  }finally{rmSync(directory,{recursive:true,force:true});}
});

test('self-contained gradient URLs accept only validated existing page IDs, including normal quotes and whitespace',()=>{
  const withGradient=reference=>drawing.replace('</svg>',`<defs><linearGradient id="fixture-gradient"><stop offset="0" stop-color="gold"/><stop offset="1" stop-color="white"/></linearGradient></defs><style>circle { fill: ${reference}; }</style></svg>`);
  for(const reference of ['url(#fixture-gradient)',"url( '#fixture-gradient' )",'url( "#fixture-gradient" )','URL (  #fixture-gradient  )'])
    assert.equal(check(withGradient(reference)).passed,true,reference);
  assert.match(check(withGradient('url(#missing-gradient)')).failure,/fragment_target_missing:missing-gradient/);
  for(const reference of ['url(https://example.invalid/gradient.svg#fixture-gradient)',"url('data:image/svg+xml,fixture')",'url(#fixture-gradient\\escape)'])
    assert.equal(check(withGradient(reference)).passed,false,reference);
  for(const extra of ['<style>@import "https://example.invalid/style.css";</style>','<!ENTITY fixture "external">','<use href="#fixture-gradient"/>'])
    assert.equal(check(withGradient('url(#fixture-gradient)')+extra).passed,false);
});

test('timing recorder captures UTC endpoints, wall time and failed model calls without fabricating usage',async()=>{
  const records=[];let clock=0;const timed=createTimingRecorder(records,()=>new Date(0).toISOString(),()=>clock+=5);
  assert.equal(await timed('phase','fixture',async()=>7),7);
  await assert.rejects(timed('tool','failure',async()=>{throw Error('fixture');}),/fixture/);
  assert.deepEqual(records.map(r=>[r.outcome,r.wallMs]),[['completed',5],['failed',5]]);
  assert.equal(records[0].startedAt,'1970-01-01T00:00:00.000Z');
  const provider=timedProvider({deployment:{model:'fixture'},complete:async()=>{throw Error('model fixture');}},'teacher',records);
  await assert.rejects(provider.complete({}),/model fixture/);assert.equal(records.at(-1).outcome,'failed');assert.equal('usage' in records.at(-1),false);
});

test('explicit fixture requires artwork beneath the corresponding animated ancestor and stable required ids',()=>{
  const disconnected=drawing.replace('<g id="wukong"><circle r="5"/></g></g>','</g><g id="wukong"><circle r="5"/></g>');
  assert.match(check(disconnected).failure,/artwork_motion_ancestor_missing:wukong/);
  assert.equal(check(drawing.replace('id="wukong"','id="renamed"')).passed,false);
  assert.equal(check(drawing.replace('<g id="wukong"><circle r="5"/></g>','')).passed,false);
});

test('structural fault injection handles equivalent begin syntax and changes only the two animation attributes',()=>{
  for(const begin of ['begin="0s"',"begin='0s'",'begin="0"',"begin='0ms'",'begin=0','']) {
    const original=drawing.replaceAll('begin="0s"',begin).replace('<title>',`<title data-note="begin='0s'">`);
    assert.equal(check(original).passed,true);
    const injected=injectPausedAnimations({python:process.env.PA_TEST_PYTHON??'python',deadline:new Date(Date.now()+30000).toISOString()},original);
    assert.equal(injected.kind,'pause_smil');assert.deepEqual(injected.animationIds,['rider-bob','horse-gallop']);
    assert.match(check(injected.source).failure,/^animation_not_started:/);
    assert.equal((injected.source.match(/begin="indefinite"/g)??[]).length,2);
    assert.ok(injected.source.includes(`data-note="begin='0s'"`));
    const normalized=value=>value.replace(/\s+(?=\/?>)/g,'').replace(/\s+/g,' ');
    assert.equal(normalized(injected.source.replaceAll('begin="indefinite"',begin||'')),normalized(original));
  }
});

test('browser observation measures artwork matrices, so moving empty groups cannot qualify static artwork',async()=>{
  let phase=0;const oldDocument=globalThis.document;
  const artwork=id=>({getBBox:()=>({width:10,height:10}),querySelectorAll:()=>[{}],getCTM:()=>({a:1,b:0,c:0,d:1,e:id==='wukong'?0:20,f:0})});
  const page={on(){},off(){},async goto(){},async waitForTimeout(){phase++;},async screenshot(){},async evaluate(fn){
    globalThis.document={querySelector:()=>({getCurrentTime:()=>phase}),documentElement:{getBoundingClientRect:()=>({width:900})},
      getElementById:id=>['wukong','white-dragon-horse'].includes(id)?artwork(id):{getCTM:()=>({a:1,b:0,c:0,d:1,e:phase,f:0})}};
    try{return fn();}finally{if(oldDocument===undefined)delete globalThis.document;else globalThis.document=oldDocument;}
  }};
  const result=await browserObservation(page,fileURLToPath(import.meta.url),'fixture-not-written.png');
  assert.equal(result.nonBlank,true);assert.deepEqual(result.moving.map(item=>[item.id,item.changed]),[['wukong',false],['white-dragon-horse',false]]);
});

test('delivery requires exact bytes matching the latest verified SHA',()=>{
  const hash=createHash('sha256').update(drawing).digest('hex');assertCurrentDelivery(drawing,hash);
  assert.throws(()=>assertCurrentDelivery(drawing+'user change',hash),/current verified SHA/);
});

test('explicit browser fixture cannot pass with invisible art even when transform matrices move',async()=>{
  let index=0;const sample=()=>({time:index,width:900,artwork:[{id:'wukong',width:0,height:0,shapes:0}],elements:[{id:'rider-motion',matrix:[1,0,0,1,index++,0]}]});
  const page={on(){},off(){},async goto(){},async evaluate(){return sample();},async waitForTimeout(){},async screenshot(){}};
  const report=await browserObservation(page,fileURLToPath(import.meta.url),'fixture-not-written.png');
  assert.equal(report.nonBlank,false);assert.equal(report.moving[0].changed,true);
});

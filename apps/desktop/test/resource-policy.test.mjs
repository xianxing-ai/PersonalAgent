import test from 'node:test';
import assert from 'node:assert/strict';
import {createResourcePolicy} from '../electron/resource-policy.js';
import {Orb} from '../src/features/orb/orb.js';
import {mountRenderBudget} from '../src/shared/render-budget.js';

test('memory pressure lowers optional work immediately and recovers in stable steps',()=>{
  let now=0;const policy=createResourcePolicy({now:()=>now});
  policy.sample({freeBytes:5,totalBytes:100,cores:8});assert.equal(policy.snapshot().mode,'critical');
  for(const ratio of [7,11,9,15]){now+=10000;policy.sample({freeBytes:ratio,totalBytes:100,cores:8});assert.equal(policy.snapshot().mode,'critical');}
  now=60000;policy.sample({freeBytes:30,totalBytes:100,cores:8});
  now=90000;policy.sample({freeBytes:30,totalBytes:100,cores:8});assert.equal(policy.snapshot().mode,'constrained');
  now=100000;policy.sample({freeBytes:30,totalBytes:100,cores:8});
  now=130000;policy.sample({freeBytes:30,totalBytes:100,cores:8});assert.equal(policy.snapshot().mode,'normal');
});

test('battery, throttling and small CPU budget constrain rendering without setting a product memory limit',()=>{
  for(const input of [{onBattery:true},{speedLimit:70},{thermalState:'serious'},{cores:2}]){
    const policy=createResourcePolicy();policy.sample({freeBytes:50,totalBytes:100,cores:8,...input});
    assert.equal(policy.snapshot().fps,20);assert.equal(policy.snapshot().maxDpr,1.5);
  }
  const policy=createResourcePolicy();policy.sample({freeBytes:0,totalBytes:100});policy.sample({freeBytes:NaN,totalBytes:100});
  assert.equal(policy.snapshot().mode,'critical','unavailable memory observations cannot claim recovery');
});

test('Canvas budget changes bound backing pixels and cadence without restarting animation or changing reduced motion',()=>{
  const orb=Object.assign(Object.create(Orb.prototype),{_maxDpr:2,calm:true,running:false,resizes:0,paints:0,
    _resize(){this.resizes++;},_draw(){this.paints++;},start(){throw Error('must not restart');}});
  orb.setResourceBudget({fps:12,maxDpr:1});assert.equal(orb._frameInterval,1000/12);assert.equal(orb.resizes,1);
  orb.setResourceBudget({fps:12,maxDpr:1});assert.equal(orb.resizes,1);assert.equal(orb.calm,true);
  orb.setResourceBudget({fps:1000,maxDpr:8});assert.equal(orb._frameInterval,1000/30);assert.equal(orb._maxDpr,2);
});

test('focus and visibility adapt optional rendering without changing the saved reduced-motion choice',()=>{
  const listeners=new Map(),applied=[];let focused=true;
  const win={addEventListener:(name,callback)=>listeners.set(name,callback),removeEventListener:name=>listeners.delete(name)};
  const doc={...win,hidden:false,hasFocus:()=>focused,documentElement:{dataset:{calm:'true'}}};
  const controller=mountRenderBudget(budget=>applied.push(budget),{window:win,document:doc});
  controller.update({mode:'normal',fps:30,maxDpr:2});assert.equal(applied.at(-1).fps,30);
  focused=false;listeners.get('blur')();assert.equal(applied.at(-1).fps,12);assert.equal(doc.documentElement.dataset.renderActivity,'background');
  doc.hidden=true;listeners.get('visibilitychange')();assert.equal(doc.documentElement.dataset.renderActivity,'hidden');
  assert.equal(doc.documentElement.dataset.calm,'true');controller.dispose();assert.equal(listeners.size,0);
});

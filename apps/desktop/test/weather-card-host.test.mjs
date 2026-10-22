import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createWeatherCardHost} from '../electron/weather-card-host.js';
function fixture(t){
 const userData=mkdtempSync(path.join(os.tmpdir(),'weather-card-'));let record={task:{taskId:'weather',revision:1,state:'running'}};const requests=[];
 const application={prepareHostToolTask:input=>{requests.push(input);return {taskId:'weather',revision:1,state:'created'};},finalizeHostToolTask:input=>{requests.push(input);return record;},readHostToolTask:()=>record};
 const options={userData,getApplication:()=>application,readToolVersion:()=> '1.0.0'};
 const host=createWeatherCardHost(options);t.after(()=>{host.dispose();rmSync(userData,{recursive:true,force:true});});
 return {host,requests,options,set(value){record=value;}};
}
test('weather uses the original host-tool task once and persists only the city',t=>{
 const f=fixture(t);f.host.configure({location:'青岛'});f.host.refresh();assert.equal(f.requests.length,2);assert.equal(f.requests[0].toolName,'weather.forecast');assert.deepEqual(f.requests[1].arguments,{location:'青岛',units:'metric'});
 const restored=createWeatherCardHost(f.options);assert.equal(restored.snapshot().location,'青岛');assert.equal(restored.snapshot().temp,undefined);restored.dispose();
});
test('a succeeded task without confirmed Runtime evidence cannot become weather data',t=>{
 const f=fixture(t);f.host.configure({location:'青岛'});f.set({task:{state:'succeeded'},result:{forecast:{current:{temperature:99}}}});
 assert.equal(f.host.snapshot().temp,undefined);assert.match(f.host.snapshot().reason,/可核实/);
});
test('confirmed forecasts preserve zero degrees and mark stale readbacks honestly',t=>{
 const f=fixture(t);f.host.configure({location:'青岛'});f.set({task:{state:'succeeded'},confirmed:{runId:'run',evidenceRefs:['run'],result:{record:{source:'test-provider'},forecast:{location:'青岛',units:'metric',date:'2026-10-22',summary:'晴',temperatureMin:0,temperatureMax:8,current:{temperature:0}},cache:{state:'stale',fetchedAt:new Date().toISOString()}}}});
 const data=f.host.snapshot();assert.equal(data.temp,0);assert.equal(data.stale,true);assert.deepEqual(data.evidenceRefs,['run']);
});
test('unknown fields and invalid cities cannot create tasks or change the destination',t=>{
 const f=fixture(t);for(const input of [{location:''},{location:'青岛',provider:'other'},{location:'青岛\n'}])assert.throws(()=>f.host.configure(input));assert.equal(f.requests.length,0);
});

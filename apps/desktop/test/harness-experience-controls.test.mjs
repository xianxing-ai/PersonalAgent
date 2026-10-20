import assert from 'node:assert/strict';
import test from 'node:test';
import {harnessExperienceControlsHtml} from '../src/features/admin/harness-experience-controls.js';
import {createHarnessExperienceAdminHost} from '../electron/harness-experience-host.js';

const version={workflowId:'development',revision:1,summary:'<img src=x onerror=alert(1)>',validation:'candidate'};
test('management metadata is escaped and an unvalidated candidate cannot be enabled by the control',()=>{
  const html=harnessExperienceControlsHtml({status:{available:true,entries:[{...version,activeRevision:null}]},selected:JSON.stringify(['development',1])});
  assert.ok(!html.includes('<img'));
  assert.match(html,/&lt;img/);
  assert.match(html,/data-he-action="activate" disabled/);
  assert.match(html,/data-he-action="stop" disabled/);
});
test('admin host routes validate/activate/stop to the actual supplied application and rereads state',async()=>{
  const calls=[];let state={...version},active=null;
  const application={listCandidates:()=>[state],readActive:()=>active,
    validate:async(id,revision)=>{calls.push(['validate',id,revision]);state={...state,validation:'passed',evidenceRef:'synthetic'};},
    activate:async request=>{calls.push(['activate',request]);active=state;},
    stop:request=>{calls.push(['stop',request]);active=null;}};
  const host=createHarnessExperienceAdminHost({getApplication:()=>application,context:()=>({deadline:'2099-01-01T00:00:00.000Z',signal:new AbortController().signal})});
  assert.equal((await host.invoke('harness.experience.validate',{workflowId:'development',revision:1})).entries[0].validation,'passed');
  assert.equal((await host.invoke('harness.experience.activate',{workflowId:'development',revision:1,expectedActiveRevision:null})).entries[0].activeRevision,1);
  assert.equal((await host.invoke('harness.experience.stop',{workflowId:'development',expectedActiveRevision:1})).entries[0].activeRevision,null);
  assert.deepEqual(calls.map(call=>call[0]),['validate','activate','stop']);
  await assert.rejects(host.invoke('harness.experience.activate',{workflowId:'development',revision:1,expectedActiveRevision:null,scope:['workspace:write']}));
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {workspaceLiveEntry} from '../electron/workspace-live-entry.js';

function setup(configured=false){
  const workspace={},calls=[];
  return {calls,input:{workspace,sender:workspace,competitionMode:true,configuration:{snapshot:()=>({configured})},
    openSettings:page=>calls.push(['settings',page]),toggle:()=>{calls.push(['toggle']);return {active:true};}}};
}
test('unconfirmed audio consent opens original voice settings without capture',()=>{
  const {calls,input}=setup();assert.deepEqual(workspaceLiveEntry(input),{opened:'voice-settings',active:false});assert.deepEqual(calls,[['settings','voice']]);
});
test('configured workspace entry reuses the single original Live lifecycle',()=>{
  const {calls,input}=setup(true);assert.deepEqual(workspaceLiveEntry(input),{active:true});assert.deepEqual(calls,[['toggle']]);
});
test('foreign surfaces, extra payload and non-competition mode cannot start Live',()=>{
  const {calls,input}=setup(true);
  for(const patch of [{sender:{}},{workspace:null},{payload:{}},{competitionMode:false}])assert.throws(()=>workspaceLiveEntry({...input,...patch}));
  assert.deepEqual(calls,[]);
});

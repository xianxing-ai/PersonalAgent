import test from 'node:test';
import assert from 'node:assert/strict';
import {needsMicrophoneApproval,operationSummary,taskOperationBinding} from '../electron/authorization-operation-policy.js';
const source=(name,scopes,args={})=>({toolName:name,toolVersion:'1',scopes,arguments:args,argumentsDigest:JSON.stringify(args)});
test('sandbox-scoped reads and ordinary local edits reuse while external mutations retain exact arguments',()=>{
  for(const [name,scopes]of [['calendar.events',['calendar:read']],['todo.create',['todo:write']],['workspace.apply_text_patch',['workspace:write']]]){
    assert.equal(taskOperationBinding(source(name,scopes,{id:'a'})),taskOperationBinding(source(name,scopes,{id:'b'})));
  }
  for(const [name,scopes]of [['calendar.update',['calendar:write']],['calendar.cancel',['calendar:write']],['mail.send',['mail:send']],['unknown.execute',['system:execute']]]){
    assert.notEqual(taskOperationBinding(source(name,scopes,{id:'a'})),taskOperationBinding(source(name,scopes,{id:'b'})));
  }
});
test('the card describes calendar target and proposed changes without unrelated parameters or credentials',()=>{
  const summary=operationSummary(source('calendar.update',['calendar:write'],{externalId:'event-1',summary:'Team meeting',startUtc:'2030-10-22T09:00:00Z',secret:'private'}));
  assert.match(summary,/event-1/);assert.match(summary,/Team meeting/);assert.match(summary,/09:00/);assert.equal(summary.includes('private'),false);
});
test('an explicit Live start in full access does not ask for the same application permission again',()=>{
  assert.equal(needsMicrophoneApproval('full-access','live'),false);
  for(const mode of ['read-only','workspace-write',undefined])assert.equal(needsMicrophoneApproval(mode,'live'),true);
  assert.equal(needsMicrophoneApproval('full-access','wake'),true,'background listening remains a distinct purpose');
});

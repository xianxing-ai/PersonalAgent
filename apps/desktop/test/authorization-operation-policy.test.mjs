import test from 'node:test';
import assert from 'node:assert/strict';
import {needsMicrophoneApproval,operationContentConfirmation,operationSummary,taskOperationBinding} from '../electron/authorization-operation-policy.js';
const source=(name,scopes,args={})=>({toolName:name,toolVersion:'1',scopes,arguments:args,argumentsDigest:JSON.stringify(args)});

test('F23 evaluation report cannot silently publish a candidate configuration',()=>{
  const candidate={action:'promote',operationId:'original-report',configurationId:'decision',candidateParameters:{modelId:'candidate'}};
  const original=operationContentConfirmation(source('workflow.host.f23_n04',['workflow:configuration:write'],candidate));
  assert.match(original.text,/candidateParameters/);assert.match(original.text,/candidate/);
  assert.notEqual(original.digest,operationContentConfirmation(source('workflow.host.f23_n04',[],
    {...candidate,candidateParameters:{modelId:'changed'}})).digest);
  assert.equal(operationContentConfirmation(source('workflow.host.f23_n03',[],{})),undefined);
});

test('send and publication projections preserve complete registered content and every changed dangerous field',()=>{
  const text='正文\n'+ '长'.repeat(1000)+'\n尾部 <script>不可省略</script>',args={to:'a@example.test',subject:'主题',text};
  const original=operationContentConfirmation(source('mail.send',['mail:send'],args));
  assert.ok(original.text.includes(JSON.stringify(text)));
  for(const field of ['to','subject','text'])assert.notEqual(original.digest,
    operationContentConfirmation(source('mail.send',['mail:send'],{...args,[field]:args[field]+'x'})).digest);
  const pr={repo:'owner/repo',title:'Repair',body:text,head:'fix',base:'main',expectedHeadSha:'a'.repeat(40)};
  const publication=operationContentConfirmation(source('github.pr.create',['github:write'],pr));
  for(const value of Object.values(pr))assert.ok(publication.text.includes(JSON.stringify(value)));
  assert.throws(()=>operationContentConfirmation(source('mail.send',['mail:send'],{to:args.to,subject:'missing text'})),{code:'UNAUTHORIZED'});
});

test('unknown external writes and deletion show all original targets; credential shapes fail closed',()=>{
  const external=args=>({...source('vendor.execute',['vendor:write'],args),sideEffect:'external_write'});
  const result=operationContentConfirmation(external({target:'/data/a',permanent:false,scope:['one','two']}));
  assert.match(result.text,/\/data\/a/);assert.match(result.text,/"permanent": false/);assert.match(result.text,/"two"/);
  assert.ok(operationContentConfirmation(source('files.delete',['files:write'],{path:'/data/b',permanent:false})));
  assert.ok(operationContentConfirmation(source('computer.desktop.type',['computer:desktop:control'],{targetRef:'target',text:'complete',press_enter:true})));
  for(const key of ['apiKey','password','authorization','securityToken','private_key'])
    assert.throws(()=>operationContentConfirmation(external({target:'safe',nested:[{[key]:'must-not-display'}]})),{code:'UNAUTHORIZED'});
  assert.equal(operationContentConfirmation({...source('calendar.update',['calendar:write'],{externalId:'event'}),sideEffect:'external_write'}),undefined);
  assert.equal(operationContentConfirmation(source('computer.desktop.observe',['computer:desktop:control'],{})),undefined);
});
test('sandbox-scoped reads and ordinary local edits reuse while external mutations retain exact arguments',()=>{
  for(const [name,scopes]of [['calendar.events',['calendar:read']],['todo.create',['todo:write']],['workspace.apply_text_patch',['workspace:write']]]){
    assert.equal(taskOperationBinding(source(name,scopes,{id:'a'})),taskOperationBinding(source(name,scopes,{id:'b'})));
  }
  for(const [name,scopes]of [['calendar.update',['calendar:write']],['calendar.cancel',['calendar:write']],['mail.send',['mail:send']],['unknown.execute',['system:execute']],['unknown.operation',[]]]){
    assert.notEqual(taskOperationBinding(source(name,scopes,{id:'a'})),taskOperationBinding(source(name,scopes,{id:'b'})));
  }
});
test('the card describes calendar target and proposed changes without unrelated parameters or credentials',()=>{
  const summary=operationSummary(source('calendar.update',['calendar:write'],{externalId:'event-1',summary:'Team meeting',startUtc:'2030-10-22T09:00:00Z',secret:'private'}));
  assert.match(summary,/event-1/);assert.match(summary,/Team meeting/);assert.match(summary,/09:00/);assert.equal(summary.includes('private'),false);
});
test('todo cards distinguish cancelling an item from removing only its reminder and preserve the exact target',()=>{
  const sourceFor=args=>source('todo.update',['todo:write'],{...args,notes:'Private notes',secret:'Private secret'});
  const cancelled=operationSummary(sourceFor({id:'reminder-7429',status:'cancelled'}));
  const reminderOnly=operationSummary(sourceFor({id:'reminder-6281',clearReminder:true}));
  assert.match(cancelled,/编号 reminder-7429 的待办.*取消待办及其尚未触发的提醒/);
  assert.match(reminderOnly,/编号 reminder-6281 的待办.*清除提醒，保留待办记录/);
  assert.doesNotMatch(reminderOnly,/取消待办/);
  assert.doesNotMatch(cancelled+reminderOnly,/Private notes|Private secret/);
  assert.match(operationSummary(sourceFor({id:'reminder-7429',status:'done'})),/标为完成并停止后续提醒/);
});
test('an explicit Live start needs no duplicate application card in any file sandbox',()=>{
  for(const mode of ['full-access','read-only','workspace-write',undefined]){
    assert.equal(needsMicrophoneApproval(mode,'live'),false);
    assert.equal(needsMicrophoneApproval(mode,'wake'),true,'background wake remains a distinct purpose');
    assert.equal(needsMicrophoneApproval(mode,'dictation'),true);
  }
});

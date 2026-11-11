import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {EventEmitter} from 'node:events';

test('actual Main mail source controls bind the visible original task and terminate their scope',async()=>{
  const source=readFileSync(new URL('../electron/main.js',import.meta.url),'utf8');
  const start=source.indexOf("if (typeof name === 'string' && name.startsWith('memory.'))"),end=source.indexOf("if(['conversation.new'",start);
  assert.ok(start>=0&&end>start);const owner=new EventEmitter(),calls=[];
  const context={name:'memory.mail.readSource',payload:{taskId:'root'},sender:{},admin:owner,competitionMode:true,AbortController,
    runtimeApplication:{runtime:{getTask:()=>({taskId:'root',conversationId:'original'})}},
    conversations:{turns:new Map([['root',{}]]),containsConversation:id=>id==='original'},
    f08SourceActions:{readSource(input,scope){calls.push({input,scope});return {sourceId:'original-source'};},
      async listSources(scope){owner.emit('closed');assert.equal(scope.signal.aborted,true);return {facts:[]};}},publish(){}};
  const run=()=>runInNewContext('(async()=>{'+source.slice(start,end)+'})()',context);
  await assert.rejects(run(),/管理后台/);context.sender=owner;context.payload.sessionId='forged';
  await assert.rejects(run(),/原邮件任务/);delete context.payload.sessionId;context.conversations.turns.clear();
  await assert.rejects(run(),/原邮件对话/);assert.equal(calls.length,0);context.conversations.turns.set('root',{});
  assert.equal((await run()).sourceId,'original-source');assert.equal(calls[0].scope.conversationId,'original');
  assert.equal(calls[0].scope.signal.aborted,true);assert.equal(owner.listenerCount('closed'),0);
  context.name='memory.mail.listSources';context.payload=undefined;await run();assert.equal(owner.listenerCount('closed'),0);
});

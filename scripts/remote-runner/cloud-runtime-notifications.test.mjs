import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdirSync,mkdtempSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {TodoService,reminderTriggers} from '@personal-agent/productivity';
import {createRuntimeApplication,createReminderDeliveryHost} from '@personal-agent/runtime/application';
import {createCloudRuntimeNotifications} from './cloud-runtime-notifications.mjs';

// Real original SQLite/Scheduler/notification queue; no network or device channels.
test('cloud reminder feed survives reopening without replay, isolates scopes and preserves expiry/read policy',async()=>{
  mkdirSync('.cache',{recursive:true});const file=join(resolve(mkdtempSync(join('.cache','cloud-notifications-'))),'runtime.sqlite');
  let clock=Date.now(),application,notifications,queued=0;const now=()=>clock,deliveries=[];
  const open=()=>{
    application=createRuntimeApplication({path:file,profile:'huawei_ict_agentarts',hostUserNamespace:'notification-fixture',now:()=>new Date(clock)});
    notifications=createCloudRuntimeNotifications({application,assertCurrent(){},now});
  };
  const bind=name=>{
    const source=application.runtime.submitTask({goal:'Explicit fixture reminder '+name,conversationId:'fixture:'+name,idempotencyKey:'source:'+name});
    const task=application.runtime.submitTask({goal:source.goal,conversationId:source.conversationId,idempotencyKey:'responsibility:'+name});
    return {taskId:task.taskId,sourceTaskId:source.taskId,sessionId:name,taskDeadline:new Date(clock+10_000).toISOString()};
  };
  const delivery=(binding,items)=>{
    const conversationId='fixture-reminders:'+binding.taskId;
    const host=createReminderDeliveryHost({runtime:application.runtime,conversationId,now,
      enqueue(schedule){queued++;notifications.enqueueReminder(binding,schedule,items.find(item=>schedule.goal==='提醒待办：'+item.title));},
      readReceipt:scheduleId=>notifications.hasReminder(binding,scheduleId)});
    deliveries.push(host);return {host,desired:reminderTriggers(items,conversationId)};
  };
  open();
  try {
    const first=bind('first'),second=bind('second');let id=0;
    const todos=new TodoService(application.runtime.bindTrustedHostState('fixture-todos'),{now,idFactory:()=>`fixture-todo-${++id}`});
    const create=title=>todos.create({title,notes:'Private source text is never in the notification projection',
      reminder:{remindAt:{utc:new Date(clock+1_000).toISOString()},missedPolicy:'run_once'}});
    const one=create('one'),two=create('two'),other=create('other');
    const a=delivery(first,[one,two]),b=delivery(second,[other]);
    await a.host.tick(a.desired);await b.host.tick(b.desired);assert.equal(queued,0);
    clock+=2_000;await a.host.tick(a.desired);await b.host.tick(b.desired);assert.equal(queued,3);
    const before=notifications.snapshot(first),ids=before.items.map(item=>item.id);
    assert.equal(before.items.length,2);assert.deepEqual(before.unreadItemIds,ids);assert.deepEqual(before.returnItemIds,[]);
    assert.equal(before.interruptionCount,0);assert.equal(before.delivery,'waiting_device');
    assert.equal(JSON.stringify(before).includes('Private source'),false);
    const foreign=notifications.snapshot(second).items[0].id;
    assert.throws(()=>notifications.acknowledgeRead(first,{operationId:'foreign',itemIds:[foreign]}),{code:'UNAUTHORIZED'});
    notifications.acknowledgeRead(first,{operationId:'read-one',itemIds:[ids[0]]});
    assert.deepEqual(notifications.snapshot(first).unreadItemIds,[ids[1]]);
    for(const host of deliveries)await host.close();application.close();open();
    const reopened=delivery(first,[one,two]);await reopened.host.tick(reopened.desired);
    assert.equal(queued,3,'Original fired receipt must not enqueue again after restart');
    assert.equal(notifications.hasReminder(first,ids[0]),true);
    assert.equal(notifications.hasReminder(second,ids[0]),false);
    assert.equal(notifications.snapshot(first).items.length,2);
    assert.ok(notifications.snapshot(first).items[0].readAt);
    const original=notifications.runtimeHost;
    original.ingest([{source:'feeds',accountRef:'public-fixture',externalId:'scoped',contentRef:'public:scoped',dedupeKey:'scoped-fixture',
      occurredAt:new Date(clock).toISOString(),fetchedAt:new Date(clock).toISOString(),sensitivity:'normal'}],
    {scope:{kind:'responsibility',responsibilityId:first.taskId,connectorId:'feeds'},validUntilUtc:first.taskDeadline});
    assert.ok(notifications.snapshot(first).items.some(item=>item.id==='scoped-fixture'));
    assert.ok(notifications.snapshot(first).unreadItemIds.includes('scoped-fixture'));
    assert.equal(notifications.snapshot(second).items.some(item=>item.id==='scoped-fixture'),false);
    assert.equal(original.getInterruptionPolicy({kind:'global'}).state,'unconfigured');
    assert.equal(original.status().unacknowledgedBatches,0,'No drain or delivery batches are created');
    assert.ok(original.notificationFeed().items.every(item=>item.deliveredAt===undefined));
    clock+=10_000;
    assert.deepEqual(notifications.snapshot(first).unreadItemIds,[]);
    assert.deepEqual(notifications.snapshot(first).returnItemIds,[]);
    assert.equal(notifications.hasReminder(first,ids[1]),true,'Expired receipt still prevents replay');
    assert.throws(()=>notifications.acknowledgeRead(first,{operationId:'late',itemIds:[ids[1]]}),{code:'UNAUTHORIZED'});
  } finally {for(const host of deliveries)await host.close();application.close();}
});

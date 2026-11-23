import test from 'node:test';
import assert from 'node:assert/strict';
import {calendarSnapshotVersion,FakeCalendarProvider,register} from '../dist/index.js';
import {FakeToolHost} from '@personal-agent/testkit';

test('calendar window version detects source changes and ignores read time and ordering',()=>{
  const window={fromUtc:'2026-10-31T00:00:00.000Z',toUtc:'2026-11-01T00:00:00.000Z'};
  const one={source:'calendar',accountRef:'fixture',externalId:'one',dedupeKey:'calendar:one:1',
    contentRef:'Meeting',validFor:'2026-10-31T01:00:00.000Z/2026-10-31T02:00:00.000Z',fetchedAt:'2026-10-31T00:01:00.000Z'};
  const two={...one,externalId:'two',dedupeKey:'calendar:two:1'};
  const original=calendarSnapshotVersion(window,[one,two]);
  assert.equal(original,calendarSnapshotVersion(window,[two,{...one,fetchedAt:'2026-10-31T00:02:00.000Z'}]));
  for(const changed of [{dedupeKey:'calendar:one:2'},{contentRef:'Changed'},{validFor:'changed'},{accountRef:'other'}])
    assert.notEqual(original,calendarSnapshotVersion(window,[{...one,...changed},two]));
  assert.notEqual(original,calendarSnapshotVersion(window,[one]));
  assert.notEqual(original,calendarSnapshotVersion({...window,toUtc:'2026-11-02T00:00:00.000Z'},[one,two]));
});


test('registered calendar tool emits a version only for a complete first page',async()=>{
  const now=Date.parse('2026-09-07T00:00:00.000Z'),host=new FakeToolHost(()=>now),provider=new FakeCalendarProvider();
  const release=register(host,{provider,accountRef:'fixture-account',now:()=>now});
  const context={taskId:'task',runId:'read',signal:new AbortController().signal,deadline:'2026-09-07T01:00:00.000Z',
    authorizationRef:'test',scopes:['calendar:read']};
  const window={fromUtc:'2026-09-06T00:00:00.000Z',toUtc:'2026-11-02T00:00:00.000Z'};
  try{
    const complete=await host.invoke('calendar.events',{...window,limit:100},context);
    assert.equal(complete.hasMore,false);
    assert.equal(complete.sourceVersion,calendarSnapshotVersion(complete.window,complete.items));
    const first=await host.invoke('calendar.events',{...window,limit:2},context);
    assert.equal(first.hasMore,true);assert.equal(Object.hasOwn(first,'sourceVersion'),false);
    const last=await host.invoke('calendar.events',{...window,limit:2,cursor:first.nextCursor},context);
    assert.equal(last.hasMore,false);assert.equal(Object.hasOwn(last,'sourceVersion'),false);
    provider.mutateEvent('evt-review',{title:'Synthetic changed'});
    const changed=await host.invoke('calendar.events',{...window,limit:100},context);
    assert.notEqual(changed.sourceVersion,complete.sourceVersion);
  }finally{release();}
});

test('empty-window digest carries no account identity and requires an independent source binding',async()=>{
  const now=Date.parse('2026-09-07T00:00:00.000Z');
  const input={fromUtc:'2030-01-01T00:00:00.000Z',toUtc:'2030-01-02T00:00:00.000Z'};
  const context={taskId:'task',runId:'read',signal:new AbortController().signal,deadline:'2026-09-07T01:00:00.000Z',
    authorizationRef:'test',scopes:['calendar:read']};
  const hosts=['fixture-a','fixture-b'].map(accountRef=>{
    const host=new FakeToolHost(()=>now);const release=register(host,{provider:new FakeCalendarProvider([]),accountRef,now:()=>now});
    return {host,release};
  });
  try{
    const [a,b]=await Promise.all(hosts.map(({host})=>host.invoke('calendar.events',input,context)));
    assert.deepEqual(a.items,[]);assert.deepEqual(b.items,[]);
    assert.equal(a.sourceVersion,b.sourceVersion);
  }finally{hosts.forEach(({release})=>release());}
});

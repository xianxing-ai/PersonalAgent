import assert from 'node:assert/strict';
import test from 'node:test';
import {CalDavProvider} from '../dist/index.js';

const URL_BASE = 'https://caldav.test/potatos/mvp/';

/** 假 CalDAV 服务器：记录请求并按脚本应答；资源表模拟 PUT/GET/DELETE 语义。 */
function fakeServer() {
  const resources = new Map();
  const versions = new Map();
  const log = [];
  const fetchImpl = async (url, init) => {
    const method = init.method;
    log.push({method, url: String(url), headers: {...init.headers}});
    const path = String(url).replace(URL_BASE, '');
    if (method === 'PUT') {
      if (init.headers['if-none-match'] === '*' && resources.has(path)
        || init.headers['if-match'] !== undefined && init.headers['if-match'] !== `"${versions.get(path) ?? 0}"`)
        return {ok: false, status: 412, text: async () => ''};
      resources.set(path, init.body);
      versions.set(path, (versions.get(path) ?? 0) + 1);
      return {ok: true, status: resources.has(path) && log.filter(r => r.url === String(url) && r.method === 'PUT').length > 1 ? 204 : 201, text: async () => ''};
    }
    if (method === 'GET') {
      const body = resources.get(path);
      if (body === undefined) return {ok: false, status: 404, text: async () => ''};
      const etag = `"${versions.get(path) ?? 0}"`;
      return {ok: true, status: 200, headers: {get: name => name === 'etag' ? etag : null}, text: async () => body};
    }
    if (method === 'DELETE') {
      if (init.headers['if-match'] !== undefined && init.headers['if-match'] !== `"${versions.get(path) ?? 0}"`)
        return {ok: false, status: 412, text: async () => ''};
      const existed = resources.delete(path);
      return {ok: existed, status: existed ? 204 : 404, text: async () => ''};
    }
    throw Error('unexpected method ' + method);
  };
  return {fetchImpl, log, resources, versions};
}

const ctx = () => ({deadline: new Date(Date.now() + 30_000).toISOString(), signal: new AbortController().signal});

test('nonzero milliseconds are rejected before any network request for either write boundary', async () => {
  for (const operation of ['createEvent', 'updateEvent']) {
    for (const field of ['startUtc', 'endUtc']) {
      const server = fakeServer(), provider = new CalDavProvider({calendarUrl: URL_BASE, fetchImpl: server.fetchImpl});
      const input = {uid: 'precision', summary: 'precision', startUtc: '2026-10-21T07:00:00.000Z', endUtc: '2026-10-21T08:00:00Z'};
      input[field] = input[field].replace(/(?:\.000)?Z$/, '.123Z');
      await assert.rejects(provider[operation](input, ctx()), {code: 'INVALID_ARGUMENT'});
      assert.deepEqual(server.log, [], operation + ' must not fetch or write an unrepresentable instant');
    }
  }
  const server = fakeServer(), provider = new CalDavProvider({calendarUrl: URL_BASE, fetchImpl: server.fetchImpl});
  await provider.createEvent({uid: 'precision', summary: 'valid', startUtc: '2026-10-21T07:00:00Z', endUtc: '2026-10-21T08:00:00.000Z'}, ctx());
  await provider.updateEvent({uid: 'precision', startUtc: '2026-10-21T07:30:00.000Z', endUtc: '2026-10-21T08:30:00Z'}, ctx());
  assert.equal(server.log.filter(r => r.method === 'PUT').length, 2);
});

test('summary-only updates preserve original all-day boundaries, attendees and alarms', async () => {
  const server = fakeServer(), provider = new CalDavProvider({calendarUrl: URL_BASE, fetchImpl: server.fetchImpl});
  const original = ['BEGIN:VCALENDAR','VERSION:2.0','BEGIN:VEVENT','UID:all-day','DTSTART;VALUE=DATE:20261021',
    'DTEND;VALUE=DATE:20261022','SUMMARY:original','ATTENDEE:mailto:original@example.invalid',
    'BEGIN:VALARM','DESCRIPTION:alarm','TRIGGER:-PT15M','END:VALARM','END:VEVENT','END:VCALENDAR'].join('\r\n')+'\r\n';
  server.resources.set('all-day.ics', original);
  const updated = await provider.updateEvent({uid: 'all-day', summary: 'changed'}, ctx());
  assert.equal(updated.title, 'changed');
  const stored = server.resources.get('all-day.ics');
  for (const line of ['DTSTART;VALUE=DATE:20261021','DTEND;VALUE=DATE:20261022','ATTENDEE:mailto:original@example.invalid',
    'BEGIN:VALARM','DESCRIPTION:alarm','TRIGGER:-PT15M','END:VALARM']) assert.ok(stored.includes(line+'\r\n'));
  assert.doesNotMatch(stored, /DTSTART:|DTEND:/);
  const writes = server.log.filter(r => r.method === 'PUT').length;
  await assert.rejects(provider.updateEvent({uid: 'all-day', startUtc: '2026-10-21T01:00:00Z'},ctx()),{code:'UNSUPPORTED_CAPABILITY'});
  assert.equal(server.log.filter(r => r.method === 'PUT').length,writes);
});

test('changing one timed boundary preserves the other TZID property and checks it on readback', async () => {
  for (const corruptReadback of [false, true]) {
    const server = fakeServer();
    server.resources.set('zoned.ics', ['BEGIN:VCALENDAR','VERSION:2.0','BEGIN:VEVENT','UID:zoned',
      'DTSTART;TZID=Asia/Shanghai:20261021T150000','DTEND;TZID=Asia/Shanghai:20261021T160000',
      'SUMMARY:zoned','END:VEVENT','END:VCALENDAR'].join('\r\n')+'\r\n');
    let gets = 0;
    const provider = new CalDavProvider({calendarUrl: URL_BASE, fetchImpl: async(url, init) => {
      const response = await server.fetchImpl(url, init);
      if (init.method !== 'GET' || ++gets !== 2 || !corruptReadback) return response;
      return {...response, text: async() => (await response.text()).replace('DTEND;TZID=Asia/Shanghai:20261021T160000','DTEND:20261021T080000Z')};
    }});
    const update = provider.updateEvent({uid:'zoned',startUtc:'2026-10-21T07:30:00Z'},ctx());
    if (corruptReadback) await assert.rejects(update,{code:'EXTERNAL_FAILURE'});
    else assert.equal((await update).startUtc,'2026-10-21T07:30:00.000Z');
    assert.match(server.resources.get('zoned.ics'),/DTEND;TZID=Asia\/Shanghai:20261021T160000\r\n/);
    assert.equal(server.log.filter(r => r.method === 'PUT').length,1);
  }
});

test('create 写入 ICS 并读回核对；字段与形态正确', async () => {
  const server = fakeServer();
  const provider = new CalDavProvider({calendarUrl: URL_BASE, authorization: 'Basic dGVzdA==', fetchImpl: server.fetchImpl});
  const record = await provider.createEvent({summary: '接线验收测试', startUtc: '2026-10-21T07:00:00.000Z',
    endUtc: '2026-10-21T08:00:00.000Z', location: '会议室 1', notes: '来自验收'});
  assert.match(record.externalId, /^[a-f0-9-]{36}$/);
  assert.equal(record.title, '接线验收测试');
  assert.equal(record.startUtc, '2026-10-21T07:00:00.000Z');
  assert.equal(record.status, 'confirmed');
  const stored = server.resources.get(`${record.externalId}.ics`);
  assert.match(stored, /UID:/);
  assert.match(stored, /SUMMARY:接线验收测试/);
  assert.match(stored, /LOCATION:会议室 1/);
  assert.match(stored, /DTSTART:20261021T070000Z/);
});

test('显式 uid 创建重放幂等；update 递增 SEQUENCE 并合并字段', async () => {
  const server = fakeServer();
  const provider = new CalDavProvider({calendarUrl: URL_BASE, authorization: 'Basic dGVzdA==', fetchImpl: server.fetchImpl});
  const first = await provider.createEvent({summary: '原始标题', startUtc: '2026-10-21T07:00:00.000Z',
    endUtc: '2026-10-21T08:00:00.000Z', uid: 'pa-fixed-uid-1'}, ctx());
  assert.equal(first.externalId, 'pa-fixed-uid-1');
  // 同 UID 重放：PUT 幂等，读回一致
  const replay = await provider.createEvent({summary: '原始标题', startUtc: '2026-10-21T07:00:00.000Z',
    endUtc: '2026-10-21T08:00:00.000Z', uid: 'pa-fixed-uid-1'}, ctx());
  assert.equal(replay.externalId, 'pa-fixed-uid-1');
  const updated = await provider.updateEvent({uid: 'pa-fixed-uid-1', summary: '改期后的标题',
    startUtc: '2026-10-21T06:30:00.000Z'}, ctx());
  assert.equal(updated.title, '改期后的标题');
  assert.equal(updated.startUtc, '2026-10-21T06:30:00.000Z');
  assert.equal(updated.endUtc, '2026-10-21T08:00:00.000Z', '未提供的 end 保持原值');
  assert.ok(updated.sequence >= 1, 'SEQUENCE 递增');
  assert.equal(updated.endUtc > updated.startUtc, true);
});

test('cancel 删除资源；再次 cancel 如实报 already_absent', async () => {
  const server = fakeServer();
  const provider = new CalDavProvider({calendarUrl: URL_BASE, authorization: 'Basic dGVzdA==', fetchImpl: server.fetchImpl});
  const created = await provider.createEvent({summary: '将取消', startUtc: '2026-10-21T07:00:00.000Z',
    endUtc: '2026-10-21T08:00:00.000Z', uid: 'pa-cancel-1'}, ctx());
  assert.equal(created.externalId, 'pa-cancel-1');
  const cancelled = await provider.cancelEvent('pa-cancel-1', ctx());
  assert.equal(cancelled.state, 'cancelled');
  const again = await provider.cancelEvent('pa-cancel-1', ctx());
  assert.equal(again.state, 'already_absent');
  await assert.rejects(provider.getEvent('cal', 'pa-cancel-1', ctx()), () => true);
});

test('非法输入与认证失败按契约报错', async () => {
  const server = fakeServer();
  const provider = new CalDavProvider({calendarUrl: URL_BASE, authorization: 'Basic bad', fetchImpl: server.fetchImpl});
  await assert.rejects(provider.createEvent({summary: 'x', startUtc: '2026-10-21T07:00', endUtc: '2026-10-21T08:00:00.000Z'}, ctx()),
    {code: 'INVALID_ARGUMENT'});
  await assert.rejects(provider.createEvent({summary: 'x', startUtc: '2026-10-21T09:00:00.000Z',
    endUtc: '2026-10-21T08:00:00.000Z'}, ctx()), {code: 'INVALID_ARGUMENT'});
  // 401：假服务器无认证校验，用 404 资源 GET 验 NOT_FOUND 路径
  await assert.rejects(provider.updateEvent({uid: 'missing-uid'}, ctx()), {code: 'NOT_FOUND'});
});

test('write readback rejects a server which retains UID but changes the requested fields', async () => {
  for (const replace of [body => body.replace('SUMMARY:original','SUMMARY:changed'),
    body => body.replace('DTSTART:20261021T070000Z','DTSTART:20261021T073000Z'),
    body => body.replace('LOCATION:room','LOCATION:another')]) {
    const server = fakeServer();
    const provider = new CalDavProvider({calendarUrl: URL_BASE,fetchImpl:async(url,init)=>{
      const result = await server.fetchImpl(url,init);
      return init.method === 'GET' ? {...result,text:async()=>replace(await result.text())} : result;
    }});
    await assert.rejects(provider.createEvent({uid:'mismatch',summary:'original',location:'room',
      startUtc:'2026-10-21T07:00:00.000Z',endUtc:'2026-10-21T08:00:00.000Z'},ctx()),{code:'EXTERNAL_FAILURE'});
    assert.equal(server.log.filter(entry=>entry.method==='PUT').length,1,'an unconfirmed write is never replayed');
  }
});

test('UTF-8 folding round-trips and update preserves unrelated original attendee and alarm fields',async()=>{
  const server=fakeServer(),provider=new CalDavProvider({calendarUrl:URL_BASE,fetchImpl:server.fetchImpl});
  const summary='中文会议'.repeat(80),notes='多字节备注'.repeat(100);
  const created=await provider.createEvent({uid:'folded',summary,notes,location:'original-room',
    startUtc:'2026-10-21T07:00:00.000Z',endUtc:'2026-10-21T08:00:00.000Z'},ctx());
  assert.equal(created.title,summary);assert.equal(created.notes,notes);
  const stored=server.resources.get('folded.ics');
  for(const line of stored.split('\r\n'))assert.ok(Buffer.byteLength(line,'utf8')<=75);
  assert.match(stored,/DTSTAMP:\d{8}T\d{6}Z/);
  server.resources.set('folded.ics',stored.replace('END:VEVENT','ATTENDEE:mailto:original@example.invalid\r\nBEGIN:VALARM\r\nDESCRIPTION:original alarm\r\nEND:VALARM\r\nEND:VEVENT'));
  const updated=await provider.updateEvent({uid:'folded',summary:'changed'},ctx());
  assert.equal(updated.location,'original-room');assert.equal(updated.notes,notes);
  assert.match(server.resources.get('folded.ics'),/ATTENDEE:mailto:original@example.invalid/);
  assert.match(server.resources.get('folded.ics'),/DESCRIPTION:original alarm/);
  server.resources.set('folded.ics',server.resources.get('folded.ics').replace('END:VEVENT','RRULE:FREQ=DAILY\r\nEND:VEVENT'));
  const before=server.log.filter(entry=>entry.method==='PUT').length;
  await assert.rejects(provider.updateEvent({uid:'folded',summary:'unsafe'},ctx()),{code:'UNSUPPORTED_CAPABILITY'});
  assert.equal(server.log.filter(entry=>entry.method==='PUT').length,before);
});

test('caller cancellation bounds uncooperative write transport without a second request',async()=>{
  const controller=new AbortController();let calls=0;
  const provider=new CalDavProvider({calendarUrl:URL_BASE,fetchImpl:async()=>{calls++;controller.abort();return new Promise(()=>{});}});
  await assert.rejects(provider.createEvent({uid:'cancelled-pending',summary:'pending',
    startUtc:'2026-10-21T07:00:00.000Z',endUtc:'2026-10-21T08:00:00.000Z'},
    {signal:controller.signal,deadline:new Date(Date.now()+30000).toISOString()}),{code:'CANCELLED'});
  assert.equal(calls,1);
});

const originalEvent={uid:'guarded-event',summary:'original',startUtc:'2026-10-21T07:00:00.000Z',endUtc:'2026-10-21T08:00:00.000Z'};

test('create never replaces an existing UID with different fields',async()=>{
  const server=fakeServer(),provider=new CalDavProvider({calendarUrl:URL_BASE,fetchImpl:server.fetchImpl});
  await provider.createEvent(originalEvent,ctx());const before=server.resources.get('guarded-event.ics');
  await assert.rejects(provider.createEvent({...originalEvent,summary:'replacement'},ctx()),{code:'REVISION_CONFLICT'});
  assert.equal(server.resources.get('guarded-event.ics'),before);
  assert.ok(server.log.filter(r=>r.method==='PUT').every(r=>r.headers['if-none-match']==='*'));
});

test('update and cancel reject concurrent resource changes without overwriting or deleting them',async t=>{
  for(const method of ['update','cancel'])await t.test(method,async()=>{
    const server=fakeServer();let race=false;
    const provider=new CalDavProvider({calendarUrl:URL_BASE,fetchImpl:async(url,init)=>{
      const result=await server.fetchImpl(url,init);
      if(race&&init.method==='GET'){
        race=false;server.resources.set('guarded-event.ics',server.resources.get('guarded-event.ics').replace('SUMMARY:original','SUMMARY:external edit'));
        server.versions.set('guarded-event.ics',server.versions.get('guarded-event.ics')+1);
      }
      return result;
    }});
    await provider.createEvent(originalEvent,ctx());race=true;
    await assert.rejects(method==='update'?provider.updateEvent({uid:originalEvent.uid,summary:'local edit'},ctx()):provider.cancelEvent(originalEvent.uid,ctx()),{code:'REVISION_CONFLICT'});
    assert.match(server.resources.get('guarded-event.ics'),/SUMMARY:external edit/);
  });
});

test('missing or weak ETag prevents an update or delete before any write',async t=>{
  for(const etag of [null,'W/"weak"','invalid','"bad\r\nheader"'])for(const method of ['update','cancel'])await t.test(`${method}:${JSON.stringify(etag)}`,async()=>{
    const server=fakeServer();const provider=new CalDavProvider({calendarUrl:URL_BASE,fetchImpl:async(url,init)=>{
      const result=await server.fetchImpl(url,init);
      return init.method==='GET'?{...result,headers:{get:()=>etag}}:result;
    }});
    await provider.createEvent(originalEvent,ctx());const count=server.log.length;
    await assert.rejects(method==='update'?provider.updateEvent({uid:originalEvent.uid,summary:'local edit'},ctx()):provider.cancelEvent(originalEvent.uid,ctx()),{code:'UNSUPPORTED_CAPABILITY'});
    assert.deepEqual(server.log.slice(count).map(r=>r.method),['GET']);
  });
});

test('cancel requires an absence readback and does not repeat a deletion which still reads present',async()=>{
  const server=fakeServer();let deletions=0;
  const provider=new CalDavProvider({calendarUrl:URL_BASE,fetchImpl:async(url,init)=>{
    if(init.method==='DELETE'){deletions++;return {ok:true,status:204,text:async()=>''};}
    return server.fetchImpl(url,init);
  }});
  await provider.createEvent(originalEvent,ctx());
  await assert.rejects(provider.cancelEvent(originalEvent.uid,ctx()),{code:'EXTERNAL_FAILURE'});
  assert.equal(deletions,1);assert.ok(server.resources.has('guarded-event.ics'));
});

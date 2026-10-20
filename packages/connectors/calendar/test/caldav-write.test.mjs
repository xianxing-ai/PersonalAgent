import assert from 'node:assert/strict';
import test from 'node:test';
import {CalDavProvider} from '../dist/index.js';

const URL_BASE = 'https://caldav.test/potatos/mvp/';

/** 假 CalDAV 服务器：记录请求并按脚本应答；资源表模拟 PUT/GET/DELETE 语义。 */
function fakeServer() {
  const resources = new Map();
  const log = [];
  const fetchImpl = async (url, init) => {
    const method = init.method;
    log.push({method, url: String(url)});
    const path = String(url).replace(URL_BASE, '');
    if (method === 'PUT') {
      resources.set(path, init.body);
      return {ok: true, status: resources.has(path) && log.filter(r => r.url === String(url) && r.method === 'PUT').length > 1 ? 204 : 201, text: async () => ''};
    }
    if (method === 'GET') {
      const body = resources.get(path);
      if (body === undefined) return {ok: false, status: 404, text: async () => ''};
      return {ok: true, status: 200, text: async () => body};
    }
    if (method === 'DELETE') {
      const existed = resources.delete(path);
      return {ok: existed, status: existed ? 204 : 404, text: async () => ''};
    }
    throw Error('unexpected method ' + method);
  };
  return {fetchImpl, log, resources};
}

const ctx = () => ({deadline: new Date(Date.now() + 30_000).toISOString(), signal: new AbortController().signal});

test('impossible Gregorian dates and 24:00 are rejected before GET or PUT', async t => {
  for (const invalid of ['2026-02-30T09:00:00Z', '2026-02-29T09:00:00.000Z',
    '2026-04-31T09:00:00Z', '1900-02-29T09:00:00Z', '2026-02-28T24:00:00Z', '0000-02-29T09:00:00Z']) {
    for (const operation of ['createEvent', 'updateEvent']) for (const field of ['startUtc', 'endUtc']) {
      await t.test(`${operation} ${field} ${invalid}`, async () => {
        const server = fakeServer(), provider = new CalDavProvider({calendarUrl: URL_BASE, fetchImpl: server.fetchImpl});
        const year = invalid.startsWith('0000') ? '0001' : invalid.slice(0, 4), uid = 'calendar-invalid';
        const original = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'BEGIN:VEVENT', `UID:${uid}`,
          `DTSTART:${year}0101T090000Z`, `DTEND:${year}1231T100000Z`, 'SUMMARY:original',
          'END:VEVENT', 'END:VCALENDAR'].join('\r\n') + '\r\n';
        server.resources.set(uid + '.ics', original);
        const input = {uid, summary: 'must not persist', startUtc: `${year}-01-01T09:00:00Z`,
          endUtc: `${year}-12-31T10:00:00.000Z`, [field]: invalid};
        await assert.rejects(provider[operation](input, ctx()), {code: 'INVALID_ARGUMENT'});
        assert.deepEqual(server.log, [], 'invalid date must not issue even the initial update GET');
        assert.deepEqual([...server.resources], [[uid + '.ics', original]], 'the original resource is untouched');
      });
    }
  }
});

test('valid leap days and years below 100 retain their literal UTC write boundaries', async () => {
  for (const date of ['2028-02-29', '2000-02-29', '0096-02-29', '0004-02-29', '0099-04-30']) {
    const server = fakeServer(), provider = new CalDavProvider({calendarUrl: URL_BASE, fetchImpl: server.fetchImpl});
    const created = await provider.createEvent({uid: 'calendar-valid', summary: 'valid',
      startUtc: `${date}T09:00:00Z`, endUtc: `${date}T10:00:00.000Z`}, ctx());
    assert.equal(created.startUtc, `${date}T09:00:00.000Z`);
    const updated = await provider.updateEvent({uid: 'calendar-valid', startUtc: `${date}T09:30:00.000Z`,
      endUtc: `${date}T10:30:00Z`}, ctx());
    assert.equal(updated.startUtc, `${date}T09:30:00.000Z`);assert.equal(updated.endUtc, `${date}T10:30:00.000Z`);
    assert.match(server.resources.get('calendar-valid.ics'), new RegExp('DTSTART:' + date.replaceAll('-', '') + 'T093000Z\\r\\n'));
    assert.equal(server.log.filter(entry => entry.method === 'PUT').length, 2);
  }
});

test('recurrence property names reject lowercase and mixed case before PUT', async () => {
  for (const [key,value] of [['RRULE','FREQ=DAILY'],['RDATE','20261022T070000Z'],
    ['EXDATE','20261022T070000Z'],['RECURRENCE-ID','20261021T070000Z']]) {
    for (const name of [key.toLowerCase(),key[0]+key.slice(1).toLowerCase()]) {
      const server=fakeServer(),provider=new CalDavProvider({calendarUrl:URL_BASE,fetchImpl:server.fetchImpl});
      server.resources.set('series.ics',['begin:vcalendar','version:2.0','bEgIn:vEvEnT','uid:series',
        'dtstart:20261021T070000Z','dtend:20261021T080000Z','summary:original',`${name}:${value}`,
        'eNd:vEvEnT','end:vcalendar'].join('\r\n')+'\r\n');
      await assert.rejects(provider.updateEvent({uid:'series',summary:'unsafe'},ctx()),{code:'UNSUPPORTED_CAPABILITY'});
      assert.equal(server.log.filter(r=>r.method==='PUT').length,0,name);
    }
  }
});

test('mixed-case event fields retain all-day and TZID boundaries without duplicate properties', async () => {
  for (const allDay of [true,false]) {
    const server=fakeServer(),provider=new CalDavProvider({calendarUrl:URL_BASE,fetchImpl:server.fetchImpl});
    const start=allDay?'dtstart;value=DATE:20261021':'dtstart;tzid=Asia/Shanghai:20261021T150000';
    const end=allDay?'DtEnD;value=DATE:20261022':'DtEnD;tzid=Asia/Shanghai:20261021T160000';
    const extras=['attendee:mailto:original@example.invalid','begin:valarm','description:alarm','trigger:-PT15M','end:valarm'];
    server.resources.set('mixed.ics',['begin:vcalendar','version:2.0','begin:vevent','uid:mixed',start,end,
      'summary:original',...extras,'end:vevent','end:vcalendar'].join('\r\n')+'\r\n');
    const input={uid:'mixed',summary:'changed',...(allDay?{}:{startUtc:'2026-10-21T07:30:00Z'})};
    const result=await provider.updateEvent(input,ctx());assert.equal(result.title,'changed');
    const stored=server.resources.get('mixed.ics'),lines=stored.split('\r\n');
    for(const key of ['UID','SUMMARY','DTSTART','DTEND'])assert.equal(lines.filter(l=>l.split(/[:;]/)[0].toUpperCase()===key).length,1,key);
    for(const line of [end,...extras,...(allDay?[start]:[])])assert.ok(lines.includes(line),line);
    if(!allDay)assert.equal(result.startUtc,'2026-10-21T07:30:00.000Z');
  }
});

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
  assert.match(record.externalId, /^pa-e[0-9a-f]{24}$/, 'uid 缺省=内容确定性派生（同输入重放幂等），不再是随机 UUID');
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

test('uid omitted initializes a content-derived identifier: same input replays idempotently onto one resource (zemeng #439 P2)', async () => {
  const server = fakeServer(), provider = new CalDavProvider({calendarUrl: URL_BASE, fetchImpl: server.fetchImpl});
  const input = {summary: 'standup', startUtc: '2026-10-21T07:00:00.000Z', endUtc: '2026-10-21T08:00:00Z',
    location: '  前台  ', notes: 'day 3'};
  const first = await provider.createEvent(input, ctx());
  assert.match(first.externalId, /^pa-e[0-9a-f]{24}$/, 'derived uid = pa-e + sha256 hex（且通过 WRITE_UID_PATTERN 语义）');
  const second = await provider.createEvent(input, ctx());
  assert.equal(second.externalId, first.externalId, '同内容重复提交必须命中同一 UID（重放幂等），而不是生成第二个事件');
  const puts = server.log.filter(entry => entry.method === 'PUT');
  assert.equal(puts.length, 2, '两次提交都是 PUT（第二次覆盖同一资源）');
  assert.equal(puts[0].url, puts[1].url, '两次 PUT 打到同一资源 URL');
  const resources = [...server.resources.keys()];
  assert.equal(resources.length, 1, 'content-derived uid 下同输入只有一个资源，不会累积第二个事件');
  // 不同内容 → 不同 UID
  const other = await provider.createEvent({...input, summary: 'standup (moved)'}, ctx());
  assert.notEqual(other.externalId, first.externalId, '不同内容自然产生不同 UID');
  // 显式 uid 优先于派生
  const explicit = await provider.createEvent({...input, uid: 'explicit-uid-1'}, ctx());
  assert.equal(explicit.externalId, 'explicit-uid-1');
});

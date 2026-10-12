import assert from 'node:assert/strict';
import {test} from 'node:test';
import {CalDavProvider, CalendarService, parseCalDavEvents} from '../dist/index.js';

const now = () => Date.parse('2026-09-30T11:00:00.000Z');
const window = {fromUtc: '2026-10-01T00:00:00.000Z', toUtc: '2026-11-01T00:00:00.000Z'};
const escape = text => text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
function ics(sequence, status = 'CONFIRMED', day = '02', modified = '20260930T100000Z', month = '10') {
  return ['BEGIN:VCALENDAR', 'BEGIN:VEVENT', 'UID:single-uid', `SEQUENCE:${sequence}`,
    `SUMMARY:revision ${sequence}`, `DTSTART;TZID=Asia/Shanghai:2026${month}${day}T100000`,
    `DTEND;TZID=Asia/Shanghai:2026${month}${day}T110000`, `LAST-MODIFIED:${modified}`, `STATUS:${status}`,
    'END:VEVENT', 'END:VCALENDAR'].join('\r\n');
}
function server() {
  let bodies = [ics(1), ics(2)];
  let confirmation;
  const calls = [];
  const instant = stamp => Date.parse(stamp.replace(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/, '$1-$2-$3T$4:$5:$6Z'));
  const provider = new CalDavProvider({calendarUrl: 'https://fixture.example.invalid/calendar/',
    fetchImpl: async (_url, init) => {
      assert.equal(init.method, 'REPORT');
      assert.match(init.body, /<C:comp-filter name="VEVENT">/);
      const range = /<C:time-range start="([^"]+)"\s+end="([^"]+)"\/>/.exec(init.body);
      // Behave like a server: apply the requested range before returning resources.
      // A revised resource moved out of the range is invisible to that REPORT.
      const selected = range === null ? confirmation ?? bodies : bodies.filter(body =>
        parseCalDavEvents(body).some(event => event.startMs < instant(range[2]) && event.endMs > instant(range[1])));
      calls.push({body: init.body, signal: init.signal, returned: [...selected]});
      return {ok: true, status: 207, text: async () => '<D:multistatus xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav">'
        + selected.map((body, i) => `<D:response><D:href>/calendar/${i}.ics</D:href><D:propstat><D:prop><C:calendar-data>${escape(body)}</C:calendar-data></D:prop></D:propstat></D:response>`).join('')
        + '</D:multistatus>'};
    }});
  return {provider, calls, set: value => {bodies = value;}, confirm: value => {confirmation = value;}};
}

test('server time-range hides the moved revision; current UID confirmation prevents old snapshot resurrection', async () => {
  const {provider, calls, set} = server();
  const service = new CalendarService(provider, {now});
  const previous = (await service.listEvents('fixture', window)).items;
  const moved = ics(3, 'CONFIRMED', '02', '20260930T110000Z', '11');
  set([ics(1), moved]);
  calls.length = 0;
  assert.deepEqual((await service.listEvents('fixture', window)).items, []);
  assert.equal(calls.length, 2, 'one window discovery and one unwindowed confirmation, not one request per UID');
  assert.match(calls[0].body, /time-range/);
  assert.deepEqual(calls[0].returned, [ics(1)], 'server has excluded the new version before the client sees it');
  assert.doesNotMatch(calls[1].body, /time-range/);
  assert.deepEqual(calls[1].returned, [ics(1), moved]);
  const changed = await service.refreshKnownItems('fixture', previous);
  assert.equal(changed.length, 1);
  assert.equal(changed[0].dedupeKey, 'calendar:caldav:single-uid:3');
  assert.equal(changed[0].occurredAt, '2026-11-02T02:00:00.000Z');
  assert.match(changed[0].contentRef, /^\[confirmed\]/, 'move is not cancellation');
  assert.deepEqual(await service.refreshKnownItems('fixture', changed), []);
});

test('missing, regressed or conflicting confirmation fails without returning a stale or cancelled item', async () => {
  const {provider, confirm} = server();
  for (const current of [[], [ics(1)], [ics(2, 'CANCELLED')]]) {
    confirm(current);
    await assert.rejects(provider.fetchWindow('fixture', window), {code: 'EXTERNAL_FAILURE', retryable: false});
  }
});

test('current UID confirmation preserves LAST-MODIFIED selection and recurrence-instance boundary', async () => {
  const {provider, set} = server();
  set([ics(3), ics(3, 'CONFIRMED', '02', '20260930T110000Z', '11')]);
  assert.deepEqual((await provider.fetchWindow('fixture', window)).events, []);
  set([ics(3).replace('SEQUENCE:3', 'SEQUENCE:3\r\nRECURRENCE-ID;TZID=Asia/Shanghai:20261002T100000')]);
  await assert.rejects(provider.getEvent('fixture', 'single-uid'), {code: 'UNSUPPORTED_CAPABILITY'});
});

test('host cancellation and deadline stop confirmation and response-body reads without returning old data', async () => {
  for (const interruption of ['cancel', 'deadline', 'body']) {
    let calls = 0;
    let confirmationSignal;
    const controller = new AbortController();
    const provider = new CalDavProvider({calendarUrl: 'https://fixture.example.invalid/calendar/',
      fetchImpl: async (_url, init) => {
        calls += 1;
        if (calls === 1) return {status: 207, ok: true, text: async () => '<D:multistatus xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav">'
          + `<D:response><D:href>/old.ics</D:href><C:calendar-data>${escape(ics(1))}</C:calendar-data></D:response></D:multistatus>`};
        confirmationSignal = init.signal;
        if (interruption !== 'deadline') setTimeout(() => controller.abort(), 5);
        if (interruption === 'body') return {status: 207, ok: true, text: async () => new Promise(() => {})};
        return new Promise(() => {}); // Transport deliberately ignores abort.
      }});
    await assert.rejects(new CalendarService(provider, {now: Date.now}).listEvents('fixture', window,
      {signal: controller.signal, deadline: new Date(Date.now() + (interruption === 'deadline' ? 100 : 5000)).toISOString()}),
    {code: interruption === 'deadline' ? 'TIMEOUT' : 'CANCELLED'});
    assert.equal(calls, 2);
    assert.equal(confirmationSignal.aborted, true);
  }
});

for(const timeoutOrigin of ['host','provider'])test(`an early ${timeoutOrigin} timer waits for its actual deadline before stopping confirmation`,async t=>{
  let clock=now(),nextTimer=0,calls=0,confirmationSignal,entered;
  const timers=new Map(),ready=new Promise(resolve=>{entered=resolve;});
  t.mock.method(Date,'now',()=>clock);
  t.mock.method(globalThis,'setTimeout',(callback,delay)=>{const id=++nextTimer;timers.set(id,{callback,delay});return id;});
  t.mock.method(globalThis,'clearTimeout',id=>{timers.delete(id);});
  const provider=new CalDavProvider({calendarUrl:'https://fixture.example.invalid/calendar/',requestTimeoutMs:timeoutOrigin==='provider'?100:30000,
    fetchImpl:async(_url,init)=>{
      calls++;
      if(calls===1)return {status:207,ok:true,text:async()=>'<D:multistatus xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav">'
        +`<D:response><D:href>/old.ics</D:href><C:calendar-data>${escape(ics(1))}</C:calendar-data></D:response></D:multistatus>`};
      confirmationSignal=init.signal;entered();return new Promise(()=>{});
    }});
  const operation=new CalendarService(provider,{now:Date.now}).listEvents('fixture',window,
    {signal:new AbortController().signal,deadline:new Date(clock+(timeoutOrigin==='host'?100:5000)).toISOString()});
  const observed=operation.then(value=>({value}),error=>({error}));
  await ready;clock+=99;
  [...timers.values()].at(-1).callback();
  assert.equal(confirmationSignal.aborted,false,'an early timer must not end the active lease');
  assert.equal([...timers.values()].at(-1).delay,1);
  clock+=1;[...timers.values()].at(-1).callback();
  const result=await observed;
  assert.equal(result.value,undefined);assert.equal(result.error.code,timeoutOrigin==='host'?'TIMEOUT':'EXTERNAL_FAILURE');
  assert.equal(calls,2);assert.equal(confirmationSignal.aborted,true);
});

test('CalDAV chooses one UID revision consistently in window and single-item paths, preserves TZID', async () => {
  const {provider, set} = server();
  const first = await provider.fetchWindow('fixture', window);
  assert.equal(first.events.length, 1);
  assert.equal(first.events[0].sequence, 2);
  assert.equal(first.events[0].timeZone, 'Asia/Shanghai');
  assert.equal(first.events[0].startUtc, '2026-10-02T02:00:00.000Z');
  assert.equal((await provider.getEvent('fixture', 'single-uid')).sequence, 2);
  set([ics(2), ics(1)]);
  assert.deepEqual((await provider.fetchWindow('fixture', window)).events, first.events, 'response order cannot select an older revision');
});

test('newer cancellation cannot resurrect the older UID; refreshKnownItems returns cancellation exactly once after baseline update', async () => {
  const {provider, set} = server();
  const service = new CalendarService(provider, {now});
  const previous = (await service.listEvents('fixture', window)).items;
  set([ics(1), ics(3, 'CANCELLED')]);
  assert.equal((await service.listEvents('fixture', window)).items.length, 0);
  const changed = await service.refreshKnownItems('fixture', previous);
  assert.equal(changed.length, 1);
  assert.match(changed[0].contentRef, /^\[cancelled\]/);
  assert.deepEqual(await service.refreshKnownItems('fixture', changed), []);
  set([]);
  await assert.rejects(service.refreshKnownItems('fixture', changed), {code: 'NOT_FOUND'});
});

test('equal-sequence LAST-MODIFIED resolves version; equal conflicting versions fail closed', async () => {
  const {provider, set} = server();
  set([ics(3, 'CONFIRMED', '02', '20260930T100000Z'), ics(3, 'CONFIRMED', '03', '20260930T110000Z')]);
  assert.equal((await provider.getEvent('fixture', 'single-uid')).startUtc, '2026-10-03T02:00:00.000Z');
  set([ics(3, 'CONFIRMED', '02'), ics(3, 'CANCELLED', '02')]);
  await assert.rejects(provider.fetchWindow('fixture', window), {code: 'EXTERNAL_FAILURE'});
});

test('baseline scope mismatch and non-progressing calendar page are rejected', async () => {
  const {provider} = server();
  const service = new CalendarService(provider, {now});
  const items = (await service.listEvents('fixture', window)).items;
  await assert.rejects(service.refreshKnownItems('other', items), {code: 'INVALID_ARGUMENT'});
  const stuck = new CalendarService({providerKind: 'fixture', verification: 'mock',
    fetchWindow: () => ({events: [], hasMore: true, nextCursor: '0'})}, {now});
  await assert.rejects(stuck.listEvents('fixture', window), {code: 'EXTERNAL_FAILURE'});
});

import assert from 'node:assert/strict';
import test from 'node:test';
import {createCalendarEventReadTool} from '../dist/application.js';

const configurationId='a'.repeat(64);
const args={configurationId,externalId:'meeting-uid'};
const xml='<d:multistatus xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav"><d:response><d:href>/calendar/one.ics</d:href><d:propstat><d:prop><c:calendar-data>BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\nUID:meeting-uid\r\nDTSTART:20261001T080000Z\r\nDTEND:20261001T090000Z\r\nSUMMARY:Meeting\r\nSEQUENCE:2\r\nSTATUS:CANCELLED\r\nEND:VEVENT\r\nEND:VCALENDAR</c:calendar-data></d:prop></d:propstat></d:response></d:multistatus>';
const context=(signal=new AbortController().signal,deadline=new Date(Date.now()+60_000).toISOString())=>
  ({taskId:'fixture',runId:'fixture-run',authorizationRef:'fixture-run',scopes:['calendar:read'],signal,deadline});
function fixture(fetchImpl) {
  let binding={configurationId,accountRef:'account',calendarUrl:'https://example.test/calendar/'};
  let credentials=0;
  const tool=createCalendarEventReadTool({getBinding:()=>binding,
    readAuthorization:()=>{credentials++;return 'Basic fixture';},fetchImpl});
  return {tool,credentials:()=>credentials,revoke:()=>{binding=undefined;}};
}

test('single read retains cancellation status through the public ConnectorItem result', async () => {
  let calls=0;
  const {tool}=fixture(async(url,init)=>{
    calls++;assert.equal(url,'https://example.test/calendar/');assert.equal(init.method,'REPORT');
    assert.equal(init.redirect,'error');assert.equal(init.headers.authorization,'Basic fixture');
    assert.equal(init.signal.aborted,false);
    return {status:207,ok:true,text:async()=>xml};
  });
  assert.deepEqual(tool.descriptor.requiredScopes,['calendar:read']);
  assert.equal(tool.descriptor.sideEffect,'read');
  const item=await tool.execute(args,context());
  assert.equal(item.accountRef,'account');assert.equal(item.externalId,'meeting-uid');
  assert.equal(item.dedupeKey,'calendar:caldav:meeting-uid:2');
  assert.match(item.contentRef,/^\[cancelled\]/);
  assert.equal(calls,1);
});

test('mismatched configuration, pre-cancel and expired deadline make zero credential/network calls', async () => {
  let calls=0;const f=fixture(async()=>{calls++;throw Error('must not call');});
  await assert.rejects(f.tool.execute({...args,configurationId:'b'.repeat(64)},context()),{code:'UNAUTHORIZED'});
  const controller=new AbortController();controller.abort();
  await assert.rejects(f.tool.execute(args,context(controller.signal)),{code:'CANCELLED'});
  await assert.rejects(f.tool.execute(args,context(undefined,'2000-01-01T00:00:00.000Z')),{code:'TIMEOUT'});
  assert.equal(f.credentials(),0);assert.equal(calls,0);
});

test('revoke after read and parent cancellation reject late results', async () => {
  let f;
  f=fixture(async()=>{f.revoke();return {status:207,ok:true,text:async()=>xml};});
  await assert.rejects(f.tool.execute(args,context()),{code:'UNAUTHORIZED'});
  const controller=new AbortController();
  const cancelled=fixture(async(_url,init)=>new Promise((_resolve,reject)=>{
    init.signal.addEventListener('abort',()=>reject(Error('aborted')),{once:true});
    controller.abort();
  }));
  await assert.rejects(cancelled.tool.execute(args,context(controller.signal)),{code:'CANCELLED'});
});

test('deadline also bounds an unresolved credential adapter; NOT_FOUND does not imply cancellation', async () => {
  const tool=createCalendarEventReadTool({getBinding:()=>({configurationId,accountRef:'account',calendarUrl:'https://example.test/'}),
    readAuthorization:()=>new Promise(()=>{}),fetchImpl:async()=>{throw Error('no request');}});
  await assert.rejects(tool.execute(args,context(undefined,new Date(Date.now()+15).toISOString())),{code:'TIMEOUT'});
  const missing=fixture(async()=>({status:207,ok:true,text:async()=>'<multistatus></multistatus>'}));
  await assert.rejects(missing.tool.execute(args,context()),{code:'NOT_FOUND'});
});

test('windows-system binding reads single event via WindowsSystemCalendarProvider without calendarUrl', async () => {
  let calledOp = '';
  const tool = createCalendarEventReadTool({
    getBinding: () => ({configurationId, accountRef: 'account', providerKind: 'windows-system', calendarName: 'Windows 系统日历'}),
    readAuthorization: () => 'windows-system:local',
    windowsTransport: {
      async run(req) {
        calledOp = req.op;
        if (req.op !== 'getEvent') return {event: null};
        return {
          event: {
            localId: 'local-1',
            roamingId: 'meeting-uid',
            calendarId: 'win-local-cal',
            subject: '系统本地日程',
            startUtc: '2026-10-01T08:00:00.000Z',
            endUtc: '2026-10-01T09:00:00.000Z',
            changeNumber: 3,
            canWrite: true,
          },
        };
      },
    },
  });
  const item = await tool.execute(args, context());
  assert.equal(calledOp, 'getEvent');
  assert.equal(item.accountRef, 'account');
  assert.equal(item.externalId, 'meeting-uid');
  assert.equal(item.dedupeKey, 'calendar:win-local-cal:meeting-uid:3');
  assert.match(item.contentRef, /系统本地日程/);
});

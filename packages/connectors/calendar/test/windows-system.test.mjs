import assert from 'node:assert/strict';
import test from 'node:test';
import { spawn } from 'node:child_process';
import { ProtocolError } from '@personal-agent/contracts';
import { CalendarService, WindowsSystemCalendarProvider, register } from '../dist/index.js';

function createFakeTransport() {
  const events = new Map();
  const requests = [];
  return {
    requests,
    events,
    async run(request) {
      requests.push(request);
      switch (request.op) {
        case 'listCalendars':
          return {
            calendars: [
              { id: 'win-ro-1', name: '日历', canWrite: false },
              { id: 'win:app:1', name: 'PersonalAgent', canWrite: true },
            ],
          };
        case 'fetchWindow':
          return { events: [...events.values()] };
        case 'getEvent':
          return { event: events.get(request.externalId) ?? null };
        case 'createEvent': {
          const id = request.uid ?? `local-${events.size + 1}`;
          const existing = events.get(id);
          if (existing) {
            return { conflictCheck: true, event: existing };
          }
          const created = {
            localId: id,
            roamingId: id,
            calendarId: 'win:app:1',
            subject: request.summary,
            startUtc: request.startUtc,
            endUtc: request.endUtc,
            location: request.location,
            details: request.notes,
            changeNumber: 1,
            cancelled: false,
            canWrite: true,
          };
          events.set(id, created);
          return { conflictCheck: false, event: created };
        }
        case 'updateEvent': {
          const existing = events.get(request.uid);
          if (!existing) throw new ProtocolError('NOT_FOUND', 'missing');
          if (existing.canWrite === false) throw new ProtocolError('UNAUTHORIZED', 'read only');
          if (request.expectedSequence !== undefined && request.expectedSequence !== existing.changeNumber) {
            throw new ProtocolError('REVISION_CONFLICT', 'sequence mismatch');
          }
          const updated = {
            ...existing,
            ...(request.summary !== undefined ? { subject: request.summary } : {}),
            ...(request.startUtc !== undefined ? { startUtc: request.startUtc } : {}),
            ...(request.endUtc !== undefined ? { endUtc: request.endUtc } : {}),
            ...(request.location !== undefined ? { location: request.location } : {}),
            ...(request.notes !== undefined ? { details: request.notes } : {}),
            changeNumber: existing.changeNumber + 1,
          };
          events.set(request.uid, updated);
          return { event: updated };
        }
        case 'cancelEvent': {
          const existing = events.get(request.uid);
          if (!existing) return { state: 'already_absent' };
          if (existing.canWrite === false) throw new ProtocolError('UNAUTHORIZED', 'read only');
          events.delete(request.uid);
          return { state: 'cancelled' };
        }
        default:
          throw new Error(`unexpected op: ${request.op}`);
      }
    },
  };
}

test('WindowsSystemCalendarProvider: 读取、分页、CalendarService 规范化与写入幂等性', async () => {
  const transport = createFakeTransport();
  transport.events.set('ro-evt-1', {
    localId: 'b,5,13:ro-evt-1',
    calendarId: 'b,5,13',
    subject: '同步账户会议',
    startUtc: '2026-11-21T02:00:00.000Z',
    endUtc: '2026-11-21T03:00:00.000Z',
    location: '线上',
    changeNumber: 7,
    canWrite: false,
  });

  const provider = new WindowsSystemCalendarProvider({
    calendarName: 'Windows 系统日历',
    timeZone: 'Asia/Shanghai',
    now: () => Date.parse('2026-11-21T00:00:00.000Z'),
    transport,
  });

  assert.equal(provider.providerKind, 'windows-system');
  assert.equal(provider.verification, 'conditional');

  const calendars = await provider.listCalendars('acc-1');
  assert.equal(calendars.length, 2);
  assert.equal(calendars[1].id, 'win_app_1');

  const service = new CalendarService(provider, { now: () => Date.parse('2026-11-21T00:00:00.000Z') });
  const page = await service.listEvents('acc-1', {
    fromUtc: '2026-11-21T00:00:00.000Z',
    toUtc: '2026-11-22T00:00:00.000Z',
  });
  assert.equal(page.items.length, 1);
  assert.equal(page.items[0].dedupeKey, 'calendar:b,5,13:b,5,13:ro-evt-1:7');
  assert.match(page.items[0].contentRef, /2026-11-21T10:00:00（Asia\/Shanghai）/);

  const created = await provider.writes.createEvent({
    summary: '项目评审',
    startUtc: '2026-11-21T06:00:00.000Z',
    endUtc: '2026-11-21T07:00:00.000Z',
    location: '302 室',
    uid: 'pa-uid-1',
  });
  assert.equal(created.calendarId, 'win_app_1');
  assert.equal(created.sequence, 1);

  // 同 UID 且同内容幂等重放
  const idempotent = await provider.writes.createEvent({
    summary: '项目评审',
    startUtc: '2026-11-21T06:00:00.000Z',
    endUtc: '2026-11-21T07:00:00.000Z',
    location: '302 室',
    uid: 'pa-uid-1',
  });
  assert.equal(idempotent.externalId, 'pa-uid-1');

  // 同 UID 不同内容拒绝
  await assert.rejects(
    () => provider.writes.createEvent({
      summary: '被篡改的标题',
      startUtc: '2026-11-21T06:00:00.000Z',
      endUtc: '2026-11-21T07:00:00.000Z',
      uid: 'pa-uid-1',
    }),
    err => err instanceof ProtocolError && err.code === 'REVISION_CONFLICT',
  );

  // 更新 CAS 校验与递增
  const updated = await provider.writes.updateEvent({
    uid: 'pa-uid-1',
    summary: '项目评审（更新）',
    expectedSequence: 1,
  });
  assert.equal(updated.sequence, 2);
  assert.equal(updated.title, '项目评审（更新）');

  // 只读日历事件拒绝更新或取消
  await assert.rejects(
    () => provider.writes.updateEvent({ uid: 'ro-evt-1', summary: '非法修改' }),
    err => err instanceof ProtocolError && err.code === 'UNAUTHORIZED',
  );

  // RSVP 显式拒绝
  assert.throws(
    () => provider.respond({ accountRef: 'acc-1', externalId: 'pa-uid-1', status: 'accepted' }),
    err => err instanceof ProtocolError && err.code === 'UNSUPPORTED_CAPABILITY',
  );

  // 取消 + 幂等 absent
  const cancelled1 = await provider.writes.cancelEvent('pa-uid-1');
  assert.equal(cancelled1.state, 'cancelled');
  const cancelled2 = await provider.writes.cancelEvent('pa-uid-1');
  assert.equal(cancelled2.state, 'already_absent');
});

test('WindowsSystemCalendarProvider: 非法时间窗、空白标题、非法游标与已取消上下文', async () => {
  const transport = createFakeTransport();
  const provider = new WindowsSystemCalendarProvider({ transport });

  await assert.rejects(
    () => provider.fetchWindow('acc-1', { fromUtc: '2026-11-22T00:00:00.000Z', toUtc: '2026-11-21T00:00:00.000Z' }),
    err => err instanceof ProtocolError && err.code === 'INVALID_ARGUMENT',
  );
  await assert.rejects(
    () => provider.fetchWindow('acc-1', { fromUtc: '2026-11-21T00:00:00.000Z', toUtc: '2026-11-22T00:00:00.000Z' }, 'bad-cursor'),
    err => err instanceof ProtocolError && err.code === 'CURSOR_EXPIRED',
  );
  await assert.rejects(
    () => provider.writes.createEvent({ summary: '   ', startUtc: '2026-11-21T01:00:00.000Z', endUtc: '2026-11-21T02:00:00.000Z' }),
    err => err instanceof ProtocolError && err.code === 'INVALID_ARGUMENT',
  );
  const ac = new AbortController();
  ac.abort();
  await assert.rejects(
    () => provider.fetchWindow('acc-1', { fromUtc: '2026-11-21T00:00:00.000Z', toUtc: '2026-11-22T00:00:00.000Z' }, undefined, { signal: ac.signal }),
    err => err instanceof ProtocolError && err.code === 'CANCELLED',
  );
});

const runLiveWindows = process.platform === 'win32' && process.env.PA_CALENDAR_WINDOWS_LIVE === '1';

test('Windows update binds either requested ID to the saved event and checks the changed fields', async () => {
  const event = {localId: 'local-1', roamingId: 'roaming-1', calendarId:'calendar', subject:'新标题',
    startUtc:'2026-11-21T01:00:00.000Z', endUtc:'2026-11-21T02:00:00.000Z',
    location:'新地点', details:'新备注', changeNumber:2, cancelled:false};
  const patch = {summary:event.subject, startUtc:event.startUtc, endUtc:event.endUtc,
    location:event.location, notes:event.details};
  let readback = event, writes = 0;
  const provider = new WindowsSystemCalendarProvider({transport:{async run(request) {
    assert.equal(request.op, 'updateEvent'); writes++; return {event:readback};
  }}});
  const tools = new Map();
  const dispose = register({register(tool) { tools.set(tool.descriptor.name, tool); return () => {}; }}, {provider});
  const update = tools.get('calendar.update');
  try {
    for (const uid of [event.localId, event.roamingId]) {
      const receipt = await update.execute({externalId:uid, ...patch}, {});
      assert.equal(receipt.item.externalId, event.roamingId);
      assert.equal(receipt.uid, uid === event.localId ? uid : undefined);
    }
    const invalid = [{localId:'other-local',roamingId:'other-roaming'},{subject:'旧标题'},
      {startUtc:event.endUtc},{endUtc:event.startUtc},{location:'旧地点'},{details:'旧备注'}];
    for (const difference of invalid) {
      readback = {...event, ...difference};
      await assert.rejects(update.execute({externalId:event.localId, ...patch}, {}), {code:'RESULT_UNKNOWN'});
    }
    assert.equal(writes, 2 + invalid.length);
  } finally { dispose(); }
});

test('live Windows WinRT read/write/update/cancel roundtrip (self-cleaning)', { skip: !runLiveWindows }, async () => {
  const testCalendarName = `PersonalAgent-Test-${Date.now()}`;
  const provider = new WindowsSystemCalendarProvider({ calendarName: testCalendarName, timeZone: 'Asia/Shanghai' });
  const uid = `pa-winrt-test-${Date.now()}`;
  try {
    const calendars = await provider.listCalendars('acc-live');
    assert.ok(Array.isArray(calendars));

    const created = await provider.writes.createEvent({
      uid,
      summary: 'WinRT 系统日历实测日程',
      startUtc: '2026-11-25T06:00:00.000Z',
      endUtc: '2026-11-25T07:00:00.000Z',
      location: '本地电脑',
      notes: '自动清理验证',
    });
    assert.equal(created.externalId, uid);
    assert.equal(created.title, 'WinRT 系统日历实测日程');

    const fetched = await provider.getEvent('acc-live', uid);
    assert.equal(fetched?.externalId, uid);
    assert.equal(fetched?.location, '本地电脑');

    const page = await provider.fetchWindow('acc-live', {
      fromUtc: '2026-11-25T00:00:00.000Z',
      toUtc: '2026-11-26T00:00:00.000Z',
    });
    assert.ok(page.events.some(e => e.externalId === uid));

    const updated = await provider.writes.updateEvent({
      uid,
      summary: 'WinRT 系统日历已更新',
      expectedSequence: created.sequence,
    });
    assert.equal(updated.title, 'WinRT 系统日历已更新');
    assert.ok(updated.sequence > created.sequence);

    const cancelled = await provider.writes.cancelEvent(uid);
    assert.equal(cancelled.state, 'cancelled');
    const afterCancel = await provider.getEvent('acc-live', uid);
    assert.equal(afterCancel, undefined);
  } finally {
    // 清理测试时创建的应用日历
    const psScript = `
[Windows.ApplicationModel.Appointments.AppointmentManager, Windows.ApplicationModel.Appointments, ContentType=WindowsRuntime] | Out-Null
[Windows.ApplicationModel.Appointments.AppointmentStore, Windows.ApplicationModel.Appointments, ContentType=WindowsRuntime] | Out-Null
[Windows.ApplicationModel.Appointments.AppointmentCalendar, Windows.ApplicationModel.Appointments, ContentType=WindowsRuntime] | Out-Null
Add-Type -AssemblyName System.Runtime.WindowsRuntime
$asTask = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object { $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation\`1' })[0]
$asAction = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object { $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncAction' })[0]
$store = $asTask.MakeGenericMethod([Windows.ApplicationModel.Appointments.AppointmentStore]).Invoke($null, @([Windows.ApplicationModel.Appointments.AppointmentManager]::RequestStoreAsync([Windows.ApplicationModel.Appointments.AppointmentStoreAccessType]::AllCalendarsReadWrite))).GetAwaiter().GetResult()
$cals = $asTask.MakeGenericMethod([System.Collections.Generic.IReadOnlyList[Windows.ApplicationModel.Appointments.AppointmentCalendar]]).Invoke($null, @($store.FindAppointmentCalendarsAsync())).GetAwaiter().GetResult()
foreach ($c in $cals) {
  if ($c.DisplayName -eq '${testCalendarName}') {
    $null = $asAction.Invoke($null, @($c.DeleteAsync())).GetAwaiter().GetResult()
  }
}
`;
    const encoded = Buffer.from(psScript, 'utf16le').toString('base64');
    await new Promise(resolve => {
      const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', encoded], { shell: false, windowsHide: true });
      child.on('exit', resolve);
      child.on('error', resolve);
    });
  }
});

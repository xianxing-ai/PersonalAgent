import assert from 'node:assert/strict';
import test from 'node:test';
import {mkdtempSync, rmSync} from 'node:fs';
import {readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import ts from 'typescript';
import {createPersonalDashboardHost} from '../electron/personal-dashboard-host.js';

const mainSource = await readFile(new URL('../electron/main.js', import.meta.url), 'utf8');
const ast = ts.createSourceFile('main.js', mainSource, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
const fn = name => ast.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === name).getText(ast);

test('stopPanelVoice and hidePanel do not spam publish() on idle hover-leave, and still publish when voice or pin was active', async () => {
  const published = [];
  let hiddenCount = 0;
  const ctx = {
    panel: {webContents: {id: 7}, hide() { hiddenCount++; }},
    pinned: false,
    panelHiding: undefined,
    wakeQuitUnknown: false,
    wakeVoice: {hasActive: () => false, disable: async () => {}},
    voiceInput: {hasActive: () => false, cancelCapture: async () => {}},
    voiceStartupHost: {snapshot: () => ({active: false}), stop: async () => {}},
    liveVoice: {hasActive: () => false, stop: async () => {}},
    sisPlaybackHost: {snapshot: () => ({active: false}), stop: async () => {}},
    microphoneCaptureHost: {snapshot: () => ({active: false, busy: false}), revoke: async () => {}},
    publish: topics => published.push([...(topics ?? ['all'])]),
    Promise,
    Error,
  };
  vm.createContext(ctx);
  vm.runInContext(`${fn('stopWakeVoice')}\n${fn('stopPanelVoice')}\n${fn('hidePanel')}`, ctx);

  await ctx.hidePanel();
  await ctx.stopPanelVoice();
  assert.equal(hiddenCount, 1);
  assert.deepEqual(published, [], 'idle hover-hide must not dirty the panel snapshot');

  ctx.pinned = true;
  await ctx.hidePanel();
  assert.deepEqual(published, [['window']], 'unpinning on hide still publishes window topic');

  published.length = 0;
  ctx.voiceInput = {hasActive: () => true, cancelCapture: async () => {}};
  await ctx.stopPanelVoice();
  assert.deepEqual(published, [['all']], 'active voice teardown still publishes full update');
});

test('personalDashboardHost.tick suppresses unchanged onUpdate broadcasts and reuses cached snapshot between ticks', async t => {
  const dir = mkdtempSync(path.join(tmpdir(), 'pa-dashboard-idle-'));
  t.after(() => rmSync(dir, {recursive: true, force: true}));
  let clock = Date.parse('2026-11-21T10:00:00.000Z');
  let listCalls = 0;
  let updates = 0;
  const schedules = [{scheduleId: 'personal-dashboard:u1:weekly:2026-11-23T00:00:00.000Z', status: 'pending', runAt: '2026-11-23T00:00:00.000Z', goal: 'rollup', conversationId: 'personal-dashboard:u1', timeZone: 'UTC', missedRunPolicy: 'skip', taskIdempotencyKey: 'k1'}];
  const runtime = {
    listSchedules: () => { listCalls++; return schedules; },
    reconcileSchedules() {},
    recoverMissedSchedules() {},
    dispatchDueSchedules() {},
    getTask() { throw Error('unexpected'); },
  };
  const safeStorage = {
    isEncryptionAvailable: () => true,
    encryptString: s => Buffer.from(s, 'utf8'),
    decryptString: b => b.toString('utf8'),
  };
  const host = createPersonalDashboardHost({
    userData: dir,
    safeStorage,
    namespace: 'u1',
    runtime,
    dispatchTask: async () => {},
    now: () => clock,
    timeZone: 'UTC',
    onUpdate: () => { updates++; },
  });

  await host.tick(true);
  assert.equal(updates, 1);
  const callsAfterFirst = listCalls;

  // Sub-second polls (like the 120ms eventPoll) should return cached snapshot without querying SQLite again.
  clock += 120;
  await host.tick();
  clock += 120;
  await host.tick();
  assert.equal(listCalls, callsAfterFirst);
  assert.equal(updates, 1);

  // Subsequent 1s ticks with unchanged state must not emit redundant onUpdate() broadcasts.
  clock += 2000;
  await host.tick();
  clock += 2000;
  await host.tick();
  assert.equal(updates, 1);
});

test('panel window stays warm in background and clears opaque blue backing flash after load', () => {
  assert.match(mainSource, /mode === 'panel' \? \{autoplayPolicy: 'no-user-gesture-required', backgroundThrottling: false\} : \{\}/);
  assert.match(mainSource, /if \(panelPageLoaded && !panel\.isVisible\(\)\) panel\.setBackgroundColor\('#00000000'\);/);
});

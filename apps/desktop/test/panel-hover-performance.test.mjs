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

test('panel window stays warm in background', () => {
  assert.match(mainSource, /mode === 'panel' \? \{autoplayPolicy: 'no-user-gesture-required', backgroundThrottling: false\} : \{\}/);
});

test('a hover-opened panel remains available for typing until focus and pointer both leave', () => {
  let now = 1000, point = {x:50, y:50}, visible = false, focused = false, hides = 0;
  const ctx = vm.createContext({
    orb: {isDestroyed: () => false, getBounds: () => ({x:0, y:0, width:100, height:100})},
    panel: {
      isDestroyed: () => false, isVisible: () => visible, isFocused: () => focused,
      getBounds: () => ({x:120, y:0, width:420, height:600}),
      showInactive: () => { visible = true; },
      // The native material owns the backing color through opening and theming.
      setBackgroundColor: () => assert.fail('opening overwrote the material fallback'),
    },
    screen: {getCursorScreenPoint: () => point}, desktopHost: {settings:{hover:true, orbPlacement:'top'}},
    dragging:false, pinned:false, away:0, workspace:undefined, placePanelNearOrb() {},
    hidePanel: async () => { visible = false; hides++; }, reportPanelVoiceFailure: assert.fail,
    Date:{now: () => now},
  });
  vm.runInContext(fn('openPanel') + '\n' + fn('pollPanelHover'), ctx);
  const tick = (ms = 80) => { now += ms; ctx.pollPanelHover(); };
  tick();
  assert.equal(visible, true);
  point = {x:130, y:10};
  focused = true;
  tick();
  point = {x:900, y:900};
  tick();
  tick(800);
  assert.equal(hides, 0, 'pointer left while the editor still had focus');
  focused = false;
  tick();
  tick(400);
  assert.equal(hides, 0, 'keep the hover grace period after focus leaves');
  tick(200);
  assert.equal(hides, 1);
  point = {x:50, y:50};
  tick();
  point = {x:900, y:900};
  tick();
  tick(600);
  assert.equal(hides, 2, 'an untouched hover preview still collapses');
});

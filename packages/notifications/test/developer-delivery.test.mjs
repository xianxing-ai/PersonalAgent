import assert from 'node:assert/strict';
import test from 'node:test';
import {acceptDeveloperNotice, considerDeveloperDigest, deliverElectronNotification, emptyDeveloperDelivery, flushDeveloperDigest, setDeveloperDigestLimits, setDeveloperSubscription} from '../dist/index.js';

const channel = {name: 'desktop', async send(notice) {return {accepted: true, evidenceRef: `desktop:${notice.id}`};}};
const now = Date.parse('2026-11-03T08:00:00.000Z');

test('an interrupt notice is delivered on the desktop channel and recorded on the timeline', async () => {
  const result = await acceptDeveloperNotice(emptyDeveloperDelivery(), {id: 'n1', repo: 'octo/repo', kind: 'failure', summary: 'CI 失败', at: '2026-11-03T08:00:00.000Z'}, {now, channel});
  assert.equal(result.delivered, true);
  assert.equal(result.state.timeline[0].channel, 'desktop');
  assert.equal(result.state.timeline[0].evidenceRef, 'desktop:n1');
  const again = await acceptDeveloperNotice(result.state, {id: 'n1', repo: 'octo/repo', kind: 'failure', summary: 'CI 失败', at: '2026-11-03T08:00:00.000Z'}, {now, channel});
  assert.equal(again.state.timeline.length, 1);
});

test('silent notices stay on the timeline and a digest can be flushed', async () => {
  let state = setDeveloperSubscription(emptyDeveloperDelivery(), {repo: 'octo/repo', classes: ['silent', 'digest']});
  const silent = await acceptDeveloperNotice(state, {id: 's', repo: 'octo/repo', kind: 'timeline', summary: '只记时间线', at: '2026-11-03T08:00:00.000Z'}, {now, channel});
  assert.equal(silent.delivered, false);
  assert.equal(silent.state.timeline[0].channel, 'timeline');
  const progress = await acceptDeveloperNotice(silent.state, {id: 'p', repo: 'octo/repo', kind: 'progress', summary: '还在跑', at: '2026-11-03T08:01:00.000Z'}, {now, channel});
  state = progress.state;
  assert.equal(state.digest.length, 1);
  const flushed = await flushDeveloperDigest(state, {now, channel, summary: '还在跑'});
  assert.equal(flushed.delivered, true);
  assert.equal(flushed.state.digest.length, 0);
});

test('quiet hours hold ordinary notices, gate still interrupts, and digests throttle by hour and day', async () => {
  const sent = [];
  const desk = {name: 'desktop', async send(notice) {sent.push(notice.title); return {accepted: true, evidenceRef: `desktop:${notice.id}`};}};
  const quiet = {quietHours: {startLocal: '00:00', endLocal: '23:59', timeZone: 'UTC'}};
  const held = await acceptDeveloperNotice(setDeveloperSubscription(emptyDeveloperDelivery(), {repo: 'octo/repo', classes: ['interrupt', 'digest', 'silent']}), {id: 'fail', repo: 'octo/repo', kind: 'failure', summary: '夜里的失败', at: '2026-11-03T08:00:00.000Z'}, {now, policy: quiet, channel: desk});
  assert.equal(held.delivered, false);
  assert.equal(held.state.digest.length, 1);
  const gate = await acceptDeveloperNotice(held.state, {id: 'gate', repo: 'octo/repo', kind: 'gate', summary: '仍要确认', at: '2026-11-03T08:05:00.000Z'}, {now, policy: quiet, channel: desk});
  assert.equal(gate.delivered, true);
  let limited = setDeveloperDigestLimits(gate.state, {perHour: 1, perDay: 1});
  const first = await considerDeveloperDigest(limited, {now, channel: desk, minIntervalMs: 60_000});
  assert.equal(first.delivered, true);
  const queued = {...first.state, digest: [{id: 'later', repo: 'octo/repo', kind: 'progress', summary: '又一条', at: '2026-11-03T09:00:00.000Z'}]};
  const second = await considerDeveloperDigest(queued, {now: now + 3_600_000, channel: desk, minIntervalMs: 60_000});
  assert.equal(second.reason, 'daily digest limit reached');
  assert.equal(second.delivered, false);
  const shown = [];
  const native = deliverElectronNotification({id: 'n9', title: '需要你确认', body: '合并'}, {isSupported: () => true, create(input) {return {show() {shown.push(input);}};}});
  assert.equal(native.evidenceRef, 'desktop:n9');
  assert.deepEqual(shown, [{title: '需要你确认', body: '合并'}]);
  assert.equal(deliverElectronNotification({id: 'n10', title: '需要你确认', body: '合并'}, {isSupported: () => false, create() {return {};}}).reason, 'desktop notification unsupported');
});

import assert from 'node:assert/strict';
import test from 'node:test';
import {acceptDeveloperNotice, emptyDeveloperDelivery, flushDeveloperDigest, setDeveloperSubscription} from '../dist/index.js';

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

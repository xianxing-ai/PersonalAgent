import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {test} from 'node:test';
import {buildInterestOptions, LayaInterestDecisionService} from '../dist/interest-options.js';
import {LayaActionChoiceService} from '../dist/index.js';

const minute = 60_000;
const iso = ms => new Date(ms).toISOString();
function evidence(id, kind, now, extra = {}) {
  return {id, topicId: 'typescript', sourceId: 'conversation', sourceRevision: 'r1',
    occurredAt: iso(now - 20 * minute), interactionId: id, kind, match: 'semantic', ...extra};
}
function fixture(now = Date.now()) {
  return {topicId: 'typescript', at: iso(now), evidenceMaxAgeMs: 2 * 60 * minute,
    watchDurationMs: 60 * minute,
    evidence: [evidence('q1', 'question', now),
      evidence('follow', 'followup', now, {relatedEvidenceId: 'q1'})],
    source: {id: 'official-docs', revision: 'source-v1', visibility: 'public', risk: 'low',
      transportVerified: true, verificationExpiresAt: iso(now + 60 * minute)},
    scope: {state: 'granted', id: 'public-tracking', revision: 3,
      publicLowRiskTracking: true, expiresAt: iso(now + 60 * minute)}};
}
function chooser(pick, onInfer = () => {}) {
  return new LayaActionChoiceService({async infer(payload) {
    onInfer(payload);
    const criteria = payload.questions.action.criteria;
    const keys = Object.keys(criteria);
    const selected = keys.find(key => JSON.parse(criteria[key]).description.includes(pick));
    assert.ok(selected, `missing choice: ${pick}`);
    const probabilities = Object.fromEntries(keys.map(key =>
      [key, key === selected ? 0.9 : 0.1 / (keys.length - 1)]));
    return {answers: {action: {choice: selected, probabilities,
      answer_confidence: 0.9, confidence: 0.5}}};
  }});
}
const request = () => ({deadline: iso(Date.now() + 60 * minute),
  signal: new AbortController().signal});

test('uncooperative interest choices still reject on deadline and cancellation', async () => {
  for (const code of ['CANCELLED', 'TIMEOUT']) {
    const controller=new AbortController();
    let portSignal,started;
    const entered=new Promise(resolve=>{started=resolve;});
    const service=new LayaInterestDecisionService({choose({signal}) {
      portSignal=signal;started();return new Promise(()=>{});
    }});
    const lease={deadline:iso(Date.now()+(code==='TIMEOUT'?30:5000)),signal:controller.signal};
    const pending=service.choose(fixture(),lease);
    await entered;
    if(code==='CANCELLED')controller.abort();
    let guard;
    try {
      const result=await Promise.race([pending.then(()=> 'unexpected success',error=>error.code),
        new Promise(resolve=>{guard=setTimeout(()=>resolve('unsettled'),300);})]);
      assert.equal(result,code);assert.equal(portSignal.aborted,true);
    } finally {clearTimeout(guard);}
  }
});

test('caller cannot renew an interest lease by replacing its signal or deadline while choosing', async () => {
  for(const code of ['CANCELLED','TIMEOUT']) {
    let clock=Date.now();const controller=new AbortController(),expires=clock+1000;
    const lease={deadline:iso(expires),signal:controller.signal};
    const service=new LayaInterestDecisionService({async choose() {
      if(code==='CANCELLED') {controller.abort();lease.signal=new AbortController().signal;}
      else {clock=expires+1;lease.deadline=iso(clock+60*minute);}
      return {state:'selected',selected:{id:'track_public',revision:1},eligibleForRuntime:true,
        reason:'selected',calibrated:false,scores:[],receipt:{id:'synthetic'}};
    }},()=>clock);
    await assert.rejects(service.choose(fixture(clock),lease),{code});
  }
});

test('a single inquiry stays candidate; sustained public scope offers three bound approaches', () => {
  const input = fixture();
  const candidate = buildInterestOptions({...input, evidence: [input.evidence[0]]});
  assert.equal(candidate.policy.state, 'candidate');
  assert.deepEqual(candidate.options.map(option => option.id), ['retain_candidate', 'defer']);
  assert.ok(candidate.options.every(option => option.kind === 'escalate' && option.source === undefined));

  const watch = buildInterestOptions(input);
  assert.equal(watch.policy.state, 'watch_public');
  assert.deepEqual(watch.options.map(option => option.id),
    ['track_public', 'review_public', 'defer']);
  assert.deepEqual(watch.options[0].source,
    {id: input.source.id, revision: input.source.revision, validUntil: watch.policy.expiresAt});
  assert.deepEqual(watch.options[0].evidence, watch.policy.evidence);
  assert.deepEqual(watch.options[0].scope,
    {id: input.scope.id, revision: input.scope.revision});
  assert.ok(watch.options.every(option => option.kind === 'escalate'));
});

test('Laya choice service with fake inference binds source, evidence and scope without starting tracking', async () => {
  let clock = Date.now();
  const input = fixture(clock);
  const service = new LayaInterestDecisionService(chooser('plan tracking'), () => clock);
  const result = await service.choose(input, request());
  assert.equal(result.outcome, 'selected');
  assert.equal(result.selected.id, 'track_public');
  assert.deepEqual(result.selection.selected, {id: 'track_public', revision: 1});
  assert.equal(result.requiresHostRevalidation, true);
  assert.equal(result.calibrated, false);
  assert.equal(result.selection.calibrated, false);
  assert.match(result.receipt.digest, /^[a-f0-9]{64}$/);
  assert.deepEqual(result.receipt.evidence.map(ref => ref.id), ['follow', 'q1']);
  assert.deepEqual(new Set(result.receipt.evidence.map(ref => ref.id)),
    new Set(result.policy.evidence.map(ref => ref.id)));
  assert.deepEqual(result.receipt.source, result.policy.source);
  assert.deepEqual(result.receipt.scope, {id: input.scope.id, revision: input.scope.revision});
  assert.deepEqual(result.receipt.selectedRef, {id: 'track_public', revision: 1});
  assert.equal(result.receipt.optionRefs.length, 3);
  assert.equal(result.receipt.modelReceiptId, result.selection.receipt.id);
  assert.equal(result.selected.kind, 'escalate');
  clock += minute;
});

test('revocation and unavailable or stale policy never offer tracking or resume', async () => {
  const now = Date.now();
  const input = fixture(now);
  const revoked = {...input, scope: {...input.scope, state: 'revoked'}};
  assert.deepEqual(buildInterestOptions(revoked).options.map(option => option.id),
    ['stop_tracking', 'keep_revoked']);
  const result = await new LayaInterestDecisionService(chooser('stop any existing'), () => now)
    .choose(revoked, request());
  assert.equal(result.selected.id, 'stop_tracking');
  assert.equal(result.options.some(option => option.id === 'track_public'), false);
  for (const changed of [
    {...input, evidence: [], previous: {state: 'watch_public'}},
    {...input, source: {...input.source, transportVerified: false}},
    {...input, scope: {...input.scope, publicLowRiskTracking: false}}
  ]) {
    const built = buildInterestOptions(changed);
    assert.ok(['decay', 'abstain'].includes(built.policy.state));
    assert.equal(built.options.some(option => option.id === 'track_public'), false);
  }
  const injected = {choose: async () => ({state: 'selected', selected: {id: 'track_public', revision: 1},
    eligibleForRuntime: true, reason: 'selected', calibrated: false, scores: [], receipt: {id: 'forged'}})};
  await assert.rejects(new LayaInterestDecisionService(injected, () => now)
    .choose(revoked, request()), /outside offered options/);
});

test('unknown policy values and injected selection identities are rejected', async () => {
  const now = Date.now();
  const input = fixture(now);
  for (const changed of [
    {...input, scope: {...input.scope, state: 'secretly_granted'}},
    {...input, scope: {...input.scope, publicLowRiskTracking: 'yes'}},
    {...input, source: {...input.source, visibility: 'internal'}},
    {...input, classification: {label: 'sustained', abstained: false, calibrated: true, evidence: []}}
  ]) assert.throws(() => buildInterestOptions(changed), /Invalid/);
  for (const selected of [{id: 'injected', revision: 1}, {id: 'track_public', revision: 2}]) {
    const injected = {choose: async () => ({state: 'selected', selected,
      eligibleForRuntime: true, reason: 'selected', calibrated: false, scores: [], receipt: {id: 'forged'}})};
    await assert.rejects(new LayaInterestDecisionService(injected, () => now)
      .choose(input, request()), /outside offered options/);
  }
});

test('async mutation and expiry cannot turn an old choice into a tracking decision', async () => {
  let clock = Date.now();
  const input = fixture(clock);
  const expires = Date.parse(input.scope.expiresAt);
  const service = new LayaInterestDecisionService(chooser('plan tracking', () => {
    input.scope.state = 'revoked';
    input.evidence[0].sourceRevision = 'forged';
    clock = expires + 1;
  }), () => clock);
  // Policy validity expires while the caller's independent operation lease is
  // still current. An expired operation lease is covered by the TIMEOUT tests.
  const result = await service.choose(input, {deadline: iso(expires + minute),
    signal: new AbortController().signal});
  assert.equal(result.policy.state, 'watch_public', 'caller mutation cannot alter captured policy');
  assert.equal(result.outcome, 'recheck');
  assert.equal(result.selected, undefined);
  assert.equal(result.receipt.evidence.some(ref => ref.sourceRevision === 'forged'), false);
  assert.equal(result.requiresHostRevalidation, true);
});

test('selection evaluates current time before offering choices and binds policy validity in digest', async () => {
  const now = Date.now();
  const input = fixture(now);
  const afterExpiry = Date.parse(input.scope.expiresAt) + 1;
  const stale = await new LayaInterestDecisionService(chooser('recheck evidence'), () => afterExpiry)
    .choose(input, {deadline: iso(now + 3 * 60 * minute), signal: new AbortController().signal});
  assert.equal(stale.policy.state, 'abstain');
  assert.equal(stale.options.some(option => option.id === 'track_public'), false);

  const fixed = {deadline: iso(now + 60 * minute), signal: new AbortController().signal};
  const first = await new LayaInterestDecisionService(chooser('plan tracking'), () => now)
    .choose(input, fixed);
  const same = await new LayaInterestDecisionService(chooser('plan tracking'), () => now)
    .choose(input, {...fixed, signal: new AbortController().signal});
  assert.equal(first.receipt.digest, same.receipt.digest);
  const changed = await new LayaInterestDecisionService(chooser('plan tracking'), () => now)
    .choose({...input, scope: {...input.scope, expiresAt: iso(now + 61 * minute)}},
      {...fixed, signal: new AbortController().signal});
  assert.notEqual(first.receipt.digest, changed.receipt.digest);
});

test('interest receipt digest keeps exact refs stable across portable locale ordering', () => {
  const now = Date.now(), input = fixture(now);
  input.evidence[0].id = 'ä-question';
  input.evidence[1].id = 'z-followup';
  input.evidence[1].relatedEvidenceId = 'ä-question';
  const deadline = iso(now + 60 * minute);
  // Isolated explicit Collators make this check portable without assuming
  // a host adopts LC_ALL or changing the parent process's locale behavior.
  const worker = `
    import {LayaActionChoiceService,LayaInterestDecisionService} from '@personal-agent/cognition';
    const [locale,inputText,timeText,deadline]=process.argv.slice(1),collator=new Intl.Collator(locale);
    String.prototype.localeCompare=function(other){return collator.compare(String(this),other);};
    const input=JSON.parse(inputText),now=Number(timeText);
    const chooser=new LayaActionChoiceService({infer:async payload=>{
      const ids=Object.keys(payload.questions.action.criteria),selected=ids.find(id=>JSON.parse(payload.questions.action.criteria[id]).description.includes('plan tracking'));
      return {answers:{action:{choice:selected,probabilities:Object.fromEntries(ids.map(id=>[id,id===selected?0.9:0.1/(ids.length-1)])),answer_confidence:0.9,confidence:0.5}}};
    }});
    const result=await new LayaInterestDecisionService(chooser,()=>now).choose(input,{deadline,signal:new AbortController().signal});
    console.log(JSON.stringify(result));
  `;
  const run = (locale, value = input) => JSON.parse(execFileSync(process.execPath,
    ['--input-type=module', '-e', worker, locale, JSON.stringify(value), String(now), deadline],
    {cwd: fileURLToPath(new URL('../../../', import.meta.url)), encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe']}).trim());
  const first = run('en-US'), second = run('sv-SE');
  assert.equal(first.receipt.digest, second.receipt.digest,
    'Same exact evidence and binding retain their digest regardless of process locale');
  assert.deepEqual(second, first, 'Policy, options, freshness, chosen approach and model receipt stay intact');
  assert.deepEqual(first.receipt.evidence.map(ref => ref.id), ['z-followup', 'ä-question']);
  for (const changed of [
    {...input, scope: {...input.scope, revision: input.scope.revision + 1}},
    {...input, source: {...input.source, revision: 'source-v2'}},
    {...input, evidence: input.evidence.map(ref => ({...ref, sourceRevision: 'r2'}))},
    {...input, evidence: input.evidence.map(ref => ({...ref,
      id: ref.id === 'ä-question' ? 'new-question' : ref.id,
      ...(ref.relatedEvidenceId ? {relatedEvidenceId: 'new-question'} : {})}))},
  ]) {
    const revised = run('sv-SE', changed);
    assert.notEqual(revised.receipt.digest, first.receipt.digest,
      'A changed exact scope, source or evidence ref is a new binding');
  }
});

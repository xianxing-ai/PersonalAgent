import test from 'node:test';
import assert from 'node:assert/strict';
import {Worker} from 'node:worker_threads';
import {
  MailTriagePipeline,
  DEFAULT_MAIL_LABELS,
  CognitionError,
  LayaTriageService,
  prepareTriageDispatch,
} from '../dist/index.js';

test('failed checkpoint loads publish no prefix after trusted replacement', async t => {
  for (const failure of ['invalid', 'clone']) for (const replacement of ['empty', 'valid']) {
    await t.test(`${failure} row, ${replacement} replacement`, async () => {
      const labels = {work: 'Synthetic work', news: 'Synthetic news'};
      const messages = ['removed', 'retained', 'new'].map(messageId => ({source: 'synthetic-mail',
        messageId, sourceRevision: 'r1', text: `Synthetic work update ${messageId}`}));
      const inference = createMockInference();
      let saved = {};
      const checkpoint = {load: () => saved, save: value => {saved = structuredClone(value);}};
      const request = selected => ({messages: selected, deadline: new Date(Date.now() + 10000).toISOString(),
        signal: new AbortController().signal});
      await new MailTriagePipeline({inference, labels, checkpoint}).processBatch(request(messages.slice(0, 2)));
      const original = structuredClone(saved), entries = Object.entries(original);
      const removed = entries.find(([, value]) => value.messageId === 'removed');
      const retained = entries.find(([, value]) => value.messageId === 'retained');
      saved = {[removed[0]]: removed[1], invalid: failure === 'invalid' ? null
        : {...retained[1], syntheticUncloneable: () => {}}};
      const invalid = saved, callsBeforeFailure = inference.calls.length;
      const pipeline = new MailTriagePipeline({inference, labels, checkpoint});
      await assert.rejects(pipeline.processBatch(request([messages[0]])),
        error => failure === 'invalid' ? error.code === 'INVALID_ARGUMENT' : error.name === 'DataCloneError');
      assert.equal(saved, invalid);
      assert.deepEqual(saved[removed[0]], original[removed[0]]);
      assert.equal(inference.calls.length, callsBeforeFailure);
      saved = replacement === 'empty' ? {} : {[retained[0]]: structuredClone(retained[1])};
      const next = await pipeline.processBatch(request([messages[2]]));
      assert.equal(next.newlyClassifiedCount, 1);
      assert.equal(Object.hasOwn(saved, removed[0]), false);
      assert.equal(Object.keys(saved).length, replacement === 'empty' ? 1 : 2);
      if (replacement === 'valid') {
        assert.deepEqual(saved[retained[0]], original[retained[0]]);
        const calls = inference.calls.length;
        const replay = await pipeline.processBatch(request([messages[1]]));
        assert.equal(replay.cachedCount, 1);
        assert.equal(inference.calls.length, calls);
        assert.doesNotThrow(() => prepareTriageDispatch({namespace: 'synthetic/staged-load', messages: [messages[1]], labels,
          results: replay.results}));
      }
      const calls = inference.calls.length, durable = structuredClone(saved);
      const restart = await new MailTriagePipeline({inference, labels, checkpoint}).processBatch(request([messages[2]]));
      assert.equal(restart.cachedCount, 1);
      assert.equal(inference.calls.length, calls);
      assert.deepEqual(saved, durable);
      assert.doesNotThrow(() => prepareTriageDispatch({namespace: 'synthetic/staged-load', messages: [messages[2]], labels,
        results: restart.results}));
    });
  }
});

test('checkpoint receipts bind the exact label order accepted by public triage dispatch', async () => {
  const labels = {work: 'Synthetic work', news: 'Synthetic news'};
  const reordered = {news: 'Synthetic news', work: 'Synthetic work'};
  const messages = [{source: 'synthetic-mail', messageId: 'label-order',
    sourceRevision: 'rev1', text: 'Synthetic routine work update'}];
  let saved = {};
  const checkpoint = {load: () => saved, save: value => {saved = structuredClone(value);}};
  const inference = createMockInference();
  const classify = currentLabels => new MailTriagePipeline({inference, labels: currentLabels, checkpoint})
    .processBatch({messages, deadline: new Date(Date.now() + 10000).toISOString(),
      signal: new AbortController().signal});
  const dispatch = (currentLabels, result) => prepareTriageDispatch({namespace: 'synthetic/order',
    messages, labels: currentLabels, results: result.results});
  const first = await classify(labels);
  assert.equal(dispatch(labels, first).groups.length, 1);
  const sameOrder = await classify(labels);
  assert.equal(sameOrder.cachedCount, 1);
  assert.equal(inference.calls.length, 1);
  assert.deepEqual(sameOrder.results, first.results);
  assert.deepEqual(dispatch(labels, sameOrder), dispatch(labels, first));
  const changedOrder = await classify(reordered);
  assert.doesNotThrow(() => dispatch(reordered, changedOrder));
  assert.equal(changedOrder.newlyClassifiedCount, 1);
  assert.equal(changedOrder.cachedCount, 0);
  assert.equal(inference.calls.length, 2);
  assert.deepEqual(changedOrder.results[0].receipt.candidateLabels, Object.keys(reordered));
  assert.notEqual(changedOrder.results[0].receipt.criteriaDigest, first.results[0].receipt.criteriaDigest);
  assert.throws(() => dispatch(reordered, first), /Invalid local triage dispatch/);
  const restarted = await classify(reordered);
  assert.equal(restarted.cachedCount, 1);
  assert.equal(inference.calls.length, 2);
  assert.deepEqual(restarted.results, changedOrder.results);
  assert.deepEqual(dispatch(reordered, restarted), dispatch(reordered, changedOrder));
  const restoredOrder = await classify(labels);
  assert.equal(restoredOrder.cachedCount, 1);
  assert.equal(inference.calls.length, 2);
  assert.deepEqual(restoredOrder.results, first.results);
  assert.equal(Object.keys(saved).length, 2);
});

test('interrupted pipeline receipts remain valid deferred inputs to public triage dispatch', async t => {
  for (const reason of ['cancelled', 'deadline']) for (const highImpact of [false, true]) {
    await t.test(`${reason}, trusted high impact ${highImpact}`, async () => {
      const labels = {work: 'Synthetic work', news: 'Synthetic news'};
      const messages = [0, 1].map(index => ({source: 'synthetic-mail', messageId: `interrupted-${index}`,
        sourceRevision: 'rev1', text: `Synthetic work update ${index}`,
        ...(index === 1 ? {highImpact} : {})}));
      const controller = new AbortController(), inference = createMockInference();
      let saved = {}, clock = Date.now();
      const deadline = new Date(clock + 10000).toISOString();
      const checkpoint = {load: () => saved, save: value => {saved = structuredClone(value);}};
      const pipeline = new MailTriagePipeline({inference, labels, checkpoint, chunkSize: 1, now: () => clock});
      const result = await pipeline.processBatch({messages, deadline, signal: controller.signal,
        onProgress: progress => {if (progress.processedCount === 1) {
          if (reason === 'cancelled') controller.abort();
          else clock = Date.parse(deadline);
        }}});
      assert.deepEqual(result.results.map(item => item.reason), ['classified', reason]);
      assert.equal(inference.calls.length, 1);
      const original = structuredClone(saved);
      assert.equal(Object.keys(original).length, 1);
      const dispatchInput = {namespace: 'synthetic/interrupted', messages, labels, results: result.results};
      assert.doesNotThrow(() => prepareTriageDispatch(dispatchInput));
      const deferred = prepareTriageDispatch(dispatchInput).deferred;
      assert.equal(deferred.length, 1);
      assert.equal(deferred[0].reason, reason);
      assert.equal(deferred[0].requiredRoute, highImpact ? 'main_agent' : 'review');
      const direct = await new LayaTriageService(inference).classify({messages: [messages[1]], labels,
        deadline: reason === 'deadline' ? new Date(Date.now() - 1).toISOString() : deadline,
        signal: controller.signal});
      assert.deepEqual(result.results[1].receipt, direct[0].receipt);
      assert.equal(inference.calls.length, 1);
      const forged = structuredClone(result.results);
      forged[1].receipt.id = '0'.repeat(64);
      assert.throws(() => prepareTriageDispatch({...dispatchInput, results: forged}), /Invalid local triage dispatch/);
      const resumed = await new MailTriagePipeline({inference, labels, checkpoint, chunkSize: 1})
        .processBatch({messages, deadline: new Date(Date.now() + 10000).toISOString(), signal: new AbortController().signal});
      assert.equal(resumed.cachedCount, 1);
      assert.equal(resumed.newlyClassifiedCount, 1);
      assert.equal(inference.calls.length, 2);
      assert.doesNotThrow(() => prepareTriageDispatch({...dispatchInput, results: resumed.results}));
      for (const [key, value] of Object.entries(original)) assert.deepEqual(saved[key], value);
      assert.equal(Object.keys(saved).length, 2);
    });
  }
});

test('cached host-only high impact is classified afresh when the current trusted flag is absent', async t => {
  for (const highImpact of [false, undefined]) await t.test(`current flag ${highImpact}`, async () => {
    const labels = {work: 'Synthetic work', news: 'Synthetic news'}, inference = createMockInference();
    let saved = {};
    const checkpoint = {load: () => saved, save: value => {saved = structuredClone(value);}};
    const base = {source: 'synthetic-mail', messageId: 'host-impact', sourceRevision: 'r1', text: 'Synthetic work update'};
    const run = async flag => {
      const message = {...base, ...(flag === undefined ? {} : {highImpact: flag})};
      const result = await new MailTriagePipeline({inference, labels, checkpoint}).processBatch({messages: [message],
        deadline: new Date(Date.now() + 10000).toISOString(), signal: new AbortController().signal});
      return {result, input: {namespace: 'synthetic/host-impact', messages: [message], labels, results: result.results}};
    };
    const first = await run(true);
    assert.equal(prepareTriageDispatch(first.input).mainAgent.length, 1);
    const changed = await run(highImpact);
    assert.doesNotThrow(() => prepareTriageDispatch(changed.input));
    assert.equal(changed.result.cachedCount, 0);
    assert.equal(changed.result.newlyClassifiedCount, 1);
    assert.equal(prepareTriageDispatch(changed.input).groups.length, 1);
    assert.equal(inference.calls.length, 2);
    assert.deepEqual(changed.result.results[0].receipt, first.result.results[0].receipt);
    const replay = await run(highImpact === undefined ? false : undefined);
    assert.equal(replay.result.cachedCount, 1);
    assert.deepEqual(replay.result.results, changed.result.results);
    assert.doesNotThrow(() => prepareTriageDispatch(replay.input));
    const promoted = await run(true);
    assert.equal(promoted.result.cachedCount, 1);
    assert.equal(prepareTriageDispatch(promoted.input).mainAgent.length, 1);
    assert.deepEqual((await run(highImpact)).result.results, changed.result.results);
    assert.equal(inference.calls.length, 2);
    assert.equal(Object.keys(saved).length, 1);
  });
});

test('blank cached inputs preserve insufficient input and the current required route without inference', async t => {
  for (const [prior, current] of [[true, true], [true, false], [true, undefined], [false, true]]) {
    await t.test(`trusted flag ${prior} to ${current}`, async () => {
      const labels = {work: 'Synthetic work', news: 'Synthetic news'}, inference = createMockInference();
      let saved = {};
      const checkpoint = {load: () => saved, save: value => {saved = structuredClone(value);}};
      const run = async flag => {
        const message = {source: 'synthetic-mail', messageId: 'blank-impact', sourceRevision: 'r1', text: '  ',
          ...(flag === undefined ? {} : {highImpact: flag})};
        const result = await new MailTriagePipeline({inference, labels, checkpoint}).processBatch({messages: [message],
          deadline: new Date(Date.now() + 10000).toISOString(), signal: new AbortController().signal});
        return {result, input: {namespace: 'synthetic/blank-impact', messages: [message], labels, results: result.results}};
      };
      const first = await run(prior), original = structuredClone(saved);
      assert.equal(prepareTriageDispatch(first.input).deferred.length, 1);
      for (let attempt = 0; attempt < 2; attempt++) {
        const replay = await run(current);
        assert.doesNotThrow(() => prepareTriageDispatch(replay.input));
        const deferred = prepareTriageDispatch(replay.input).deferred;
        assert.equal(deferred[0].reason, 'insufficient_input');
        assert.equal(deferred[0].requiredRoute, current === true ? 'main_agent' : 'review');
        assert.equal(replay.result.cachedCount, 1);
        assert.deepEqual(replay.result.results[0].receipt, first.result.results[0].receipt);
      }
      assert.equal(inference.calls.length, 0);
      assert.deepEqual(saved, original);
    });
  }
});

test('a failed host-impact refresh retains the old checkpoint and only returns deferred work', async () => {
  const labels = {work: 'Synthetic work', news: 'Synthetic news'}, inference = createMockInference();
  let saved = {};
  const checkpoint = {load: () => saved, save: value => {saved = structuredClone(value);}};
  const message = {source: 'synthetic-mail', messageId: 'impact-failure', sourceRevision: 'r1', text: 'Synthetic work update'};
  const context = () => ({deadline: new Date(Date.now() + 10000).toISOString(), signal: new AbortController().signal});
  await new MailTriagePipeline({inference, labels, checkpoint}).processBatch({messages: [{...message, highImpact: true}], ...context()});
  const original = structuredClone(saved);
  let calls = 0;
  const result = await new MailTriagePipeline({inference: {infer: async () => {calls++; throw Error('Synthetic unavailable');}}, labels, checkpoint})
    .processBatch({messages: [message], ...context()});
  const dispatch = prepareTriageDispatch({namespace: 'synthetic/impact-failure', messages: [message], labels, results: result.results});
  assert.equal(calls, 1);
  assert.equal(result.cachedCount, 0);
  assert.equal(dispatch.deferred[0].reason, 'unavailable');
  assert.deepEqual(saved, original);
});

test('model high impact and meeting categories retain their cached main-agent route', async t => {
  for (const meeting of [false, true]) await t.test(`meeting category ${meeting}`, async () => {
    const labels = meeting ? {meeting: 'Synthetic meeting', news: 'Synthetic news'}
      : {work: 'Synthetic work', news: 'Synthetic news'};
    const inference = createMockInference({forceHighImpact: !meeting});
    let saved = {};
    const checkpoint = {load: () => saved, save: value => {saved = structuredClone(value);}};
    const base = {source: 'synthetic-mail', messageId: 'model-impact', sourceRevision: 'r1', text: 'Synthetic work update'};
    let first;
    for (const highImpact of [true, false, undefined]) {
      const message = {...base, ...(highImpact === undefined ? {} : {highImpact})};
      const result = await new MailTriagePipeline({inference, labels, checkpoint}).processBatch({messages: [message],
        deadline: new Date(Date.now() + 10000).toISOString(), signal: new AbortController().signal});
      assert.equal(prepareTriageDispatch({namespace: 'synthetic/model-impact', messages: [message], labels, results: result.results}).mainAgent.length, 1);
      if (first) {assert.equal(result.cachedCount, 1); assert.deepEqual(result.results, first.results);}
      else first = result;
    }
    assert.equal(inference.calls.length, 1);
  });
});

test('legal mixed-case labels reuse their exact checkpoint across portable locale ordering', async () => {
  const moduleUrl = new URL('../dist/index.js', import.meta.url).href;
  const run = (locale, checkpoint = {}) => new Promise((resolve, reject) => {
    const worker = new Worker(`
      const {parentPort,workerData}=require('node:worker_threads');
      (async()=>{
        const {MailTriagePipeline}=await import(workerData.moduleUrl);
        const collator=new Intl.Collator(workerData.locale);
        String.prototype.localeCompare=function(other){return collator.compare(String(this),String(other));};
        let saved=workerData.checkpoint,calls=0;
        const labels={'i-work':'Synthetic lower-case category','I-work':'Synthetic upper-case category'};
        const inference={async infer(payload){calls++;const answers={};
          for(const [key,question] of Object.entries(payload.questions)) {
            const choice=key.startsWith('category_')?'i-work':'routine';
            answers[key]={choice,probabilities:Object.fromEntries(Object.keys(question.criteria).map(id=>[id,id===choice?0.9:0.1])),answer_confidence:0.9,confidence:0.7};
          } return {answers};}};
        const pipeline=new MailTriagePipeline({inference,labels,checkpoint:{load:()=>saved,save:value=>{saved=structuredClone(value);}}});
        const result=await pipeline.processBatch({messages:[{source:'synthetic-mail',messageId:'mixed-case',sourceRevision:'rev1',text:'Synthetic routine work update'}],
          deadline:new Date(Date.now()+10000).toISOString(),signal:new AbortController().signal});
        parentPort.postMessage({calls,saved,cachedCount:result.cachedCount,newlyClassifiedCount:result.newlyClassifiedCount,results:result.results});
      })().catch(error=>{throw error;});
    `, {eval: true, workerData: {moduleUrl, locale, checkpoint}});
    worker.once('error', reject); worker.once('message', resolve);
    worker.once('exit', code => {if (code) reject(Error(`Synthetic locale worker exited ${code}`));});
  });
  const first = await run('en-US');
  assert.equal(first.calls, 1); assert.equal(first.newlyClassifiedCount, 1);
  const resumed = await run('tr-TR', first.saved);
  assert.equal(resumed.calls, 0); assert.equal(resumed.cachedCount, 1); assert.equal(resumed.newlyClassifiedCount, 0);
  assert.deepEqual(resumed.saved, first.saved); assert.deepEqual(resumed.results, first.results);
});

test('partial page cancellation retains the prior cursor and resumes completed chunks from checkpoint', async () => {
  let saved = {};
  const checkpoint = {load: () => saved, save: value => {saved = structuredClone(value);}};
  const inference = createMockInference();
  const pipeline = new MailTriagePipeline({inference, checkpoint, chunkSize: 2});
  const controller = new AbortController();
  const messages = Array.from({length: 4}, (_, i) => ({source: 'mail', messageId: `partial-${i}`,
    sourceRevision: '1', text: `Work task ${i}`}));
  const cursor = {uidValidity: 1, lastUid: 10};
  let acknowledged = 0;
  const request = {initialCursor: cursor, fetchPage: async () => ({messages,
    nextCursor: {uidValidity: 1, lastUid: 14}, hasMore: false}),
    onPageCompleted: () => {acknowledged++;}, deadline: new Date(Date.now() + 60_000).toISOString()};
  const partial = await pipeline.processPagedStream({...request, signal: controller.signal,
    onProgress: progress => {if (progress.processedCount === 2) controller.abort();}});
  assert.deepEqual(partial.lastCursor, cursor);
  assert.equal(partial.stoppedReason, 'cancelled');
  assert.equal(partial.pagesProcessed, 0);
  assert.equal(acknowledged, 0);
  assert.equal(Object.keys(saved).length, 2);
  const resumed = await new MailTriagePipeline({inference, checkpoint, chunkSize: 2})
    .processPagedStream({...request, signal: new AbortController().signal});
  assert.equal(resumed.cachedCount, 2);
  assert.equal(resumed.newlyClassifiedCount, 2);
  assert.equal(resumed.stoppedReason, 'completed');
  assert.equal(acknowledged, 1);
});

test('unavailable page is not acknowledged and concurrent batches preserve both checkpoints', async () => {
  const failed = new MailTriagePipeline({inference: {infer: async () => {throw Error('offline');}}});
  const messages = [{source: 'mail', messageId: 'unavailable', sourceRevision: '1', text: 'Work update'}];
  let ack = false;
  const result = await failed.processPagedStream({fetchPage: async () => ({messages,
    nextCursor: {uidValidity: 1, lastUid: 1}, hasMore: false}),
    onPageCompleted: () => {ack = true;}, signal: new AbortController().signal,
    deadline: new Date(Date.now() + 60_000).toISOString()});
  assert.equal(result.stoppedReason, 'classification_unavailable');
  assert.equal(result.lastCursor, undefined);
  assert.equal(ack, false);
  let saved = {};
  const pipeline = new MailTriagePipeline({inference: createMockInference(),
    checkpoint: {load: () => saved, save: async value => {await Promise.resolve(); saved = value;}}});
  await Promise.all(['a', 'b'].map(messageId => pipeline.processBatch({
    messages: [{...messages[0], messageId}], signal: new AbortController().signal,
    deadline: new Date(Date.now() + 60_000).toISOString()})));
  assert.equal(Object.keys(saved).length, 2);
});

test('missing classification records cannot acknowledge a source page', async () => {
  const pipeline = new MailTriagePipeline({classifier: {classify: async () => []}});
  await assert.rejects(pipeline.processPagedStream({
    fetchPage: async () => ({messages: [{source: 'mail', messageId: 'missing', sourceRevision: '1', text: 'work'}],
      hasMore: false, nextCursor: {uidValidity: 1, lastUid: 1}}),
    onPageCompleted: () => assert.fail('Incomplete classification must not advance the page'),
    deadline: new Date(Date.now() + 60_000).toISOString(), signal: new AbortController().signal,
  }), error => error.code === 'INVALID_ARGUMENT');
});

test('invalid model response is retryable and never becomes a durable classification', async () => {
  let calls = 0, saved = {};
  const pipeline = new MailTriagePipeline({inference: {infer: async () => {calls++; return {answers: {}};}},
    checkpoint: {load: () => saved, save: value => {saved = value;}}});
  for (let attempt = 0; attempt < 2; attempt++) {
    const result = await pipeline.processPagedStream({
      fetchPage: async () => ({messages: [{source: 'mail', messageId: 'bad-response', sourceRevision: '1', text: 'work'}],
        hasMore: false, nextCursor: {uidValidity: 1, lastUid: 1}}),
      onPageCompleted: () => assert.fail('Invalid model output must not confirm a page'),
      deadline: new Date(Date.now() + 60_000).toISOString(), signal: new AbortController().signal,
    });
    assert.equal(result.stoppedReason, 'classification_unavailable');
    assert.equal(result.cachedCount, 0);
    assert.equal(result.results[0].reason, 'invalid_response');
  }
  assert.equal(calls, 2);
  assert.equal(Object.keys(saved).length, 0);
});

function createMockInference(options = {}) {
  const calls = [];
  const inference = {
    async infer(payload) {
      calls.push(payload);
      const answers = {};
      for (const [key, q] of Object.entries(payload.questions)) {
        if (key.startsWith('category_')) {
          const criteria = payload.questions[key]?.criteria ?? {};
          const keys = Object.keys(criteria);
          const choice = keys.includes('work') ? 'work' : keys[0];
          const probs = {};
          const otherProb = keys.length > 1 ? Number(((0.15 / (keys.length - 1))).toFixed(4)) : 0;
          for (const k of keys) {
            probs[k] = k === choice ? 0.85 : otherProb;
          }
          const sum = Object.values(probs).reduce((a, b) => a + b, 0);
          probs[choice] = Number((probs[choice] + (1.0 - sum)).toFixed(4));
          answers[key] = {
            choice,
            probabilities: probs,
            answer_confidence: probs[choice],
            confidence: 0.6,
          };
        } else if (key.startsWith('impact_')) {
          const idx = key.replace('impact_', '');
          const event = payload.state.events[Number(idx)];
          const isHigh = event?.observation?.includes('URGENT') || options.forceHighImpact;
          answers[key] = {
            choice: isHigh ? 'high_impact' : 'routine',
            probabilities: {
              routine: isHigh ? 0.1 : 0.9,
              high_impact: isHigh ? 0.9 : 0.1,
            },
            answer_confidence: 0.9,
            confidence: 0.7,
          };
        }
      }
      return {answers};
    },
    calls,
  };
  return inference;
}

test('constructor and classifier label views cannot change the cache configuration identity', async () => {
  const original = {work: 'Work', personal: 'Personal'}, labels = {...original};
  const inference = createMockInference(), service = new LayaTriageService(inference);
  let saved = {}, retainedLabels;
  const classifier = {classify: async request => {
    retainedLabels = request.labels;
    return service.classify(request);
  }};
  const checkpoint = {load: () => saved, save: value => {saved = value;}};
  const pipeline = new MailTriagePipeline({classifier, labels, checkpoint});
  delete labels.work;
  labels.meeting = 'Meeting';
  const request = {messages: [{source: 'mail', messageId: 'fixed-labels', sourceRevision: '1', text: 'Work update'}],
    deadline: new Date(Date.now() + 60_000).toISOString(), signal: new AbortController().signal};
  const first = await pipeline.processBatch(request);
  assert.equal(first.results[0].label, 'work');
  assert.deepEqual(first.results[0].receipt.candidateLabels, Object.keys(original));
  delete retainedLabels.work;
  retainedLabels.meeting = 'Meeting';
  let liveCalls = 0;
  classifier.classify = async next => {liveCalls++; return service.classify(next);};
  const second = await pipeline.processBatch({...request, messages: [{...request.messages[0], messageId: 'next'}]});
  assert.equal(second.results[0].label, 'work');
  assert.deepEqual(second.results[0].receipt.candidateLabels, Object.keys(original));
  assert.equal(liveCalls, 1);
  const replay = await new MailTriagePipeline({inference, labels: original, checkpoint}).processBatch(request);
  assert.equal(replay.cachedCount, 1);
  assert.deepEqual(replay.results, first.results);
  assert.equal(inference.calls.length, 2);
});

test('queued batches bind submitted message content and identity before checkpoint loading', async () => {
  let entered, release, saved;
  const started = new Promise(resolve => {entered = resolve;});
  const loading = new Promise(resolve => {release = resolve;});
  const inference = createMockInference();
  const pipeline = new MailTriagePipeline({inference, checkpoint: {async load() {
    entered(); await loading; return {};
  }, save: value => {saved = value;}}});
  const message = {source: 'mail', messageId: 'submitted', sourceRevision: '1', text: 'URGENT meeting moved', highImpact: true};
  const submitted = {...message};
  const request = {messages: [message], signal: new AbortController().signal,
    deadline: new Date(Date.now() + 60_000).toISOString()};
  const pending = pipeline.processBatch(request);
  await started;
  message.messageId = 'replacement'; message.text = 'Routine update'; message.highImpact = false;
  request.messages = [{...message}];
  release();
  const result = await pending;
  assert.equal(result.results[0].messageId, submitted.messageId);
  assert.equal(result.highImpactCount, 1);
  assert.equal(inference.calls[0].state.events[0].observation, submitted.text);
  assert.equal(Object.values(saved)[0].messageId, submitted.messageId);
});

test('queued batches retain the original cancellation signal and deadline after checkpoint awaits', async () => {
  for (const mode of ['cancelled', 'deadline']) {
    let entered, release, clock = Date.now(), saved;
    const started = new Promise(resolve => {entered = resolve;});
    const loading = new Promise(resolve => {release = resolve;});
    const inference = createMockInference(), controller = new AbortController();
    const pipeline = new MailTriagePipeline({inference, now: () => clock, checkpoint: {async load() {
      entered(); await loading; return {};
    }, save: value => {saved = value;}}});
    const request = {messages: [{source: 'mail', messageId: 'lease', sourceRevision: '1', text: 'Work update'}],
      signal: controller.signal, deadline: new Date(clock + 60_000).toISOString()};
    const pending = pipeline.processBatch(request);
    await started;
    if (mode === 'cancelled') {controller.abort(); request.signal = new AbortController().signal;}
    else {clock = Date.parse(request.deadline); request.deadline = new Date(clock + 60_000).toISOString();}
    release();
    const result = await pending;
    assert.equal(result.results[0].reason, mode);
    assert.equal(result.newlyClassifiedCount, 0);
    assert.equal(inference.calls.length, 0);
    assert.equal(saved, undefined);
  }
});

test('classifier input mutation cannot redefine the private submitted message identity', async () => {
  const service = new LayaTriageService(createMockInference());
  let saves = 0;
  const pipeline = new MailTriagePipeline({classifier: {classify: request => {
    request.messages[0].messageId = 'forged'; request.messages[0].text = 'Replaced input';
    return service.classify(request);
  }}, checkpoint: {load: () => ({}), save: () => {saves++;}}});
  const request = {messages: [{source: 'mail', messageId: 'original', sourceRevision: '1', text: 'Work update'}],
    signal: new AbortController().signal, deadline: new Date(Date.now() + 60_000).toISOString()};
  await assert.rejects(pipeline.processBatch(request), error => error.code === 'INVALID_ARGUMENT');
  assert.equal(saves, 0);
  assert.equal(request.messages[0].messageId, 'original');
  assert.equal(request.messages[0].text, 'Work update');
});

test('in-batch conflicting content is rejected before inference or checkpoint save', async () => {
  const inference = createMockInference(); let saves = 0;
  const pipeline = new MailTriagePipeline({inference, checkpoint: {load: () => ({}), save: () => {saves++;}}});
  const message = {source: 'mail', messageId: 'conflict', sourceRevision: '1', text: 'Routine update'};
  await assert.rejects(pipeline.processBatch({messages: [message, {...message, text: 'URGENT meeting moved', highImpact: true}],
    signal: new AbortController().signal, deadline: new Date(Date.now() + 60_000).toISOString()}),
    error => error.code === 'INVALID_ARGUMENT');
  assert.equal(inference.calls.length, 0);
  assert.equal(saves, 0);
});

test('exact duplicates merge trusted high-impact hints and later flags require fresh classification', async () => {
  for (const hints of [[false, true, false], [true, false, true]]) {
    const inference = createMockInference(), pipeline = new MailTriagePipeline({inference});
    const message = {source: 'mail', messageId: 'risk-merge', sourceRevision: '1', text: 'Work update'};
    const request = {messages: hints.map(highImpact => ({...message, highImpact})),
      signal: new AbortController().signal, deadline: new Date(Date.now() + 60_000).toISOString()};
    const result = await pipeline.processBatch(request);
    assert.equal(result.total, 1);
    assert.equal(result.highImpactCount, 1);
    assert.equal(result.results[0].route, 'main_agent');
    const replay = await pipeline.processBatch({...request, messages: [{...message, highImpact: false}]});
    assert.equal(replay.highImpactCount, 0);
    assert.equal(replay.cachedCount, 0);
    assert.equal(inference.calls.length, 2);
    assert.equal(prepareTriageDispatch({namespace: 'synthetic/risk-merge',
      messages: [{...message, highImpact: false}], labels: DEFAULT_MAIL_LABELS, results: replay.results}).groups.length, 1);
    const repeated = await pipeline.processBatch({...request, messages: [{...message, highImpact: false}]});
    assert.equal(repeated.cachedCount, 1);
    assert.deepEqual(repeated.results, replay.results);
    assert.equal(inference.calls.length, 2);
  }
});

test('trusted hints elevate only the current cached view and invalid hints never bypass validation', async () => {
  const inference = createMockInference(); let saved, saves = 0;
  const pipeline = new MailTriagePipeline({inference, checkpoint: {load: () => ({}), save: value => {saved = value; saves++;}}});
  const message = {source: 'mail', messageId: 'cached-risk', sourceRevision: '1', text: 'Work update'};
  const request = {messages: [message], signal: new AbortController().signal,
    deadline: new Date(Date.now() + 60_000).toISOString()};
  const first = await pipeline.processBatch(request), original = structuredClone(first.results[0]), checkpoint = structuredClone(saved);
  assert.equal(original.route, 'group');
  const elevated = await pipeline.processBatch({...request, messages: [{...message, highImpact: true}]});
  assert.deepEqual(elevated.results, [{...original, route: 'main_agent', reason: 'high_impact'}]);
  assert.equal(elevated.highImpactCount, 1);
  assert.equal(elevated.highImpactNotices.length, 1);
  assert.equal(elevated.cachedCount, 1);
  assert.equal(elevated.newlyClassifiedCount, 0);
  assert.deepEqual(saved, checkpoint);
  assert.deepEqual((await pipeline.processBatch(request)).results, [original]);
  for (const highImpact of ['true', 1, null]) {
    await assert.rejects(pipeline.processBatch({...request, messages: [{...message, highImpact}]}),
      error => error.code === 'INVALID_ARGUMENT');
  }
  assert.equal(saves, 1);
  assert.equal(inference.calls.length, 1);
});

test('batch deduplication preserves colon-containing identity tuples and still reuses exact duplicates', async () => {
  const inference=createMockInference(),pipeline=new MailTriagePipeline({inference});
  const distinct=[
    {source:'mail:one',messageId:'two',sourceRevision:'r1',text:'First work update'},
    {source:'mail',messageId:'one:two',sourceRevision:'r1',text:'Second work update'},
    {source:'mail',messageId:'one',sourceRevision:'two:r1',text:'Third work update'},
  ];
  const request={messages:[...distinct,{...distinct[0]}],
    deadline:new Date(Date.now()+60_000).toISOString(),signal:new AbortController().signal};
  const first=await pipeline.processBatch(request);
  assert.equal(first.total,3);assert.equal(first.newlyClassifiedCount,3);assert.equal(first.cachedCount,0);
  assert.deepEqual(first.results.map(({source,messageId,sourceRevision})=>[source,messageId,sourceRevision]),
    distinct.map(({source,messageId,sourceRevision})=>[source,messageId,sourceRevision]));
  assert.deepEqual(inference.calls[0].state.events.map(event=>event.observation),distinct.map(message=>message.text));
  const replay=await pipeline.processBatch(request);
  assert.equal(replay.total,3);assert.equal(replay.cachedCount,3);assert.equal(replay.newlyClassifiedCount,0);
  assert.equal(inference.calls.length,1);
});

test('returned and checkpoint-held receipts cannot rewrite cached high-impact routing', async () => {
  const inference=createMockInference({forceHighImpact:true});let saved={};
  const checkpoint={load:()=>saved,save:value=>{saved=value;}};
  const pipeline=new MailTriagePipeline({inference,checkpoint});
  const request={messages:[{source:'mail',messageId:'meeting',sourceRevision:'r1',text:'URGENT meeting moved'}],
    deadline:new Date(Date.now()+60_000).toISOString(),signal:new AbortController().signal};
  const first=await pipeline.processBatch(request),expected=structuredClone(first.results[0]);
  assert.equal(first.highImpactCount,1);
  first.results[0].route='group';first.results[0].reason='classified';
  first.results[0].receipt.candidateLabels[0]='forged-label';
  first.results[0].scores.probabilities.work=0;
  const replay=await pipeline.processBatch(request);
  assert.equal(replay.highImpactCount,1);assert.equal(replay.cachedCount,1);assert.equal(replay.newlyClassifiedCount,0);
  assert.deepEqual(replay.results,[expected]);assert.equal(replay.highImpactNotices.length,1);
  assert.deepEqual(Object.values(saved),[expected]);
  const restarted=new MailTriagePipeline({inference,checkpoint});
  assert.deepEqual((await restarted.processBatch(request)).results,[expected]);
  Object.values(saved)[0].route='group';Object.values(saved)[0].reason='classified';
  replay.results[0].route='review';
  const stillCached=await restarted.processBatch(request);
  assert.equal(stillCached.highImpactCount,1);assert.equal(stillCached.cachedCount,1);
  assert.deepEqual(stillCached.results,[expected]);assert.equal(inference.calls.length,1);
});

test('MailTriagePipeline processes messages in bounded chunks and deduplicates in-batch duplicates', async () => {
  const inference = createMockInference();
  const pipeline = new MailTriagePipeline({
    inference,
    chunkSize: 4,
  });

  const messages = [
    {source: 'mail:inbox', messageId: 'm1', sourceRevision: 'r1', text: 'URGENT: Contract review today'},
    {source: 'mail:inbox', messageId: 'm2', sourceRevision: 'r1', text: 'Weekly sync notes'},
    {source: 'mail:inbox', messageId: 'm2', sourceRevision: 'r1', text: 'Weekly sync notes'},
    {source: 'mail:inbox', messageId: 'm3', sourceRevision: 'r1', text: 'Status update 3'},
    {source: 'mail:inbox', messageId: 'm4', sourceRevision: 'r1', text: 'Status update 4'},
    {source: 'mail:inbox', messageId: 'm5', sourceRevision: 'r1', text: 'Status update 5'},
  ];

  const deadline = new Date(Date.now() + 60_000).toISOString();
  const summary = await pipeline.processBatch({
    messages,
    deadline,
    signal: new AbortController().signal,
  });

  // 6 input messages with 1 duplicate -> 5 unique messages processed
  assert.equal(summary.total, 5);
  assert.equal(summary.newlyClassifiedCount, 5);
  assert.equal(summary.cachedCount, 0);

  // High impact detected for message 1
  assert.equal(summary.highImpactCount, 1);
  assert.equal(summary.highImpactNotices.length, 1);
  assert.equal(summary.highImpactNotices[0].messageId, 'm1');

  // Pure model throughput calculation
  assert.ok(summary.throughput.messagesPerSecond > 0);
  assert.ok(summary.throughput.inferenceDurationMs >= 0);
});

test('MailTriagePipeline transactional checkpointing: save failure does not commit to memory cache', async () => {
  const inference = createMockInference();
  let shouldFailSave = true;
  const storage = {};

  const checkpoint = {
    load() {
      return {...storage};
    },
    async save(results) {
      if (shouldFailSave) {
        throw new Error('durable_storage_write_failure');
      }
      Object.assign(storage, results);
    },
  };

  const pipeline = new MailTriagePipeline({
    inference,
    checkpoint,
    chunkSize: 2,
  });

  const messages = [
    {source: 'mail', messageId: 'm1', sourceRevision: 'r1', text: 'Task 1'},
    {source: 'mail', messageId: 'm2', sourceRevision: 'r2', text: 'Task 2'},
  ];

  // First call fails at checkpoint.save
  await assert.rejects(
    async () => {
      await pipeline.processBatch({
        messages,
        deadline: new Date(Date.now() + 60_000).toISOString(),
        signal: new AbortController().signal,
      });
    },
    /durable_storage_write_failure/
  );

  // Storage should be empty
  assert.equal(Object.keys(storage).length, 0);

  // Now fix save, run again: messages should be classified and saved, not falsely hit in memory
  shouldFailSave = false;
  const summary = await pipeline.processBatch({
    messages,
    deadline: new Date(Date.now() + 60_000).toISOString(),
    signal: new AbortController().signal,
  });

  assert.equal(summary.total, 2);
  assert.equal(summary.newlyClassifiedCount, 2);
  assert.equal(Object.keys(storage).length, 2);

  // Subsequent call: both served from cache
  const summary2 = await pipeline.processBatch({
    messages,
    deadline: new Date(Date.now() + 60_000).toISOString(),
    signal: new AbortController().signal,
  });
  assert.equal(summary2.cachedCount, 2);
  assert.equal(summary2.newlyClassifiedCount, 0);
  // Pure model throughput when 0 newly classified messages should be 0
  assert.equal(summary2.throughput.messagesPerSecond, 0);
});

test('MailTriagePipeline config change produces different cache key', async () => {
  const inference = createMockInference();
  const storage = {};
  const checkpoint = {
    load: () => ({...storage}),
    save: (r) => { Object.assign(storage, r); },
  };

  const labels1 = {work: '工作事务', finance: '账单财务'};
  const pipeline1 = new MailTriagePipeline({
    inference,
    checkpoint,
    labels: labels1,
  });

  const msg = [{source: 'mail', messageId: 'm1', sourceRevision: 'r1', text: 'Invoice 101'}];
  await pipeline1.processBatch({
    messages: msg,
    deadline: new Date(Date.now() + 60_000).toISOString(),
    signal: new AbortController().signal,
  });
  assert.equal(inference.calls.length, 1);

  // Different label config: should NOT hit cache key of labels1
  const labels2 = {urgent_work: '紧急工作', promotional: '广告营销'};
  const pipeline2 = new MailTriagePipeline({
    inference,
    checkpoint,
    labels: labels2,
  });

  await pipeline2.processBatch({
    messages: msg,
    deadline: new Date(Date.now() + 60_000).toISOString(),
    signal: new AbortController().signal,
  });
  // Must make a new inference call because label configuration changed!
  assert.equal(inference.calls.length, 2);
});

test('MailTriagePipeline handles insufficient input and preserves candidateLabel on review', async () => {
  const inference = {
    async infer(payload) {
      const answers = {};
      for (const [key] of Object.entries(payload.questions)) {
        if (key.startsWith('category_')) {
          answers[key] = {
            choice: 'work',
            probabilities: {
              meeting: 0.10,
              work: 0.35,
              subscription: 0.15,
              transaction: 0.15,
              personal: 0.15,
              other: 0.10,
            },
            answer_confidence: 0.35,
            confidence: 0.3,
          };
        } else if (key.startsWith('impact_')) {
          answers[key] = {
            choice: 'routine',
            probabilities: {routine: 0.8, high_impact: 0.2},
            answer_confidence: 0.8,
            confidence: 0.6,
          };
        }
      }
      return {answers};
    },
  };

  const pipeline = new MailTriagePipeline({inference});
  const messages = [
    {source: 'mail', messageId: 'm-empty', sourceRevision: 'r1', text: '   '},
    {source: 'mail', messageId: 'm-uncertain', sourceRevision: 'r1', text: '下周随便聊聊'},
  ];

  const summary = await pipeline.processBatch({
    messages,
    deadline: new Date(Date.now() + 60_000).toISOString(),
    signal: new AbortController().signal,
  });

  assert.equal(summary.total, 2);
  assert.equal(summary.needsReviewCount, 2);
  assert.equal(summary.abstainedCount, 2);

  const emptyResult = summary.results.find(r => r.messageId === 'm-empty');
  assert.equal(emptyResult?.reason, 'insufficient_input');
  assert.equal(emptyResult?.label, null);
  assert.equal(emptyResult?.candidateLabel, null);

  const uncertainResult = summary.results.find(r => r.messageId === 'm-uncertain');
  assert.equal(uncertainResult?.reason, 'uncertain');
  assert.equal(uncertainResult?.label, null);
  assert.equal(uncertainResult?.candidateLabel, 'work');
});

test('MailTriagePipeline pre-filters all-blank chunk and never invokes model', async () => {
  let inferCalled = false;
  const inference = {
    async infer() {
      inferCalled = true;
      return {answers: {}};
    },
  };

  const pipeline = new MailTriagePipeline({inference});
  const blankMessages = [
    {source: 'mail', messageId: 'm-b1', sourceRevision: 'r1', text: ''},
    {source: 'mail', messageId: 'm-b2', sourceRevision: 'r1', text: '   \t\n  '},
  ];

  const summary = await pipeline.processBatch({
    messages: blankMessages,
    deadline: new Date(Date.now() + 60_000).toISOString(),
    signal: new AbortController().signal,
  });

  // Model must NOT be called for all-blank batch
  assert.equal(inferCalled, false);
  assert.equal(summary.total, 2);
  assert.equal(summary.abstainedCount, 2);
  assert.equal(summary.results[0].reason, 'insufficient_input');
  assert.equal(summary.results[0].label, null);
  assert.equal(summary.results[1].reason, 'insufficient_input');
  assert.equal(summary.results[1].label, null);
});

test('MailTriagePipeline configDigest differentiates minimumAnswerProbability thresholds', async () => {
  const inference = createMockInference();
  const storage = {};
  const checkpoint = {
    load: () => ({...storage}),
    save: (r) => { Object.assign(storage, r); },
  };

  const msg = [{source: 'mail', messageId: 'm-thresh', sourceRevision: 'r1', text: 'Quarterly financial report'}];

  // Pipeline with default 0.70 threshold
  const pipeline1 = new MailTriagePipeline({
    inference,
    checkpoint,
    minimumAnswerProbability: 0.70,
  });

  await pipeline1.processBatch({
    messages: msg,
    deadline: new Date(Date.now() + 60_000).toISOString(),
    signal: new AbortController().signal,
  });
  assert.equal(inference.calls.length, 1);

  // Second pipeline with 0.85 threshold: config changed, so it must not reuse cache from 0.70
  const pipeline2 = new MailTriagePipeline({
    inference,
    checkpoint,
    minimumAnswerProbability: 0.85,
  });

  await pipeline2.processBatch({
    messages: msg,
    deadline: new Date(Date.now() + 60_000).toISOString(),
    signal: new AbortController().signal,
  });
  assert.equal(inference.calls.length, 2);
});

test('MailTriagePipeline processPagedStream consumes pages with backpressure, progress and resumption', async () => {
  const inference = createMockInference();
  const storage = {};
  const checkpoint = {
    load: () => ({...storage}),
    save: (r) => { Object.assign(storage, r); },
  };

  const pipeline = new MailTriagePipeline({
    inference,
    checkpoint,
    chunkSize: 2,
  });

  // 3 pages of 2 messages each
  const pagesData = [
    {
      messages: [
        {source: 'mail:inbox', messageId: 'p1-m1', sourceRevision: 'r1', text: 'Work deliverable 1'},
        {source: 'mail:inbox', messageId: 'p1-m2', sourceRevision: 'r1', text: 'URGENT: sync on delivery'},
      ],
      nextCursor: {uidValidity: 100, lastUid: 2},
      hasMore: true,
    },
    {
      messages: [
        {source: 'mail:inbox', messageId: 'p2-m1', sourceRevision: 'r1', text: 'Work deliverable 3'},
        {source: 'mail:inbox', messageId: 'p2-m2', sourceRevision: 'r1', text: 'Weekly newsletter 4'},
      ],
      nextCursor: {uidValidity: 100, lastUid: 4},
      hasMore: true,
    },
    {
      messages: [
        {source: 'mail:inbox', messageId: 'p3-m1', sourceRevision: 'r1', text: 'Final signoff 5'},
      ],
      nextCursor: {uidValidity: 100, lastUid: 5},
      hasMore: false,
    },
  ];

  let fetchCalls = 0;
  const progressUpdates = [];

  const summary = await pipeline.processPagedStream({
    async fetchPage(cursor) {
      const idx = cursor ? (cursor.lastUid === 2 ? 1 : 2) : 0;
      fetchCalls++;
      return pagesData[idx];
    },
    deadline: new Date(Date.now() + 60_000).toISOString(),
    signal: new AbortController().signal,
    onProgress(p) {
      progressUpdates.push({...p});
    },
  });

  assert.equal(fetchCalls, 3);
  assert.equal(summary.total, 5);
  assert.equal(summary.pagesProcessed, 3);
  assert.equal(summary.stoppedReason, 'completed');
  assert.equal(summary.hasMore, false);
  assert.equal(summary.lastCursor?.lastUid, 5);
  assert.ok(progressUpdates.length >= 3);
  assert.equal(progressUpdates[progressUpdates.length - 1].processedCount, 5);

  // Checkpoint contains all 5 records
  assert.equal(Object.keys(storage).length, 5);

  // Now simulate resuming: fetch page 1 again. All messages must be served from cache with ZERO new inference calls!
  const initialInferCalls = inference.calls.length;
  const resumedSummary = await pipeline.processPagedStream({
    async fetchPage() {
      return {
        messages: pagesData[0].messages,
        nextCursor: {uidValidity: 100, lastUid: 2},
        hasMore: false,
      };
    },
    deadline: new Date(Date.now() + 60_000).toISOString(),
    signal: new AbortController().signal,
  });

  assert.equal(resumedSummary.total, 2);
  assert.equal(resumedSummary.cachedCount, 2);
  assert.equal(resumedSummary.newlyClassifiedCount, 0);
  assert.equal(inference.calls.length, initialInferCalls); // Zero new inference calls on resumed data!
});

test('MailTriagePipeline processPagedStream stops immediately on cancellation without corrupting checkpoint', async () => {
  const inference = createMockInference();
  const storage = {};
  const checkpoint = {
    load: () => ({...storage}),
    save: (r) => { Object.assign(storage, r); },
  };

  const pipeline = new MailTriagePipeline({
    inference,
    checkpoint,
    chunkSize: 2,
  });

  const abortController = new AbortController();

  let fetchedPages = 0;
  const summary = await pipeline.processPagedStream({
    async fetchPage() {
      fetchedPages++;
      if (fetchedPages === 1) {
        return {
          messages: [
            {source: 'mail', messageId: 'c1', sourceRevision: 'r1', text: 'Task 1'},
            {source: 'mail', messageId: 'c2', sourceRevision: 'r1', text: 'Task 2'},
          ],
          nextCursor: {uidValidity: 1, lastUid: 2},
          hasMore: true,
        };
      }
      assert.fail('Should not fetch subsequent pages after cancellation');
    },
    onPageCompleted() {
      // Abort after first page finishes processing and saving
      abortController.abort();
    },
    deadline: new Date(Date.now() + 60_000).toISOString(),
    signal: abortController.signal,
  });

  assert.equal(fetchedPages, 1);
  assert.equal(summary.stoppedReason, 'cancelled');
  // First page was processed and saved
  assert.equal(Object.keys(storage).length, 2);
});

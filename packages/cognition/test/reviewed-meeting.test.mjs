import assert from 'node:assert/strict';
import {test} from 'node:test';
import {FakeCoordinationStoreHost} from '@personal-agent/goals/store';
import {InMemoryMeetingDecisionReceiptStore, ReviewedMeetingFactConsumer, buildMeetingRepairOptions,
  analyzeImpact, buildMinimalRepairCandidate, createCommittedMeetingProjectionReader, selectMeetingRepairScope, selectProjectedRepairScope} from '../dist/index.js';

const at='2026-09-30T08:00:00.000Z';
const ref=(id,revision=1)=>({id,revision});
function fixture(mixed=false) {
  const namespace='synthetic-meeting';
  const store=new FakeCoordinationStoreHost().provision(namespace);
  const append=(id,kind,summary,dependencies=[],sourceRef='calendar:synthetic')=>store.append(store.read().revision,
    {id,kind,summary,dependencies,sourceRef,sensitivity:'public',state:'active',reason:'public fixture',
      validFrom:'2026-01-01T00:00:00.000Z',validUntil:'2099-01-01T00:00:00.000Z'});
  append('meeting','fact','14:00');append('goal','goal','Attend meeting',[ref('meeting')]);
  append('plan','plan','Prepare at 13:00',[ref('goal')]);
  append('other','fact','Other source');append('other-goal','goal','Unrelated goal',[ref('other')]);
  append('other-plan','plan','Unrelated plan',[ref('other-goal')]);
  if(mixed) store.appendBatch(store.read().revision,['meeting','other'].map(id=>({id,kind:'fact',
    summary:id==='meeting'?'16:00':'Other source changed',dependencies:[],sourceRef:'calendar:synthetic',
    sensitivity:'public',state:'active',reason:'public fixture',validFrom:'2026-01-01T00:00:00.000Z',validUntil:'2099-01-01T00:00:00.000Z'})));
  else {append('other','fact','Other source changed');append('meeting','fact','16:00');}
  const input={graphNamespace:namespace,projection:{batchToken:'committed-public-batch',graphRevision:store.read().revision,
    links:[{eventId:'memory-change',fact:ref('memory-meeting',2),node:ref('meeting',2)},
      ...(mixed?[{eventId:'other-change',fact:ref('memory-other',2),node:ref('other',2)}]:[])]}};
  const event={eventId:'calendar-change',source:'calendar:synthetic',meetingFactId:'meeting',originalSummary:'14:00',
    newSummary:'16:00',sourceRevision:'2',detectedAt:at,deadline:new Date(Date.now()+60_000).toISOString(),signal:new AbortController().signal};
  const receipts=new InMemoryMeetingDecisionReceiptStore();
  return {namespace,store,input,event,receipts};
}

test('reviewed meeting receipts satisfy the actual lossless JSON checkpoint contract across reopen', async t => {
  for (const mode of ['no_binding', 'kept', 'pending_review', 'optional_feedback', 'confirmed_repair']) await t.test(mode, async () => {
    const f = fixture();
    if (mode === 'kept') {
      for (const [id, dependencies] of [['goal', [ref('meeting', 2)]], ['plan', [ref('goal', 2)]]]) {
        const {revision, graphRevision, ...input} = f.store.read().history.findLast(node => node.id === id);
        f.store.append(f.store.read().revision, {...input, dependencies});
      }
    }
    const before = f.store.read();
    let reviewed = 0, applied = 0, writes = 0, finished = mode !== 'pending_review', feedback;
    const scope = selectMeetingRepairScope(before, at,
      {...f.input, projection: {...f.input.projection, graphRevision: before.revision}}, ref('meeting', 2));
    const options = buildMeetingRepairOptions(before, at,
      {...f.input, projection: {...f.input.projection, graphRevision: before.revision}});
    const review = {taskId: 'synthetic-json-review', graphNamespace: f.namespace, graphRevision: before.revision,
      bindingVersion: 'existing-host', evaluatedAt: at, affected: scope.items, options,
      action: mode === 'confirmed_repair' ? 'REVISE' : 'RECHECK',
      ...(mode === 'confirmed_repair' ? {selectedOption: options.find(option => option.action === 'REVISE'),
        selection: {state: 'selected', eligibleForRuntime: true, selected: ref('revise'), answerConfidence: 0.9}} : {})};
    const result = () => ({task: {taskId: review.taskId, state: finished ? 'succeeded' : 'running'},
      ...(finished ? {review} : {})});
    const receiptStore = {loadReceipt: query => f.receipts.loadReceipt(query),
      listReceipts: filter => f.receipts.listReceipts(filter), saveReceipt(record) {
        const encoded = JSON.parse(JSON.stringify(record));
        assert.deepEqual(record, encoded, 'actual host-state storage rejects lossy JSON');
        f.receipts.saveReceipt(encoded);
      }};
    const reviewedRepair = {readCommittedProjection: async () => ({sourceRevision: '2', meetingFact: ref('meeting', 2), input: f.input}),
      reviewCommittedFact: async () => {reviewed++; return result();}, readReview: result,
      async applyDecision() {
        applied++;
        if (mode !== 'confirmed_repair') return {status: 'waiting_reconciliation'};
        if (!feedback) {
          const committed = f.store.appendBatch(before.revision, review.selectedOption.repair.changes.map(change => {
            const {revision, graphRevision, ...input} = before.history.findLast(node => node.id === change.node.id);
            return {...input, summary: change.summary, reason: change.reason, dependencies: change.dependencies};
          }));
          writes++;
          feedback = {status: 'applied', taskId: 'synthetic-guarded-repair', executionVerified: true,
            graphUpdateVerified: true, graphRevision: committed.revision,
            updatedNodes: scope.items.map(item => ref(item.node.id, item.node.revision + 1)),
            evidenceRefs: ['explicit-trusted-runtime-feedback-fixture']};
        }
        return feedback;
      }};
    const open = () => new ReviewedMeetingFactConsumer({store: f.store, receiptStore, namespace: f.namespace,
      ...(mode === 'no_binding' ? {} : {reviewedRepair})});
    const first = await open().processEvent(f.event);
    if (mode === 'no_binding' || mode === 'kept') {
      assert.equal(first.status, mode === 'kept' ? 'kept' : 'requires_review');
      assert.equal(reviewed, 0); assert.equal(applied, 0);
      assert.equal(first.retryableInference, mode === 'no_binding' ? true : undefined);
    } else if (mode === 'pending_review') {
      assert.equal(first.reviewTaskId, review.taskId); assert.equal(first.status, 'requires_review');
      assert.equal(first.retryableInference, undefined); assert.equal(applied, 0);
      finished = true;
    } else assert.equal(first.status, mode === 'confirmed_repair' ? 'applied' : 'waiting_reconciliation');
    const reopened = await open().processEvent(f.event);
    if (mode === 'pending_review' || mode === 'optional_feedback') {
      assert.equal(reopened.status, 'waiting_reconciliation');
      assert.equal(Object.hasOwn(reopened, 'selection'), false);
      assert.equal(Object.hasOwn(reopened, 'repairTaskId'), false);
    }
    assert.equal(reviewed, ['no_binding', 'kept'].includes(mode) ? 0 : 1);
    assert.equal(writes, mode === 'confirmed_repair' ? 1 : 0);
    if (mode !== 'no_binding') assert.equal(Object.hasOwn(reopened, 'retryableInference'), false);
    if (mode === 'confirmed_repair') {
      assert.equal(reopened.status, 'already_processed'); assert.equal(applied, 1);
      assert.equal(f.store.read().revision, before.revision + scope.items.length);
    } else assert.deepEqual(f.store.read(), before);
    assert.equal(f.receipts.listReceipts().length, 1);
    assert.deepEqual(reopened, JSON.parse(JSON.stringify(reopened)));
  });
});

test('resumed legacy meeting receipts omit an absent repair task ID without losing their selection', async () => {
  const f = fixture(), before = f.store.read();
  const scope = selectMeetingRepairScope(before, at, f.input, ref('meeting', 2));
  const review = {taskId: 'legacy-review', graphNamespace: f.namespace, graphRevision: before.revision,
    bindingVersion: 'existing-host', evaluatedAt: at, affected: scope.items,
    options: buildMeetingRepairOptions(before, at, f.input), action: 'RECHECK',
    selection: {state: 'review', reason: 'uncertain', eligibleForRuntime: false, answerConfidence: 0.4}};
  const result = {task: {taskId: review.taskId, state: 'succeeded'}, review};
  let reviewed = 0;
  const reviewedRepair = {readCommittedProjection: async () => ({sourceRevision: '2', meetingFact: ref('meeting', 2), input: f.input}),
    reviewCommittedFact: async () => {reviewed++; return result;}, readReview: () => result,
    applyDecision: async () => ({status: 'waiting_reconciliation'})};
  await new ReviewedMeetingFactConsumer({store: f.store, receiptStore: f.receipts, namespace: f.namespace,
    reviewedRepair}).processEvent(f.event);
  // The existing file/JSON representation omits undefined optional properties.
  const legacy = JSON.parse(JSON.stringify(f.receipts.listReceipts()[0]));
  f.receipts.saveReceipt(legacy);
  const receiptStore = {loadReceipt: query => f.receipts.loadReceipt(query), saveReceipt(record) {
    assert.deepEqual(record, JSON.parse(JSON.stringify(record)), 'actual host-state storage rejects lossy JSON');
    f.receipts.saveReceipt(record);
  }};
  const resumed = await new ReviewedMeetingFactConsumer({store: f.store, receiptStore, namespace: f.namespace,
    reviewedRepair}).processEvent(f.event);
  assert.equal(resumed.status, 'waiting_reconciliation');
  assert.equal(Object.hasOwn(resumed, 'repairTaskId'), false);
  assert.deepEqual(resumed.selection, review.selection);
  assert.equal(reviewed, 1);
  assert.deepEqual(f.store.read(), before);
});

test('queued reviewed proposal queries retain the submitted event identity', async () => {
  const f = fixture(), before = f.store.read();
  const consumer = new ReviewedMeetingFactConsumer({store: f.store, receiptStore: f.receipts, namespace: f.namespace});
  const expected = await consumer.processEvent(f.event);
  await consumer.processEvent({...f.event, eventId: 'different-event'});
  const query = {eventId: f.event.eventId, source: f.event.source, namespace: f.namespace};
  const pending = consumer.applyApprovedProposal(query, f.event);
  query.eventId = 'different-event';
  assert.deepEqual(await pending, expected);
  assert.deepEqual(f.store.read(), before);
});

test('reviewed proposal handoff cannot replace a cancelled signal or renew an expired lease during receipt load', async () => {
  for (const mode of ['cancelled', 'expired']) {
    const f = fixture(), before = f.store.read();
    let clock = Date.now(), blocking = false, entered, release, applied = 0;
    const started = new Promise(resolve => {entered = resolve;});
    const loading = new Promise(resolve => {release = resolve;});
    const review = {taskId: 'existing-review', graphNamespace: f.namespace, graphRevision: before.revision,
      bindingVersion: 'existing-host', action: 'RECHECK', evaluatedAt: at,
      affected: selectProjectedRepairScope(before, at, f.input).items,
      options: buildMeetingRepairOptions(before, at, f.input)};
    const result = {task: {taskId: review.taskId, state: 'succeeded'}, review};
    const reviewedRepair = {readCommittedProjection: async () => ({sourceRevision: '2', meetingFact: ref('meeting', 2), input: f.input}),
      reviewCommittedFact: async () => result, readReview: () => result,
      applyDecision: async () => {applied++; return {status: 'waiting_approval', taskId: 'original-task'};}};
    const consumer = new ReviewedMeetingFactConsumer({store: f.store, namespace: f.namespace, now: () => clock,
      reviewedRepair, receiptStore: {async loadReceipt(query) {
        if (blocking) {entered(); await loading;}
        return f.receipts.loadReceipt(query);
      }, saveReceipt: record => f.receipts.saveReceipt(record)}});
    assert.equal((await consumer.processEvent(f.event)).status, 'waiting_approval');
    const originalReceipts = f.receipts.listReceipts(), baseline = applied, controller = new AbortController();
    const context = {deadline: f.event.deadline, signal: controller.signal};
    blocking = true;
    const pending = consumer.applyApprovedProposal({eventId: f.event.eventId, source: f.event.source}, context);
    await started;
    if (mode === 'cancelled') {controller.abort(); context.signal = new AbortController().signal;}
    else {clock = Date.parse(context.deadline); context.deadline = new Date(clock + 60_000).toISOString();}
    release();
    await assert.rejects(pending, error => error.code === 'INVALID_ARGUMENT');
    assert.equal(applied, baseline, 'The cancelled/expired handoff must not call the host');
    assert.deepEqual(f.receipts.listReceipts(), originalReceipts);
    assert.deepEqual(f.store.read(), before);
  }
});

test('pending reviewed meeting work retains constructor bindings and live original port hooks', async () => {
  const f=fixture(),before=f.store.read(),clock=Date.now();
  let release,entered;
  const loading=new Promise(resolve=>{release=resolve;});
  const started=new Promise(resolve=>{entered=resolve;});
  let reads=0,saves=0,replacedCalls=0;
  const store={read:revision=>f.store.read(revision)};
  const receiptStore={loadReceipt:async query=>{
    assert.equal(query.namespace,f.namespace);entered();await loading;
    return f.receipts.loadReceipt(query);
  },saveReceipt:record=>f.receipts.saveReceipt(record),listReceipts:filter=>f.receipts.listReceipts(filter)};
  const options={store,receiptStore,namespace:f.namespace,now:()=>clock};
  const consumer=new ReviewedMeetingFactConsumer(options);
  const pending=consumer.processEvent(f.event);
  await started;
  options.namespace='unrelated-namespace';
  options.store={read(){replacedCalls++;throw Error('replaced graph');}};
  options.receiptStore={loadReceipt(){replacedCalls++;},saveReceipt(){replacedCalls++;}};
  options.reviewedRepair={readCommittedProjection(){replacedCalls++;throw Error('replaced host');}};
  options.now=()=>clock+120_000;
  store.read=revision=>{reads++;return f.store.read(revision);};
  receiptStore.saveReceipt=record=>{saves++;f.receipts.saveReceipt(record);};
  release();
  const receipt=await pending;
  assert.equal(receipt.graphRevisionBefore,before.revision);
  assert.equal(receipt.status,'requires_review');
  assert.equal(reads,1);assert.equal(saves,1);assert.equal(replacedCalls,0);
  const record=f.receipts.loadReceipt({namespace:f.namespace,source:f.event.source,eventId:f.event.eventId});
  assert.equal(record.namespace,f.namespace);assert.equal(record.updatedAt,new Date(clock).toISOString());
  assert.deepEqual((await consumer.getReceipt(f.event.eventId,f.event.source)),receipt);
  assert.equal((await consumer.listReceipts()).length,1);
  assert.deepEqual(f.store.read(),before);
});

test('committed meeting reader retains its factory and request bindings while the source awaits', async () => {
  const f=fixture(),submitted={...f.event},before=f.store.read();
  let release,entered,getterCalls=0,reads=0,factReads=0,replacedCalls=0;
  const loading=new Promise(resolve=>{release=resolve;});
  const started=new Promise(resolve=>{entered=resolve;});
  const store={read:revision=>f.store.read(revision)};
  const facts={listImpactReceipts:()=>[]};
  const options={namespace:f.namespace,store,facts,readSourceRevision:async(event,context)=>{
    getterCalls++;assert.equal(event.newSummary,submitted.newSummary);assert.equal(context.deadline,submitted.deadline);
    entered();await loading;
    return {source:submitted.source,sourceRevision:submitted.sourceRevision,meetingFact:ref('meeting',2)};
  }};
  const reader=createCommittedMeetingProjectionReader(options);
  const pending=reader(f.event,f.event);await started;
  options.namespace='other-namespace';
  options.store={read(){replacedCalls++;throw Error('replaced graph');}};
  options.facts={listImpactReceipts(){replacedCalls++;return [];}};
  options.readSourceRevision=async()=>{replacedCalls++;return undefined;};
  f.event.newSummary='replaced summary';f.event.sourceRevision='replaced revision';
  f.event.deadline=new Date(Date.now()-1000).toISOString();
  store.read=revision=>{reads++;return f.store.read(revision);};
  facts.listImpactReceipts=()=>{factReads++;return [{projection:f.input.projection,
    completed:{batchToken:f.input.projection.batchToken,report:analyzeImpact(before,at)}}];};
  release();
  const result=await pending;
  assert.deepEqual(result,{sourceRevision:submitted.sourceRevision,meetingFact:ref('meeting',2),input:f.input});
  assert.equal(reads,1);assert.equal(factReads,1);assert.equal(replacedCalls,0);
  assert.deepEqual(await reader(submitted,submitted),result,'later calls retain the original source getter');
  assert.equal(getterCalls,2);assert.deepEqual(f.store.read(),before);
});

test('mixed completed batch retains both links as proof but meeting selection and restart remain on one chain',async()=>{
  const f=fixture(true),before=f.store.read();let calls=0,applied=0;
  const completed={batchToken:f.input.projection.batchToken,report:analyzeImpact(before,at)};
  const reader=createCommittedMeetingProjectionReader({namespace:f.namespace,store:f.store,
    facts:{listImpactReceipts:()=>[{projection:f.input.projection,completed}]},
    readSourceRevision:async()=>({source:f.event.source,sourceRevision:'2',meetingFact:ref('meeting',2)})});
  const bound=await reader(f.event,f.event);
  assert.deepEqual(bound.input,f.input,'a multi-node batch ends after its first meeting node revision');
  assert.deepEqual(selectProjectedRepairScope(before,at,f.input).items.map(item=>item.node.id),['goal','plan','other-goal','other-plan']);
  const scope=selectMeetingRepairScope(before,at,f.input,ref('meeting',2));
  assert.deepEqual(scope.items.map(item=>item.node.id),['goal','plan']);
  assert.throws(()=>buildMeetingRepairOptions(before,at,f.input),{code:'INVALID_ARGUMENT'});
  const options=buildMeetingRepairOptions(before,at,f.input,ref('meeting',2));
  assert.deepEqual(options.find(option=>option.action==='REVISE').repair.changes.map(item=>item.node.id),['goal','plan']);
  const review={taskId:'mixed-meeting-review',graphNamespace:f.namespace,graphRevision:before.revision,
    bindingVersion:'existing-host',evaluatedAt:at,action:'RECHECK',affected:scope.items,options,
    selection:{state:'review',reason:'uncertain',eligibleForRuntime:false,answerConfidence:0.4}};
  const value={task:{taskId:review.taskId,state:'succeeded'},review};
  const reviewedRepair={readCommittedProjection:reader,reviewCommittedFact:async request=>{
    calls++;assert.deepEqual(request.projection,f.input.projection);assert.deepEqual(request.meetingFact,ref('meeting',2));
    assert.equal(request.sourceRevision,'2');return value;
  },readReview:()=>value,applyDecision:async()=>{applied++;return {status:'waiting_reconciliation',taskId:'same-task'};}};
  const open=()=>new ReviewedMeetingFactConsumer({store:f.store,receiptStore:f.receipts,namespace:f.namespace,reviewedRepair});
  await open().processEvent(f.event);await open().processEvent(f.event);
  assert.equal(calls,1);assert.equal(applied,2);
  review.affected=selectProjectedRepairScope(before,at,f.input).items;
  await open().processEvent(f.event);assert.equal(applied,2,'recovery cannot broaden the persisted meeting scope');
  const tampered=structuredClone(f.input);tampered.projection.links[1].node.revision=99;
  assert.throws(()=>selectMeetingRepairScope(before,at,tampered,ref('meeting',2)),{code:'NOT_APPLICABLE'});
  assert.deepEqual(f.store.read(),before);
});
test('meeting candidates cover only its committed Fact dependency chain and never rewrite summaries',()=>{
  const f=fixture(),before=f.store.read();
  const options=buildMeetingRepairOptions(before,at,f.input);
  const repair=options.find(option=>option.action==='REVISE').repair;
  assert.deepEqual(repair.changes.map(change=>change.node.id),['goal','plan']);
  for(const change of repair.changes) assert.equal(change.summary,before.history.findLast(node=>node.id===change.node.id).summary);
  assert.deepEqual(f.store.read(),before);
});
test('missing reviewed Runtime port retains RECHECK without Laya/graph/tool writes',async()=>{
  const f=fixture(),before=f.store.read();
  const consumer=new ReviewedMeetingFactConsumer({store:f.store,receiptStore:f.receipts,namespace:f.namespace});
  const receipt=await consumer.processEvent(f.event);
  assert.equal(receipt.status,'requires_review');assert.equal(receipt.decisionAction,'RECHECK');
  assert.equal(receipt.executionVerified,false);assert.deepEqual(f.store.read(),before);
});
test('uncertain choice persists the exact selection and reopens the same Runtime review without rerunning choose',async()=>{
  const f=fixture(),before=f.store.read();let reviewed=0,applied=0;
  const scope=selectProjectedRepairScope(before,at,f.input);
  const review={taskId:'existing-review',graphNamespace:f.namespace,graphRevision:before.revision,bindingVersion:'existing-host',
    evaluatedAt:at,action:'RECHECK',affected:scope.items,options:buildMeetingRepairOptions(before,at,f.input),
    selection:{state:'review',reason:'uncertain',eligibleForRuntime:false,selected:ref('revise'),answerConfidence:0.45}};
  const result={task:{taskId:review.taskId,state:'succeeded'},review};
  const reviewedRepair={readCommittedProjection:async()=>({sourceRevision:'2',meetingFact:ref('meeting',2),input:f.input}),
    reviewCommittedFact:async()=>{reviewed++;return result;},readReview:()=>result,
    applyDecision:async()=>{applied++;return {status:'submitted',taskId:'existing-cloud-task',executionVerified:false,graphUpdateVerified:false};}};
  const open=()=>new ReviewedMeetingFactConsumer({store:f.store,receiptStore:f.receipts,namespace:f.namespace,reviewedRepair});
  const first=await open().processEvent(f.event);
  assert.equal(first.status,'submitted');assert.deepEqual(first.selection,review.selection);
  assert.equal(first.confidence,0.45);assert.equal(first.executionVerified,false);
  await open().processEvent(f.event);assert.equal(reviewed,1);assert.equal(applied,2);
  assert.deepEqual(f.store.read(),before);
});
test('same event with changed contents conflicts; mismatched committed source cannot start a review',async()=>{
  const f=fixture();let calls=0;
  const reviewedRepair={readCommittedProjection:async()=>({sourceRevision:'wrong',meetingFact:ref('meeting',2),input:f.input}),
    reviewCommittedFact:async()=>{calls++;throw Error();},readReview:()=>{throw Error();},applyDecision:async()=>{throw Error();}};
  const consumer=new ReviewedMeetingFactConsumer({store:f.store,receiptStore:f.receipts,namespace:f.namespace,reviewedRepair});
  await consumer.processEvent(f.event);
  const conflict=await consumer.processEvent({...f.event,newSummary:'Different untrusted contents'});
  assert.equal(conflict.status,'conflict');assert.equal(calls,0);
});
test('pending review recovery preserves its actual choice and rejects a replaced impact scope',async()=>{
  const f=fixture(),before=f.store.read();let finished=false,applied=0;
  const scope=selectProjectedRepairScope(before,at,f.input);
  const review={taskId:'pending-review',graphNamespace:f.namespace,graphRevision:before.revision,bindingVersion:'existing-host',
    evaluatedAt:at,action:'RECHECK',affected:scope.items,options:buildMeetingRepairOptions(before,at,f.input),
    selection:{state:'review',reason:'uncertain',eligibleForRuntime:false,answerConfidence:0.35}};
  const read=()=>({task:{taskId:review.taskId,state:finished?'succeeded':'running'},...(finished?{review}:{})});
  const reviewedRepair={readCommittedProjection:async()=>({sourceRevision:'2',meetingFact:ref('meeting',2),input:f.input}),
    reviewCommittedFact:async()=>read(),readReview:read,
    applyDecision:async()=>{applied++;return {status:'waiting_reconciliation',taskId:'original-task'};}};
  const open=()=>new ReviewedMeetingFactConsumer({store:f.store,receiptStore:f.receipts,namespace:f.namespace,reviewedRepair});
  const pending=await open().processEvent(f.event);assert.equal(pending.reviewTaskId,'pending-review');assert.equal(applied,0);
  finished=true;
  const recovered=await open().processEvent(f.event);
  assert.deepEqual(recovered.selection,review.selection);assert.equal(recovered.confidence,0.35);assert.equal(applied,1);
  review.affected=[];
  await open().processEvent(f.event);assert.equal(applied,1);assert.deepEqual(f.store.read(),before);
});


test('meeting options retain full 101-item recheck scope without exceeding the optional repair bound', () => {
  for (const count of [100, 101]) {
    const namespace = 'synthetic-public-vault-meeting-options-' + count;
    const store = new FakeCoordinationStoreHost().provision(namespace);
    const append = (id, kind, summary, dependencies = []) => store.append(store.read().revision,
      {id, kind, summary, dependencies, sourceRef: 'synthetic-public-vault/meeting.md#L1',
        sensitivity: 'public', state: 'active', reason: 'Synthetic public options boundary',
        validFrom: '2026-01-01T00:00:00.000Z', validUntil: '2099-01-01T00:00:00.000Z'});
    append('meeting', 'fact', '15:00');
    append('goal', 'goal', 'Attend public meeting', [ref('meeting')]);
    for (let index = 1; index < count; index++) append('plan-' + index, 'plan', 'Prepare unchanged', [ref('goal')]);
    append('unrelated', 'plan', 'Retain unrelated content');
    append('meeting', 'fact', '17:00');
    const before = store.read(), input = {graphNamespace: namespace, projection: {
      batchToken: 'synthetic-public-projection', graphRevision: before.revision,
      links: [{eventId: 'synthetic-public-fact-change', fact: ref('memory-meeting', 2), node: ref('meeting', 2)}]}};
    const scope = selectMeetingRepairScope(before, at, input, ref('meeting', 2));
    assert.equal(scope.items.length, count);
    assert.deepEqual(scope.items, analyzeImpact(before, at).items.filter(item => item.action === 'RECHECK'));
    const options = buildMeetingRepairOptions(before, at, input, ref('meeting', 2));
    assert.deepEqual(options.slice(0, 2).map(option => [option.id, option.action]), [['recheck', 'RECHECK'], ['defer', 'RECHECK']]);
    if (count === 100) {
      assert.equal(options.length, 3);
      const candidate = options.find(option => option.action === 'REVISE');
      assert.equal(candidate.repair.changes.length, count);
      assert.deepEqual(new Set(candidate.repair.changes.map(change => change.node.id)), new Set(scope.items.map(item => item.node.id)));
      for (const change of candidate.repair.changes) {
        const old = before.history.findLast(node => node.id === change.node.id);
        assert.equal(change.summary, old.summary); assert.equal(change.reason, old.reason);
      }
    } else {
      assert.equal(options.length, 2);
      assert.equal(options.some(option => Object.hasOwn(option, 'repair')), false);
      assert.throws(() => buildMinimalRepairCandidate(before, at, {
        expectedGraphRevision: before.revision, targets: scope.items.map(item => item.node)}), {code: 'INVALID_ARGUMENT'});
    }
    assert.deepEqual(store.read(), before, 'Building options never changes the graph or its unrelated Plan');
    const stale = {...input, projection: {...input.projection, graphRevision: before.revision - 1}};
    assert.throws(() => buildMeetingRepairOptions(before, at, stale, ref('meeting', 2)), {code: 'REVISION_CONFLICT'});
  }
});

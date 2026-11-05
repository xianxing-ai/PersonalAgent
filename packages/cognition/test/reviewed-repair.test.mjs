import test from 'node:test';
import assert from 'node:assert/strict';
import {FakeCoordinationStoreHost} from '@personal-agent/goals/store';
import {buildMinimalRepairCandidate,prepareReviewedRepair} from '../dist/index.js';
const at='2026-09-30T08:00:00.000Z';
const ref=(id,revision=1)=>({id,revision});
function fixture(sensitivity='private') {
  const store=new FakeCoordinationStoreHost().provision('reviewed');
  for(const [id,kind,deps] of [['source','fact',[]],['goal','goal',[ref('source')]],['plan','plan',[ref('goal')]],['source','fact',[]]]) {
    store.append(store.read().revision,{id,kind,dependencies:deps,summary:`source revision ${store.read().revision}`,
      sourceRef:'test/source',sensitivity,state:'active',reason:'original intent',
      validFrom:'2026-01-01T00:00:00.000Z',validUntil:'2099-01-01T00:00:00.000Z'});
  }
  const minimal=buildMinimalRepairCandidate(store.read(),at,{expectedGraphRevision:4,targets:[ref('goal'),ref('plan')]});
  const option={id:'revise',revision:1,description:'Evaluate the minimal repair',action:'REVISE',repair:minimal.request};
  const review={taskId:'review-1',graphNamespace:'reviewed',graphRevision:4,bindingVersion:'host-v1',
    affected:[{node:ref('goal')},{node:ref('plan')}],
    options:[option],selectedOption:structuredClone(option),selection:{state:'selected',eligibleForRuntime:true,selected:ref('revise')}};
  return {store,review};
}
test('binds the selected minimal Goal/Plan repair without mutation and permits scoped semantic text',()=>{
  const {store,review}=fixture(),before=store.read();
  const prepared=prepareReviewedRepair(before,at,review);
  assert.equal(prepared.kind,'prepared');assert.equal(prepared.binding.reviewTaskId,'review-1');
  assert.deepEqual(prepared.binding.targets,[ref('goal'),ref('plan')]);
  const candidate=structuredClone(prepared.request);candidate.changes[1].summary='New explicit plan content';
  const semantic=prepareReviewedRepair(before,at,review,candidate);
  assert.equal(semantic.kind,'prepared');assert.equal(semantic.preview.inputs[1].summary,'New explicit plan content');
  assert.notEqual(semantic.binding.candidateDigest,prepared.binding.candidateDigest);
  assert.deepEqual(store.read(),before);
});
test('uncertain/RECHECK/no repair cannot create an execution binding',()=>{
  const {store,review}=fixture();
  for(const altered of [{...review,selection:{...review.selection,state:'review',eligibleForRuntime:false}},
    {...review,selectedOption:{...review.selectedOption,action:'RECHECK',repair:undefined}}]) {
    assert.equal(prepareReviewedRepair(store.read(),at,altered).kind,'unavailable');
  }
  const restricted=fixture('restricted');
  assert.equal(prepareReviewedRepair(restricted.store.read(),at,restricted.review).reason,'unsupported_scope');
});
test('rejects changed selection, strategy-as-summary, arbitrary node, dependency or graph revisions',()=>{
  const {store,review}=fixture(),before=store.read();
  assert.throws(()=>prepareReviewedRepair(before,at,{...review,selectedOption:{...review.selectedOption,description:'replaced'}}));
  for(const change of [candidate=>{candidate.changes[0].summary=review.selectedOption.description;},
    candidate=>{candidate.changes[0].node=ref('source',2);},
    candidate=>{candidate.changes[0].dependencies=[ref('source')];},
    candidate=>{candidate.expectedGraphRevision=3;}]) {
    const candidate=structuredClone(review.selectedOption.repair);change(candidate);
    assert.throws(()=>prepareReviewedRepair(before,at,review,candidate));
  }
  assert.throws(()=>prepareReviewedRepair(before,at,{...review,graphRevision:3}),{code:'REVISION_CONFLICT'});
  assert.deepEqual(store.read(),before);
});

test('Fact withdrawal and expiry propagate to impact analysis and prepareReviewedRepair rejects revision conflict', () => {
  const {store, review} = fixture();
  const current = store.read();

  // Withdraw the source fact
  store.append(current.revision, {
    id: 'source', kind: 'fact', dependencies: [], summary: 'source withdrawn',
    sourceRef: 'test/source', sensitivity: 'private', state: 'withdrawn', reason: 'revoked',
    validFrom: '2026-01-01T00:00:00.000Z', validUntil: '2099-01-01T00:00:00.000Z'
  });

  const updatedSnapshot = store.read();
  assert.equal(updatedSnapshot.revision, 5);

  // Older review referencing graphRevision 4 must fail with REVISION_CONFLICT
  assert.throws(() => prepareReviewedRepair(updatedSnapshot, at, review), {code: 'REVISION_CONFLICT'});
});

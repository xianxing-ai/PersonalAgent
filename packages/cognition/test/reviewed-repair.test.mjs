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
test('rejects mismatched namespace, empty binding identity and under-reported affected scope',()=>{
  const {store,review}=fixture(),snapshot=store.read();
  assert.throws(()=>prepareReviewedRepair(snapshot,at,null),{code:'INVALID_ARGUMENT'});
  assert.throws(()=>prepareReviewedRepair(snapshot,at,{...review,graphNamespace:'other'}),{code:'INVALID_ARGUMENT'});
  assert.throws(()=>prepareReviewedRepair(snapshot,at,{...review,taskId:''}),{code:'INVALID_ARGUMENT'});
  assert.throws(()=>prepareReviewedRepair(snapshot,at,{...review,bindingVersion:''}),{code:'INVALID_ARGUMENT'});
  assert.throws(()=>prepareReviewedRepair(snapshot,at,{...review,affected:'goal,plan'}),{code:'INVALID_ARGUMENT'});
  assert.throws(()=>prepareReviewedRepair(snapshot,at,{...review,affected:[{node:ref('goal')}]}),{code:'INVALID_ARGUMENT'});
  assert.equal(prepareReviewedRepair(snapshot,at,
    {...review,selection:{...review.selection,selected:ref('other-option')}}).kind,'unavailable');
  assert.deepEqual(store.read(),snapshot);
});
test('a selected option whose repair predates the graph revision is a conflict',()=>{
  const {store,review}=fixture();
  const stale=structuredClone(review);
  stale.options[0].repair.expectedGraphRevision=3;
  stale.selectedOption.repair.expectedGraphRevision=3;
  assert.throws(()=>prepareReviewedRepair(store.read(),at,stale),{code:'REVISION_CONFLICT'});
});
test('a reviewed repair beyond the 16-input scope stays unsupported while 16 inputs prepare',()=>{
  const node=(id,kind,summary,dependencies)=>({id,kind,dependencies,summary,sourceRef:'test/source',
    sensitivity:'private',state:'active',reason:'original intent',
    validFrom:'2026-01-01T00:00:00.000Z',validUntil:'2099-01-01T00:00:00.000Z'});
  const build=count=>{
    const store=new FakeCoordinationStoreHost().provision('bounded');
    store.append(store.read().revision,node('source','fact','source revision 0',[]));
    for(let index=0;index<count;index++) store.append(store.read().revision,
      node(`goal-${String(index).padStart(2,'0')}`,'goal',`goal ${index} original`,[ref('source',1)]));
    store.append(store.read().revision,node('source','fact','source revision corrected',[]));
    return store;
  };
  const prepared=(store,count)=>{
    const option={id:'revise',revision:1,description:'Evaluate the bounded repair',action:'REVISE',
      repair:{expectedGraphRevision:store.read().revision,
        changes:Array.from({length:count},(_,index)=>({node:{id:`goal-${String(index).padStart(2,'0')}`,revision:1},
          summary:`goal ${index} repaired`,reason:'reviewed scope bound',dependencies:[ref('source',2)]}))}};
    return {taskId:'review-bound',graphNamespace:'bounded',graphRevision:store.read().revision,
      bindingVersion:'host-v1',affected:option.repair.changes.map(change=>({node:change.node})),
      options:[option],selectedOption:structuredClone(option),
      selection:{state:'selected',eligibleForRuntime:true,selected:ref('revise')}};
  };
  const within=build(16),withinResult=prepareReviewedRepair(within.read(),at,prepared(within,16));
  assert.equal(withinResult.kind,'prepared');
  assert.equal(withinResult.binding.targets.length,16);
  assert.deepEqual(withinResult.binding.dependencies,[ref('source',2)]);
  const beyond=build(17);
  assert.deepEqual(prepareReviewedRepair(beyond.read(),at,prepared(beyond,17)),
    {kind:'unavailable',reason:'unsupported_scope'});
});

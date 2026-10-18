import test from 'node:test';
import assert from 'node:assert/strict';
import {policy} from './design-manifest.mjs';
import {evaluateReviews,receiptFrom} from './check-design-review.mjs';
const head='a'.repeat(40),oldHead='c'.repeat(40);
function review(login,id,state='APPROVED',commit_id=head,body='') {
  return {id,user:{login},state,commit_id,body};
}
function check(reviews,author='zemeng5208') {
  return evaluateReviews({headSha:head,author,reviews});
}
test('any one eligible non-author current-head approval suffices',()=>{
  assert.deepEqual(policy.eligibleReviewers,['zemeng5208','goo122','Potatos498','2511375597-lab']);
  for(const [author,reviewer] of [['zemeng5208','goo122'],['goo122','Potatos498'],['Potatos498','zemeng5208'],['goo122','2511375597-lab'],['2511375597-lab','goo122']]) {
    assert.equal(check([review(reviewer,1)],author).passed,true);
  }
});
test('author self-approval and outsider approval cannot satisfy the gate',()=>{
  assert.equal(check([review('zemeng5208',1)]).passed,false);
  assert.equal(check([review('2511375597-lab',1)],'2511375597-lab').passed,false);
  assert.equal(check([review('outsider',1)]).passed,false);
});
test('stale head approval does not satisfy the gate',()=>{
  assert.equal(check([review('goo122',1,'APPROVED',oldHead)]).passed,false);
  assert.equal(check([review('goo122',1,'APPROVED',oldHead),review('goo122',2)]).passed,true);
  assert.equal(check([review('2511375597-lab',1,'APPROVED',oldHead)],'goo122').passed,false);
});
test('a blocking changes request must be resolved even with another approval',()=>{
  const result=check([review('goo122',1),review('Potatos498',2,'CHANGES_REQUESTED')]);
  assert.equal(result.passed,false);
  assert.deepEqual(result.blocked,['Potatos498']);
  assert.equal(check([review('goo122',1),review('Potatos498',2,'CHANGES_REQUESTED'),review('Potatos498',3)],'zemeng5208').passed,true);
  const fourthBlocked=check([review('goo122',1),review('2511375597-lab',2,'CHANGES_REQUESTED')]);
  assert.equal(fourthBlocked.passed,false);
  assert.deepEqual(fourthBlocked.blocked,['2511375597-lab']);
  assert.equal(check([review('goo122',1),review('2511375597-lab',2,'CHANGES_REQUESTED'),review('2511375597-lab',3)]).passed,true);
});
test('dismissed approval no longer counts; comments do not revoke approval',()=>{
  assert.equal(check([review('goo122',1),review('goo122',2,'DISMISSED')]).passed,false);
  assert.equal(check([review('goo122',1),review('goo122',2,'COMMENTED')]).passed,true);
});
test('reading receipt is optional and cannot replace an actual approval',()=>{
  const body=`<!-- ${policy.receiptMarker} -->\n\`\`\`json\n{"version":1}\n\`\`\``;
  assert.equal(check([review('goo122',1,'APPROVED',head,'')]).passed,true);
  assert.equal(check([review('goo122',1,'COMMENTED',head,body)]).passed,false);
});
test('ordinary prose and malformed or oversized receipts fail parsing',()=>{
  assert.equal(receiptFrom('I opened everything'),null);
  assert.equal(receiptFrom('x'.repeat(65537)),null);
  assert.equal(receiptFrom(`<!-- ${policy.receiptMarker} -->\n\`\`\`json\n{bad}\n\`\`\``),null);
});

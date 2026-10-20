import assert from 'node:assert/strict';
import test from 'node:test';
import reporter from '../../apps/desktop/test-support/node-test-failure-reporter.mjs';

async function render(error) {
  const events=[{type:'test:fail',data:{name:'synthetic worker',details:{error}}}];
  let output='';
  for await(const chunk of reporter(events))output+=chunk;
  return output;
}
test('file failure diagnostics preserve supplied exit information without inventing fields',async()=>{
  const output=await render({message:'test failed',code:'ERR_TEST_FAILURE',exitCode:17});
  assert.match(output,/ERR_TEST_FAILURE/);assert.match(output,/exitCode: 17/);
  assert.doesNotMatch(output,/signal:|stack:/);
});
test('worker diagnostics preserve actual stack and signal without inventing exitCode',async()=>{
  const output=await render({message:'worker stopped',stack:'synthetic stack frame',signal:'SIGTERM'});
  assert.match(output,/synthetic stack frame/);assert.match(output,/SIGTERM/);
  assert.doesNotMatch(output,/exitCode:|code:/);
});

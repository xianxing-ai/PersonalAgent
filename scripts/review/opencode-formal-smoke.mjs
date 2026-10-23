import {bundleFor} from './opencode-formal-review.mjs';
import {runModel} from './opencode-formal-runner.mjs';

// No repository contents, credentials, or GitHub writes. This is inference
// evidence on a synthetic fixture, never evidence of a real PR review.
const pr = {number: 1, state: 'open', draft: false, changed_files: 1, user: {login: 'synthetic-author'},
  head: {sha: 'a'.repeat(40), repo: {full_name: 'xianxing-ai/PersonalAgent', private: false}},
  base: {sha: 'b'.repeat(40), ref: 'main', repo: {full_name: 'xianxing-ai/PersonalAgent', private: false}}};
let failed = false;
for (const [name, after, expected] of [
  ['addition-regression', '// Contract: add two finite numbers.\nexport const add = (a, b) => a - b;\n', 'REQUEST_CHANGES'],
  ['addition-equivalent', '// Contract: add two finite numbers.\nexport const add = (left, right) => left + right;\n', 'APPROVE'],
]) {
  const bundle = bundleFor(pr, [{path: 'addition.mjs', status: 'modified',
    before: '// Contract: add two finite numbers.\nexport const add = (a, b) => a + b;\n', after}], pr.base.sha);
  const result = await runModel(bundle, process.argv[2]);
  const actual = result.raw ? JSON.parse(result.raw).verdict : null;
  console.log(JSON.stringify({fixture: name, expected, actual, status: result.status, model: result.model,
    attempts: result.attempts, decision: result.raw ? JSON.parse(result.raw) : null, synthetic: true, githubWrites: 0}));
  if (result.status !== 'reviewed' || actual !== expected) failed = true;
}
if (failed) process.exitCode = 1;

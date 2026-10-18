import test from 'node:test';
import assert from 'node:assert/strict';
import {GhCliProvider, SpawnGhCommandRunner} from '../dist/index.js';

const context = () => ({signal: new AbortController().signal, deadline: new Date(Date.now() + 10000).toISOString()});
const command = (script, overrides = {}) => ({args: ['-e', script], token: 'explicit-synthetic-token', maxBytes: 1048576, context: context(), ...overrides});
const emit = bytes => `process.stdout.write(Buffer.from('${bytes.toString('hex')}', 'hex'))`;
const issue = {number: 8, title: 'Synthetic issue', body: 'Synthetic body', state: 'open', labels: [],
  html_url: 'https://github.com/example/repository/issues/8', updated_at: '2026-10-06T00:00:00Z'};
function syntheticTransport(responses) {
  const runner = new SpawnGhCommandRunner(process.execPath, {}), calls = [];
  const provider = new GhCliProvider({repositories: ['example/repository'], readToken: async () => 'explicit-synthetic-token',
    runner: {run(request) {
      calls.push(request.args);
      const bytes = responses.shift();
      assert.ok(bytes, 'unexpected synthetic GH command');
      return runner.run({...request, args: ['-e', emit(bytes)]});
    }}});
  return {provider, calls, dispose: () => runner.dispose()};
}

test('actual subprocess preserves split Unicode stdout and stderr and BOM bytes', async () => {
  const runner = new SpawnGhCommandRunner(process.execPath, {});
  try {
    const text = '\ufeff中文🙂';
    const bytes = Buffer.from(text);
    const script = `const b=Buffer.from('${bytes.toString('hex')}','hex');process.stdout.write(b.subarray(0,4));process.stderr.write(b.subarray(0,5));setTimeout(()=>{process.stdout.write(b.subarray(4));process.stderr.write(b.subarray(5));},20)`;
    assert.deepEqual(await runner.run(command(script)), {exitCode: 0, stdout: text, stderr: text});
  } finally {runner.dispose();}
});

for (const stream of ['stdout', 'stderr']) test(`actual subprocess rejects invalid UTF-8 ${stream} without disclosing content`, async () => {
  const runner = new SpawnGhCommandRunner(process.execPath, {});
  try {
    await assert.rejects(runner.run(command(`process.${stream}.write(Buffer.from([0xc3,0x28]))`)),
      error => error.code === 'EXTERNAL_FAILURE' && error.message === 'GitHub CLI output encoding invalid');
  } finally {runner.dispose();}
});

test('public provider rejects synthetic issue JSON containing invalid UTF-8', async () => {
  const bytes = Buffer.from(JSON.stringify({...issue, body: 'PLACEHOLDER'})), offset = bytes.indexOf('PLACEHOLDER');
  const transport = syntheticTransport([Buffer.concat([bytes.subarray(0, offset), Buffer.from([0xc3, 0x28]), bytes.subarray(offset + 11)])]);
  try {
    await assert.rejects(transport.provider.execute('issue.get', {repo: 'example/repository', number: 8}, context()),
      error => error.code === 'EXTERNAL_FAILURE');
    assert.equal(transport.calls.length, 1);
  } finally {transport.dispose();}
});

test('invalid synthetic write response after dispatch remains unknown with exactly one POST', async () => {
  const invalid = Buffer.concat([Buffer.from('{"id":9,"html_url":"https://github.com/example/repository/issues/8#issuecomment-'), Buffer.from([0xc3, 0x28]), Buffer.from('"}')]);
  const transport = syntheticTransport([Buffer.from(JSON.stringify(issue)), invalid]);
  try {
    assert.deepEqual(await transport.provider.execute('issue.comment', {repo: 'example/repository', number: 8, body: 'Synthetic comment'}, context()),
      {state: 'unknown', evidenceRefs: []});
    assert.equal(transport.calls.length, 2);
    assert.equal(transport.calls.filter(args => args[args.indexOf('--method') + 1] === 'POST').length, 1);
  } finally {transport.dispose();}
});

test('actual subprocess enforces the combined stdout and stderr byte budget', async () => {
  const runner = new SpawnGhCommandRunner(process.execPath, {});
  try {
    await assert.rejects(runner.run(command("process.stdout.write('12345');process.stderr.write('67890')", {maxBytes: 9})),
      error => error.code === 'EXTERNAL_FAILURE' && error.message === 'GitHub response exceeded byte limit');
  } finally {runner.dispose();}
});

test('actual subprocess cancellation retains CANCELLED instead of decoding partial output', async () => {
  const runner = new SpawnGhCommandRunner(process.execPath, {}), controller = new AbortController();
  try {
    const pending = runner.run(command('setInterval(()=>{},1000)', {context: {...context(), signal: controller.signal}}));
    const rejected = assert.rejects(pending, error => error.code === 'CANCELLED');
    controller.abort();
    await rejected;
  } finally {runner.dispose();}
});

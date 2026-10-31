import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, rm, writeFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';
import {locateTestFailures} from '../dist/test-locate/locate.js';

for(const name of ['broken.mjs','broken.cjs'])test(`actual fixed Node syntax check localizes ${name} without reading snippets`,async()=>{
  const root=await mkdtemp(path.join(os.tmpdir(),'pa-f17-node-check-'));
  try{
    await writeFile(path.join(root,name),'function broken( {\n');
    const execution=spawnSync(process.execPath,['--check',name],{cwd:root,encoding:'utf8'});
    assert.equal(execution.status,1);assert.match(execution.stderr,/SyntaxError/);
    const report=locateTestFailures(execution.stderr,{root,maxSnippetReads:0});
    assert.equal(report.totalFailures,1);assert.equal(report.failures[0].reporter,'node-check');
    assert.equal(report.failures[0].frames[0].file,name);assert.ok(report.failures[0].frames[0].line>0);
    assert.equal(report.failures[0].frames[0].snippet,undefined);
    for(const incomplete of ['SyntaxError: invented',execution.stderr.replace(/SyntaxError:/u,'Error:'),
      execution.stderr.replace(/node:internal\/main\/check_syntax/gu,'untrusted:check')])
      assert.equal(locateTestFailures(incomplete,{root}).totalFailures,0);
  }finally{await rm(root,{recursive:true,force:true});}
});

async function repo() {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'pa-test-locate-'));
  await writeFile(path.join(directory, 'src', 'calc.js').replace(/[/\\]src[/\\]calc\.js$/, ''), '', {flag: 'wx'}).catch(() => {});
  const {mkdir} = await import('node:fs/promises');
  await mkdir(path.join(directory, 'src'), {recursive: true});
  await writeFile(path.join(directory, 'src', 'calc.js'), 'export function add(a, b) {\n  return a - b;\n}\n');
  return directory;
}

test('spec output maps failure frames to repo files with snippets and confidence', async () => {
  const root = await repo();
  try {
    const output = [
      '▶ suite',
      '✖ adds numbers (12.3ms)',
      '  AssertionError [ERR_ASSERTION]: expected 1 to be 2',
      '      at TestContext.<anonymous> (src/calc.test.mjs:7:5)',
      '      at add (src/calc.js:2:10)',
      '      at node:internal/test_runner/runner:99:1',
      'ℹ tests 1',
      'ℹ pass 0',
      'ℹ fail 1',
      '✖ failing tests:',
      '',
      'test at src\\calc.test.mjs:7:1',
      '✖ adds numbers (12.3ms)',
      '  AssertionError: expected 1 to be 2',
      '',
    ].join('\n');
    const report = locateTestFailures(output, {root, allowedPaths: ['src']});
    assert.equal(report.totalFailures, 1);
    const failure = report.failures[0];
    assert.equal(failure.name, 'adds numbers');
    assert.equal(failure.reporter, 'spec');
    assert.match(failure.error, /expected 1 to be 2/);
    assert.equal(failure.timedOut, false);
    assert.equal(failure.frames.length, 2);
    assert.deepEqual(failure.frames.map(f => f.file), ['src/calc.test.mjs', 'src/calc.js']);
    assert.equal(failure.frames[0].line, 7);
    assert.equal(failure.frames[0].column, 5);
    assert.ok(failure.frames[0].confidence >= failure.frames[1].confidence);
    // Internal frames are dropped; snippets appear only for readable repo files.
    assert.equal(failure.frames.some(f => f.file.includes('node:internal')), false);
    assert.equal(failure.frames.some(f => f.file.includes('node_modules')), false);
    assert.equal(failure.frames[0].snippet, undefined); // fixture repo has no calc.test.mjs
    assert.match(failure.frames[1].snippet ?? '', /^> 2 .*return a - b;/m);
  } finally {
    await rm(root, {recursive: true, force: true});
  }
});

test('TAP output parses failures, dedupes frames and flags timeouts', () => {
  const output = [
    'TAP version 13',
    'ok 1 - passes',
    'not ok 2 - slow thing # Timeout',
    '    ---',
    '    error: Test timed out after 5000ms',
    '      at async run (file:///repo/src/slow.mjs:42)',
    '      at async run (file:///repo/src/slow.mjs:42)',
    '    ...',
  ].join('\n');
  const report = locateTestFailures(output, {root: process.cwd()});
  assert.equal(report.totalFailures, 1);
  const failure = report.failures[0];
  assert.equal(failure.reporter, 'tap');
  assert.equal(failure.name, 'slow thing');
  assert.equal(failure.timedOut, true);
  assert.equal(failure.frames.length, 1);
  assert.equal(failure.frames[0].line, 42);
  assert.equal(failure.frames[0].column, undefined);
  assert.ok(failure.frames[0].confidence < 1); // timeouts and test files are discounted
});

test('frames without columns and outside-repo files are handled', () => {
  const output = [
    '✖ weird case (3ms)',
    '  Error: boom',
    '      at fn (/elsewhere/x.js:9)',
    '      at fn2 (src/a.ts:4)',
  ].join('\n');
  const report = locateTestFailures(output, {root: process.cwd()});
  const failure = report.failures[0];
  assert.equal(failure.frames.length, 2);
  assert.equal(failure.frames[1].column, undefined);
  // Outside-root paths are preserved verbatim rather than dropped.
  assert.equal(failure.frames[0].file, '/elsewhere/x.js');
  assert.equal(failure.frames[1].file, 'src/a.ts');
});

test('no failures yields an empty report instead of an error', () => {
  const report = locateTestFailures('ℹ tests 4\nℹ pass 4\nℹ fail 0\n');
  assert.deepEqual(report.failures, []);
  assert.equal(report.totalFailures, 0);
});

test('duplicate summary and detail blocks collapse to one failure', () => {
  const output = [
    '✖ dup (1ms)',
    '✖ failing tests:',
    '✖ dup (1ms)',
    '  Error: same',
  ].join('\n');
  const report = locateTestFailures(output);
  assert.equal(report.totalFailures, 1);
  assert.equal(report.failures[0].name, 'dup');
});

test('oversized input and invalid options are rejected', async () => {
  assert.throws(() => locateTestFailures('x'.repeat(64), {maxInputBytes: 8}), /byte limit/u);
  assert.throws(() => locateTestFailures('ok', {contextLines: 99}), /context/u);
  assert.throws(() => locateTestFailures(42), /string/u);
});

test('outside-root paths and symlink targets never become source snippets', async t => {
  const {mkdir,symlink} = await import('node:fs/promises');
  const base = await mkdtemp(path.join(os.tmpdir(), 'pa-locate-boundary-'));
  const root = path.join(base,'repo');
  await mkdir(root);
  const outside = path.join(base,'outside.js');
  await writeFile(outside,'const syntheticPrivateMarker = true;\n');
  try {
    for (const file of [outside,'../outside.js',pathToFileURL(outside).href]) {
      const report = locateTestFailures(`✖ outside (1ms)\n  Error: synthetic\n      at fn (${file}:1:1)`,{root});
      assert.equal(report.failures[0].frames.length,1);
      assert.equal(report.failures[0].frames[0].snippet,undefined);
      assert.doesNotMatch(JSON.stringify(report),/syntheticPrivateMarker/);
    }
    try { await symlink(outside,path.join(root,'linked.js')); }
    catch(error) {
      if(process.platform === 'win32' && ['EPERM','EACCES'].includes(error.code)) {
        t.diagnostic('Symlink scenario unavailable without Windows link permission'); return;
      }
      throw error;
    }
    const report = locateTestFailures('✖ link (1ms)\n  Error: synthetic\n      at fn (linked.js:1:1)',{root,allowedPaths:['linked.js']});
    assert.equal(report.failures[0].frames[0].snippet,undefined);
  } finally { await rm(base,{recursive:true,force:true}); }
});

test('source files beyond the snippet byte limit retain their frame without reading a snippet', async () => {
  const root = await repo();
  try {
    await writeFile(path.join(root,'large.js'),'x'.repeat(1024*1024+1));
    const report = locateTestFailures('✖ large (1ms)\n      at fn (large.js:1:1)',{root,allowedPaths:['large.js']});
    assert.equal(report.failures[0].frames[0].file,'large.js');
    assert.equal(report.failures[0].frames[0].snippet,undefined);
  } finally { await rm(root,{recursive:true,force:true}); }
});

test('actual node TAP output locates multiline errors and nested failures with escaped file URLs', async () => {
  const root = await repo();
  try {
    const file = path.join(root,'actual failure.test.mjs');
    await writeFile(file,[
      "import test from 'node:test';",
      "import assert from 'node:assert/strict';",
      "test('nested suite', async t => {",
      "  await t.test('real failure', () => assert.equal(1,2));",
      "  await t.test('passing sibling', () => assert.equal(1,1));",
      "});",
    ].join('\n'));
    const environment = {...process.env};
    delete environment.NODE_TEST_CONTEXT;
    const run = spawnSync(process.execPath,['--test','--test-reporter=tap',file],{encoding:'utf8',env:environment});
    assert.equal(run.status,1,run.stderr);
    const report = locateTestFailures(run.stdout,{root,allowedPaths:['actual failure.test.mjs']});
    assert.equal(report.totalFailures,1,JSON.stringify(report));
    const failure = report.failures[0];
    assert.equal(failure.name,'real failure');
    assert.match(failure.error,/1 !== 2/);
    assert.equal(failure.frames[0].file,'actual failure.test.mjs');
    assert.equal(failure.frames[0].line,4);
    assert.match(failure.frames[0].snippet,/assert.equal\(1,2\)/);
    assert.equal(failure.frames.some(frame=>frame.file.includes('node:internal')),false);
  } finally { await rm(root,{recursive:true,force:true}); }
});

test('allowedPaths denies snippet reads outside trusted prefixes and the read budget stops further opens', async () => {
  const root = await repo();
  try {
    await writeFile(path.join(root, 'src/private.js'), 'export const secret = "do-not-project-this";' + String.fromCharCode(10));
    const output = [
      '✖ case one (1ms)', '  Error: boom one', '      at one (src/private.js:1:1)', '      at two (src/calc.js:1:1)',
      '✖ case two (1ms)', '  Error: boom two', '      at three (src/calc.js:1:1)',
    ].join(String.fromCharCode(10));
    const denied = locateTestFailures(output, {root, allowedPaths: ['src/calc.js'], maxSnippetReads: 1});
    const privateFrame = denied.failures.find(f => f.name === 'case one').frames.find(fr => fr.file === 'src/private.js');
    assert.equal(privateFrame.snippet, undefined, 'restricted path must not be read');
    const snippets = denied.failures.flatMap(f => f.frames).filter(fr => fr.snippet !== undefined);
    assert.equal(snippets.length, 1, 'read budget caps opens');
    assert.ok(!JSON.stringify(denied).includes('do-not-project-this'));
    const none = locateTestFailures(output, {root, allowedPaths: [], contextLines: 2});
    assert.ok(none.failures.flatMap(f => f.frames).every(fr => fr.snippet === undefined), 'empty allowlist reads nothing');
  } finally { await rm(root, {recursive: true, force: true}); }
});

test('missing read policy and aliases into private source never expose snippets',async t=>{
  const {mkdir,symlink}=await import('node:fs/promises');
  const root=await repo();
  try {
    await mkdir(path.join(root,'private'));await writeFile(path.join(root,'private','secret.js'),'const marker = "restricted-alias-marker";');
    const output='✖ private (1ms)\n  Error: synthetic\n      at fn (private/secret.js:1:1)';
    assert.equal(locateTestFailures(output,{root}).failures[0].frames[0].snippet,undefined);
    try {await symlink(path.join(root,'private','secret.js'),path.join(root,'src','alias.js'));}
    catch(error){if(process.platform==='win32'&&error?.code==='EPERM'){t.diagnostic('Windows account lacks symlink creation privilege');return;}throw error;}
    const aliased=locateTestFailures('✖ alias (1ms)\n      at fn (src/alias.js:1:1)',{root,allowedPaths:['src']});
    assert.equal(aliased.failures[0].frames[0].snippet,undefined);
    assert.equal(JSON.stringify(aliased).includes('restricted-alias-marker'),false);
  } finally {await rm(root,{recursive:true,force:true});}
});

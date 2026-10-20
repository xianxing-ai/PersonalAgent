import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';

test('MCP workspace resolves the original reporter and retains file exit/cause evidence',t=>{
  const workspace=fileURLToPath(new URL('../../packages/mcp/',import.meta.url));
  const command=JSON.parse(readFileSync(path.join(workspace,'package.json'),'utf8')).scripts.test.split(' ');
  assert.equal(command.shift(),'node');assert.equal(command.pop(),'test/*.test.mjs');
  assert.ok(command.includes('--test'));
  assert.equal(command.some(value=>value.startsWith('--test-concurrency')||value.startsWith('--test-name-pattern')),false);
  const directory=mkdtempSync(path.join(tmpdir(),'mcp-failure-reporter-'));t.after(()=>rmSync(directory,{recursive:true,force:true}));
  const env={...process.env};delete env.NODE_TEST_CONTEXT;
  for(const [name,source,expected] of [
    ['file-exit',"process.exit(7);",/exitCode: 7/],
    ['assertion',"import test from 'node:test';import assert from 'node:assert/strict';test('synthetic diagnostic',()=>assert.equal(1,2));",/ERR_ASSERTION/],
  ]){
    const file=path.join(directory,name+'.test.mjs');writeFileSync(file,source);
    const result=spawnSync(process.execPath,[...command,file],{cwd:workspace,encoding:'utf8',timeout:10_000,windowsHide:true,env});
    assert.equal(result.error,undefined);assert.notEqual(result.status,0);
    assert.match(result.stderr,/node:test failure/);assert.match(result.stderr,expected);
    assert.match(result.stdout,/fail 1/);
  }
});

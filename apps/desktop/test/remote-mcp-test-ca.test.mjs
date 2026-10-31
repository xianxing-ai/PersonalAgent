import assert from 'node:assert/strict';
import test from 'node:test';
import {scopeSyntheticCa} from './remote-mcp-test-ca.mjs';

test('synthetic CA dispatcher is applied only to the exact approved loopback URL',async()=>{
  const target='https://127.0.0.1:1234/mcp',dispatcher={},calls=[];
  const fetch=scopeSyntheticCa(target,dispatcher,async(url,init)=>{calls.push({url,init});});
  const original={method:'POST',redirect:'error'};
  await fetch(target,original);
  await fetch('https://127.0.0.1:1234/other',original);
  await fetch('https://example.org/mcp',original);
  assert.equal(calls[0].init.dispatcher,dispatcher);
  assert.equal(calls[1].init,original);
  assert.equal(calls[2].init,original);
  assert.equal(Object.hasOwn(original,'dispatcher'),false);
});

test('a second synthetic endpoint does not expand trust to other loopback ports',async()=>{
  const targets=['https://127.0.0.1:1234/mcp','https://127.0.0.1:5678/mcp'],dispatcher={},calls=[];
  const fetch=scopeSyntheticCa(targets,dispatcher,async(url,init)=>{calls.push({url,init});});
  const original={method:'POST'};for(const url of [...targets,'https://127.0.0.1:9999/mcp'])await fetch(url,original);
  assert.equal(calls[0].init.dispatcher,dispatcher);assert.equal(calls[1].init.dispatcher,dispatcher);assert.equal(calls[2].init,original);
});

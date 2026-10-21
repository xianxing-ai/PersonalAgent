import test from 'node:test';
import assert from 'node:assert/strict';
import {runLayaSmokeBootstrap} from './laya-settings-bootstrap.cjs';

test('Synthetic bootstrap installs the guard before Main captures fetch', async () => {
  const calls = [];
  const target = {fetch:async (input, options) => {
    calls.push({input, options});
    return {ok:true, clone:() => ({json:async () => ({status:'ok', model:'multilingual',
      warmed:true, device:'cpu', inferenceCalls:0, privateField:'must not enter receipt'})})};
  }};
  let captured;
  await runLayaSmokeBootstrap(async () => {captured = target.fetch;}, target);
  target.fetch = () => {throw Error('later replacement must not affect the captured request');};
  await captured('http://127.0.0.1:8766/health', {headers:{authorization:'Bearer Synthetic-only'}});
  assert.equal(calls.length, 1);
  assert.equal(calls[0].options.headers.authorization, 'Bearer Synthetic-only');
  assert.deepEqual(target.layaSmokeNetwork, {health:1, blocked:0, receipts:[{
    status:'ok', model:'multilingual', warmed:true, device:'cpu', inferenceCalls:0}]});
  assert.doesNotMatch(JSON.stringify(target.layaSmokeNetwork), /Bearer|privateField|Synthetic-only/);
});

test('Synthetic bootstrap refuses external, inference and credential-bearing URLs before fetch', async () => {
  let requests = 0;
  const target = {fetch:async () => {requests++; throw Error('must not reach transport');}};
  await runLayaSmokeBootstrap(async () => {}, target);
  for (const url of ['https://example.invalid/health', 'http://127.0.0.1:8766/predict',
    'http://127.0.0.1:8766/health?secret=value', 'http://private@127.0.0.1:8766/health']) {
    await assert.rejects(target.fetch(url), /Only the original local health check/);
  }
  await assert.rejects(target.fetch('http://127.0.0.1:8766/health', {method:'POST'}), /Only the original local health check/);
  assert.equal(requests, 0);
  assert.deepEqual(target.layaSmokeNetwork, {health:0, blocked:5, receipts:[]});
});

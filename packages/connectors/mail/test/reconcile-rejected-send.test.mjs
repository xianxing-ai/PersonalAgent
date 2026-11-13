import test from 'node:test';
import assert from 'node:assert/strict';
import {FakeMailProvider, MailService} from '../dist/index.js';

const input = {to: 'fixture@example.invalid', subject: 'fixture', text: 'fixture', idempotencyKey: 'original'};
const messageId = '<original@example.invalid>';

test('rejected original send can be read back only after identity verification, without resending', async () => {
  const provider = new FakeMailProvider();
  let sends = 0, reads = 0;
  provider.send = async () => {sends++; throw Error('fixture transport lost');};
  provider.assertSendIdentity = (account, message, key) => {
    assert.deepEqual([account, message, key], ['fixture', messageId, 'original']);
  };
  provider.reconcileSend = async () => {reads++; return {state: 'confirmed', messageId};};
  const service = new MailService(provider, {now: Date.now});
  await assert.rejects(service.send('fixture', input));
  const result = await service.reconcileSend('fixture', messageId, 'original');
  assert.equal(result.state, 'confirmed');
  assert.equal(result.externalId, messageId);
  await assert.rejects(service.send('fixture', input));
  assert.equal(sends, 1);
  assert.equal(reads, 1);
});

test('rejected send without trusted identity binding fails closed before readback', async () => {
  const provider = new FakeMailProvider();
  let reads = 0;
  provider.send = async () => {throw Error('fixture transport lost');};
  provider.reconcileSend = async () => {reads++; return {state: 'confirmed', messageId};};
  const service = new MailService(provider, {now: Date.now});
  await assert.rejects(service.send('fixture', input));
  await assert.rejects(service.reconcileSend('fixture', messageId, 'original'), {code: 'UNSUPPORTED_CAPABILITY'});
  assert.equal(reads, 0);
});

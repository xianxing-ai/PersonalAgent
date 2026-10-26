import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, rmSync, writeFileSync, readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createLiveHistoryQueue} from '../electron/live-history-queue.js';
import {createLiveHistoryFileStore} from '../electron/live-history-file-store.js';
import {Conversations} from '../electron/conversations.js';

const message = (id, text = `合成话语 ${id}`) => ({id, sessionId: 'synthetic-session', role: 'user', text,
  createdAt: '2026-09-30T10:00:00.000Z'});

test('recovery retains more than the UI window, persists revisions and deduplicates across ack crash', () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'live-history-'));
  try {
    const store = createLiveHistoryFileStore(path.join(directory, 'recovery.json'));
    const queue = createLiveHistoryQueue({store});
    for (let i = 0; i < 40; i++) queue.enqueue(message(String(i)));
    queue.enqueue(message('0', '修订后的合成话语'));
    queue.flush(() => {throw Error('synthetic storage failure');});
    assert.equal(queue.snapshot().pending, 40);
    assert.equal(queue.snapshot().durable, true);
    const conversations = new Conversations(path.join(directory, 'conversation.json'));
    const restarted = createLiveHistoryQueue({store});
    let preventAck = true;
    const failedAckStore = {read: store.read, write(values) {if (preventAck && values.length === 0) throw Error(); store.write(values);}};
    const ackCrash = createLiveHistoryQueue({store: failedAckStore});
    ackCrash.flush(value => conversations.addLiveMessage(value));
    assert.equal(ackCrash.snapshot().degraded, true);
    assert.equal(conversations.messagesFor('panel').length, 40);
    preventAck = false;
    restarted.flush(value => conversations.addLiveMessage(value));
    assert.equal(conversations.messagesFor('panel').length, 40);
    assert.equal(conversations.messages.get('0').text, '修订后的合成话语');
    assert.deepEqual(store.read(), []);
    assert.equal(restarted.snapshot().degraded, false);
    conversations.close();
  } finally {rmSync(directory, {recursive: true, force: true});}
});

test('queue overflow rejects explicitly without deleting earlier pending records', () => {
  const queue = createLiveHistoryQueue({maxMessages: 2});
  queue.enqueue(message('a')); queue.enqueue(message('b'));
  assert.throws(() => queue.enqueue(message('c')), /容量已满/);
  assert.deepEqual(queue.messages().map(value => value.id), ['a', 'b']);
  assert.equal(queue.snapshot().rejected, 1);
  assert.equal(queue.snapshot().durable, false);
});

test('unreadable cache is preserved and later recovery merges memory without overwriting disk', () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'live-history-corrupt-'));
  try {
    const file = path.join(directory, 'recovery.json');
    writeFileSync(file, 'synthetic-corrupt');
    const store = createLiveHistoryFileStore(file);
    const queue = createLiveHistoryQueue({store});
    queue.enqueue(message('new'));
    queue.flush(() => assert.fail('must not bypass unreadable recovery'));
    assert.equal(readFileSync(file, 'utf8'), 'synthetic-corrupt');
    writeFileSync(file, JSON.stringify({version: 1, messages: [message('old')]}));
    const saved = [];
    queue.flush(value => saved.push(value.id));
    assert.deepEqual(saved, ['old', 'new']);
    assert.equal(queue.snapshot().degraded, false);
  } finally {rmSync(directory, {recursive: true, force: true});}
});

test('reentrant revision is retained until its own acknowledgement', () => {
  const queue = createLiveHistoryQueue();
  queue.enqueue(message('a'));
  queue.flush(() => queue.enqueue(message('a', 'updated')));
  assert.equal(queue.snapshot().pending, 1);
  assert.equal(queue.messages()[0].text, 'updated');
  queue.flush(() => {});
  assert.equal(queue.snapshot().pending, 0);
});

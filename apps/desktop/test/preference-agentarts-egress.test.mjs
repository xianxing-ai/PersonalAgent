import assert from 'node:assert/strict';
import {mkdtemp, rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {Client} from '@personal-agent/client';
import {createAgentArtsRuntimeApplication} from '@personal-agent/runtime/application';
import {createMemoryLearningHost, filePreferenceStore} from '../electron/memory-learning-host.js';

test('a withdrawn preference stays absent from the serialized AgentArts request after reopening the store', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'pa-preference-egress-'));
  const store = filePreferenceStore(path.join(directory, 'preferences.json'));
  const open = () => createMemoryLearningHost({profile: 'huawei_ict_agentarts', privateMemory: {}, preferenceStore: store});
  let learning = open();
  const marker = 'SYNTHETIC_PREFERENCE_EGRESS';
  const goal = '公开合成验收。只回答一加一等于几。';
  const requests = [];
  const app = createAgentArtsRuntimeApplication({
    path: ':memory:', gatewayUrl: 'https://preference.invalid', runtimeName: 'synthetic-preference',
    authorizationProvider: {read: async () => 'Bearer synthetic'},
    readPromptPreferences: ({goal}) => learning.preferencePrompt(goal),
    coordinationInput: {beforeCoordinationSend: () => {}},
    fetchImpl: async (_url, init) => {
      requests.push(JSON.parse(init.body).query);
      return new Response(JSON.stringify([
        {event: 'message', data: {text: '二'}},
        {event: 'task_end'}, {event: 'end'},
      ]), {headers: {'content-type': 'application/json'}});
    },
  });
  try {
    const client = new Client(app);
    await client.connect();
    const run = async key => {
      const {taskId} = await client.call('task.submit', {goal, conversationId: 'synthetic-egress-' + key}, {idempotencyKey: key});
      for (let attempt = 0; attempt < 200 && app.activeTaskCount; attempt++) await new Promise(resolve => setTimeout(resolve, 5));
      assert.equal(app.runtime.getTask(taskId).state, 'succeeded');
    };
    const feedback = await learning.invoke('learning.feedback', {kind: 'correction', about: '公开合成验收', text: '回答公开合成验收时附上 ' + marker});
    await run('enabled');
    await learning.invoke('learning.preference.withdraw', {id: feedback.preferences[0].id});
    learning.close();
    learning = open();
    await run('withdrawn');
    assert.equal(requests.length, 2);
    assert.match(requests[0], new RegExp(marker));
    assert.doesNotMatch(requests[1], new RegExp(marker));
  } finally {
    learning.close();
    app.close();
    await rm(directory, {recursive: true, force: true});
  }
});

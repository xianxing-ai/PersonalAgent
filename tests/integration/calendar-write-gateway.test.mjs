import assert from 'node:assert/strict';
import test from 'node:test';
import {validateToolValue} from '@personal-agent/contracts';
import {ToolGateway} from '@personal-agent/tool-gateway';
import {register, FakeCalendarProvider} from '@personal-agent/calendar';

const NOW = Date.parse('2026-10-21T00:00:00.000Z');

test('calendar identifier schema rejects missing or ambiguous identifiers before authorization and execution', async () => {
  let authorizations = 0;
  let executions = 0;
  const gateway = new ToolGateway({now: () => NOW, policy: {
    authorize() {authorizations += 1; return {scopes: ['calendar:write']};},
  }});
  const provider = new FakeCalendarProvider();
  for (const name of ['updateEvent', 'cancelEvent']) {
    const original = provider.writes[name];
    provider.writes[name] = (...args) => {executions += 1; return original(...args);};
  }
  const unregister = register(gateway, {provider, accountRef: 'cal', now: () => NOW});
  try {
    for (const toolName of ['calendar.update', 'calendar.cancel']) {
      const descriptor = gateway.list().find(tool => tool.name === toolName);
      for (const args of [{}, {uid: 'event', externalId: 'event'}, {uid: 'event', externalId: 'other'}]) {
        assert.throws(() => validateToolValue(descriptor.inputSchema, args), {code: 'INVALID_ARGUMENT'});
        await assert.rejects(gateway.invoke({toolName, toolVersion: descriptor.version,
          arguments: args, taskId: 'task', runId: 'run', authorizationRef: 'authorization',
          deadline: new Date(NOW + 60_000).toISOString(), signal: new AbortController().signal}),
        {code: 'INVALID_ARGUMENT'});
      }
    }
    assert.equal(authorizations, 0, 'invalid identifiers must not consume authorization');
    assert.equal(executions, 0, 'invalid identifiers must not reach the provider');

    for (const alias of ['uid', 'externalId']) {
      const event = await provider.writes.createEvent({uid: `event-${alias}`, summary: 'before',
        startUtc: '2026-10-21T07:00:00.000Z', endUtc: '2026-10-21T08:00:00.000Z'});
      for (const toolName of ['calendar.update', 'calendar.cancel']) {
        const descriptor = gateway.list().find(tool => tool.name === toolName);
        const result = await gateway.invoke({toolName, toolVersion: descriptor.version,
          arguments: {[alias]: event.externalId, ...(toolName === 'calendar.update' ? {summary: 'after'} : {})},
          taskId: 'task', runId: `${alias}-${toolName}`, authorizationRef: 'authorization',
          deadline: new Date(NOW + 60_000).toISOString(), signal: new AbortController().signal});
        assert.equal(result.state, toolName === 'calendar.update' ? 'updated' : 'cancelled');
        if (toolName === 'calendar.update') assert.match(result.item.contentRef, /after/);
      }
    }
    assert.equal(authorizations, 4);
    assert.equal(executions, 4);
  } finally {unregister();}
});

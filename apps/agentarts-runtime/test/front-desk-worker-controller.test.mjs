import test from 'node:test';
import assert from 'node:assert/strict';
import {createFrontDeskWorkerController} from '../src/front-desk-worker-controller.mjs';
import {createImageServices} from '../src/image-services.mjs';

test('owned image lists workers and classifies surfaces', async () => {
  const controller = createFrontDeskWorkerController();
  const listed = await controller({value: {frontDeskWorkerVersion: 1, operation: 'list_workers'}});
  assert.equal(listed.frontDeskWorkerVersion, 1);
  assert.ok(listed.workers.some(item => item.workerId === 'worker-coder'));
  const surface = await controller({
    value: {frontDeskWorkerVersion: 1, operation: 'classify_surface', hasAssistantTurn: true, hasSubtaskParent: false},
  });
  assert.equal(surface.surface, 'assistant_chat');
  const allowed = await controller({
    value: {frontDeskWorkerVersion: 1, operation: 'assert_tool', surface: 'front_desk', toolName: 'weather.forecast'},
  });
  assert.equal(allowed.allowed, true);
  const denied = await controller({
    value: {frontDeskWorkerVersion: 1, operation: 'assert_tool', surface: 'assistant_chat', toolName: 'subagent.dispatch'},
  });
  assert.equal(denied.allowed, false);
});

test('image services expose frontDeskWorkerVersion controller', () => {
  const services = createImageServices();
  assert.equal(typeof services.controllers.frontDeskWorkerVersion, 'function');
  assert.equal(services.status().frontDeskWorker, 'builtin_unverified');
});

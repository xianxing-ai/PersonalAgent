import test from 'node:test';
import assert from 'node:assert/strict';
import {updateConversationTurns} from '../src/features/conversation/turn-view.js';

// updateConversationTurns already parses the incoming HTML into a detached staging element. The
// structural-change branch must adopt those nodes instead of assigning innerHTML again, which would
// parse the whole transcript a second time and throw away selection, focus and scroll anchoring.

const options = {pendingCancelIds: new Set(), cancelSelector: '[data-action="task.cancel"]', cancelAttribute: 'id'};

function child(id) {
  const node = {
    dataset: {turn: id},
    children: [],
    outerHTML: `<article class="task turn" data-turn="${id}">${id}</article>`,
    cloneNode() { return {outerHTML: node.outerHTML}; },
    querySelector() { return undefined; },
    replaceWith() { throw new Error('an unchanged turn must not be replaced'); },
  };
  return node;
}

function harness(t) {
  const originals = {document: globalThis.document};
  t.after(() => {
    for (const [key, value] of Object.entries(originals)) {
      if (value === undefined) delete globalThis[key];
      else globalThis[key] = value;
    }
  });
  const parsed = [];
  const staged = {children: [], innerHTML: ''};
  Object.defineProperty(staged, 'innerHTML', {
    get: () => staged.innerHTMLValue ?? '',
    set(value) {
      staged.innerHTMLValue = value;
      parsed.length = 0;
      staged.children = JSON.parse(value).map(id => {
        const node = child(id);
        parsed.push(node);
        return node;
      });
    },
  });
  globalThis.document = {createElement: () => staged};
  return {parsed, staged};
}

test('a changed turn count adopts the staged nodes instead of re-parsing the transcript', t => {
  const h = harness(t);
  const existing = [child('a'), child('b')];
  const container = {
    children: existing,
    innerHTMLWrites: 0,
    replaced: undefined,
    replaceChildren(...nodes) { container.replaced = nodes; container.children = nodes; },
  };
  Object.defineProperty(container, 'innerHTML', {
    get: () => '',
    set() { container.innerHTMLWrites++; },
  });

  updateConversationTurns(container, JSON.stringify(['a', 'b', 'c']), {...options, tasks: []});

  assert.equal(container.innerHTMLWrites, 0, 'the container must not re-parse the transcript');
  assert.deepEqual(container.replaced?.map(node => node.dataset.turn), ['a', 'b', 'c']);
  assert.equal(container.replaced[0], h.parsed[0], 'nodes come from the single staging parse');
  assert.equal(container.replaced[2], h.parsed[2]);
});

test('an unchanged turn list leaves every existing node untouched', t => {
  const h = harness(t);
  const existing = [child('a'), child('b')];
  const container = {
    children: existing,
    innerHTMLWrites: 0,
    replaced: undefined,
    replaceChildren(...nodes) { container.replaced = nodes; container.children = nodes; },
  };
  Object.defineProperty(container, 'innerHTML', {
    get: () => '',
    set() { container.innerHTMLWrites++; },
  });

  updateConversationTurns(container, JSON.stringify(['a', 'b']), {...options, tasks: []});

  assert.equal(container.innerHTMLWrites, 0);
  assert.equal(container.replaced, undefined, 'identical turns keep their DOM identity');
  assert.deepEqual(container.children, existing);
});

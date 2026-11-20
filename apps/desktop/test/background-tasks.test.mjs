import test from 'node:test';
import assert from 'node:assert/strict';
import {mountBackgroundTasks} from '../src/features/conversation/background-tasks.js';

function fixture(t, handler) {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'document');
  t.after(() => {if (original) Object.defineProperty(globalThis, 'document', original); else delete globalThis.document;});
  class Element {
    constructor(tag) {this.tag = tag; this.children = []; this.hidden = false; this.text = ''; this.style = {}; this.dataset = {};}
    set textContent(value) {this.text = String(value); this.children = [];}
    get textContent() {return (this.text || '') + this.children.map(child => child.textContent).join('');}
    set innerHTML(value) {throw Error(`Unexpected HTML interpolation: ${value}`);}
    append(...children) {this.children.push(...children);}
    replaceChildren(...children) {this.children = [...children];}
    setAttribute(name, value) {this.attrs = {...(this.attrs ?? {}), [name]: String(value)};}
    querySelector() {return undefined;}
  }
  const document = {head: new Element('head'), body: new Element('body'), createElement: tag => new Element(tag), querySelector: () => undefined};
  globalThis.document = document;
  const root = new Element('main');
  const calls = [];
  const ui = mountBackgroundTasks(root, async (name, payload) => {calls.push({name, payload}); return handler(name, payload);});
  return {ui, root, calls, section: root.children.find(child => child.className === 'background-tasks')};
}

test('background list renders safe text and reuses the subagent open action', async t => {
  const ui = fixture(t, () => ({items: [{parentTaskId: 'parent', taskId: 'child', subtaskId: 'notes', role: '<b>', goal: '写说明', state: 'running', queued: true, updatedAt: new Date().toISOString()}]}));
  await ui.ui.refresh();
  const section = ui.section;
  assert.match(section.textContent, /后台任务/);
  assert.match(section.textContent, /写说明/);
  assert.equal(section.textContent.includes('<b>'), true);
  assert.equal(section.children.some(child => child.tag === 'img'), false);
  const row = section.children.find(child => child.tag === 'ul').children[0];
  await row.children[0].onclick();
  assert.deepEqual(ui.calls.at(-1), {name: 'task.openSubagentConversation', payload: {parentTaskId: 'parent', taskId: 'child'}});
  await row.children.find(child => child.textContent === '停止').onclick();
  assert.equal(ui.calls.some(call => call.name === 'asyncSubagents.stop'), true);
});

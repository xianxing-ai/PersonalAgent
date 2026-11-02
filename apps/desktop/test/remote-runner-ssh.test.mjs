import test from 'node:test';
import assert from 'node:assert/strict';
import {sshArguments} from '../electron/remote-runner-host.js';
import {mountRemoteRunners} from '../src/features/conversation/remote-runners.js';

test('ssh arguments pin the host key and do not put secrets on the command line', () => {
  const args = sshArguments({port: 22, user: 'runner', address: '10.0.0.8'}, '/tmp/id', '/tmp/known_hosts');
  assert.ok(args.includes('StrictHostKeyChecking=yes'));
  assert.ok(args.includes('UserKnownHostsFile=/tmp/known_hosts'));
  assert.equal(args.some(item => /PRIVATE KEY|ghp_|runner-token/.test(item)), false);
  assert.deepEqual(args.slice(-2), ['node', '/opt/personal-agent-runner/remote-runner-service.mjs']);
});

test('remote runner panel lists hosts without rendering secrets', async t => {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'document');
  t.after(() => {if (original) Object.defineProperty(globalThis, 'document', original); else delete globalThis.document;});
  class Element {
    constructor(tag) {this.tag = tag; this.children = []; this.text = '';}
    set textContent(value) {this.text = String(value); this.children = [];}
    get textContent() {return (this.text || '') + this.children.map(child => child.textContent).join('');}
    append(...children) {this.children.push(...children);}
    replaceChildren(...children) {this.children = [...children];}
    setAttribute() {}
  }
  globalThis.document = {createElement: tag => new Element(tag)};
  const root = new Element('main');
  const ui = mountRemoteRunners(root, async () => ({hosts: [{id: 'h1', name: 'ecs-1', user: 'runner', address: '10.0.0.8', port: 22, provider: 'huawei-ecs', enabled: true, privateKey: 'SECRET-KEY'}], jobs: []}));
  await ui.refresh();
  assert.match(root.textContent, /ecs-1/);
  assert.equal(root.textContent.includes('SECRET-KEY'), false);
});

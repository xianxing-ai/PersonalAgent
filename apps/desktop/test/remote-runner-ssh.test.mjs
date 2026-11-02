import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync, readFileSync, writeFileSync} from 'node:fs';
import {dirname} from 'node:path';
import {EventEmitter} from 'node:events';
import {PassThrough} from 'node:stream';
import {createSshTransport, sshArguments} from '../electron/remote-runner-host.js';
import {mountRemoteRunners} from '../src/features/conversation/remote-runners.js';

test('ssh arguments pin the host key and do not put secrets on the command line', () => {
  const args = sshArguments({port: 22, user: 'runner', address: '10.0.0.8'}, '/tmp/id', '/tmp/known_hosts');
  assert.ok(args.includes('StrictHostKeyChecking=yes'));
  assert.ok(args.includes('UserKnownHostsFile=/tmp/known_hosts'));
  assert.equal(args.some(item => /PRIVATE KEY|ghp_|runner-token/.test(item)), false);
  assert.deepEqual(args.slice(-2), ['node', '/opt/personal-agent-runner/remote-runner-service.mjs']);
});

test('SSH creates a private temporary directory and cleans keys on close and partial preparation failure', async () => {
  const host = {port: 2222, user: 'runner', address: '10.0.0.8'};
  const session = await createSshTransport().connect(host, {privateKey: 'fixture-private-key', hostKey: 'ssh-ed25519 fixture'});
  const key = session.args[1];
  assert.equal(readFileSync(key, 'utf8'), 'fixture-private-key');
  const knownHosts = session.args.find(value => value.startsWith('UserKnownHostsFile=')).slice('UserKnownHostsFile='.length);
  assert.equal(readFileSync(knownHosts, 'utf8'), '[10.0.0.8]:2222 ssh-ed25519 fixture\n');
  session.close();
  session.close();
  assert.equal(existsSync(dirname(key)), false);
  let partialDirectory;
  await assert.rejects(createSshTransport({writeFile(file, value, options) {
    partialDirectory = dirname(file);
    if (file.endsWith('known_hosts')) throw new Error('fixture disk error');
    writeFileSync(file, value, options);
  }}).connect(host, {privateKey: 'fixture', hostKey: 'fixture'}), /fixture disk error/);
  assert.equal(existsSync(partialDirectory), false);
});

test('SSH cancellation kills only the local transport and reports an unknown remote result', async () => {
  let killed = 0;
  const child = new EventEmitter();
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.stdin = new PassThrough();
  child.kill = () => {killed += 1;};
  const transport = createSshTransport({spawn(_file, _args, options) {assert.equal(options.windowsHide, true); return child;}});
  const session = await transport.connect({port: 22, user: 'runner', address: '10.0.0.8'}, {privateKey: 'fixture', hostKey: 'fixture'});
  const abort = new AbortController();
  const result = session.exec({id: 'original'}, {signal: abort.signal, deadline: new Date(Date.now() + 10000).toISOString()});
  abort.abort();
  await assert.rejects(result, {code: 'RESULT_UNKNOWN'});
  session.close();
  assert.equal(killed, 1);
  assert.equal(existsSync(dirname(session.args[1])), false);
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

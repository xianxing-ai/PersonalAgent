import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync, readFileSync, writeFileSync} from 'node:fs';
import {dirname} from 'node:path';
import {EventEmitter} from 'node:events';
import {PassThrough} from 'node:stream';
import {createHash} from 'node:crypto';
import {createSshTransport, probeHostKey, sshArguments} from '../electron/remote-runner-host.js';
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
  const result = session.exec({id: 'original'}, {signal: abort.signal, deadline: new Date(Date.now() + 10000).toISOString(),assertBeforeSend(){}});
  abort.abort();
  await assert.rejects(result, {code: 'RESULT_UNKNOWN'});
  session.close();
  assert.equal(killed, 1);
  assert.equal(existsSync(dirname(session.args[1])), false);
});

test('SSH rejects missing or asynchronous final guards before writing any payload',async()=>{
  for(const guard of [undefined,async()=>{}]){
    let bytes=0;const child=new EventEmitter();child.stdout=new PassThrough();child.stderr=new PassThrough();child.stdin=new PassThrough();child.kill=()=>{};
    child.stdin.on('data',chunk=>{bytes+=chunk.length;});
    const session=await createSshTransport({spawn:()=>child}).connect({port:22,user:'runner',address:'runner.example'},
      {privateKey:'fixture',hostKey:'fixture'});
    try{await assert.rejects(session.exec({kind:'async-subagent',payload:{goal:'fixture'}},
      {signal:new AbortController().signal,deadline:new Date(Date.now()+10000).toISOString(),assertBeforeSend:guard}),{code:'UNAUTHORIZED'});
      assert.equal(bytes,0);
    }finally{session.close();}
  }
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

test('SSH transport applies key ACL hardening, captures redacted diagnostics, and probes host keys safely', async () => {
  const aclCalls = [];
  const child = new EventEmitter();
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.stdin = new PassThrough();
  child.kill = () => {};
  const session = await createSshTransport({
    securePath(target, opts) { aclCalls.push({target, isDirectory: Boolean(opts?.isDirectory)}); },
    spawn() {
      child.stdin.on('data', () => setImmediate(() => {
        child.stderr.write('Permission denied (publickey) fixture-private-key runner-secret-token-xyz\n');
        child.emit('close', 255);
      }));
      return child;
    },
  }).connect(
    {port: 22, user: 'root', address: '198.51.100.10'},
    {privateKey: 'fixture-private-key', runnerToken: 'runner-secret-token-xyz', hostKey: 'ssh-ed25519 AAAAC3fixture'},
  );
  try {
    assert.equal(aclCalls.some(c => c.isDirectory === true), true);
    assert.equal(aclCalls.some(c => c.isDirectory === false && c.target.endsWith('id')), true);
    let caught;
    try {
      await session.exec({kind: 'heartbeat', id: 'hb-1'}, {deadline: new Date(Date.now() + 10_000).toISOString()});
    } catch (error) { caught = error; }
    assert.ok(caught);
    assert.equal(caught.code, 'RESULT_UNKNOWN');
    assert.match(caught.message, /SSH 认证被拒绝/);
    assert.equal(caught.message.includes('fixture-private-key'), false);
    assert.equal(caught.message.includes('runner-secret-token-xyz'), false);
    assert.match(caught.message, /\[redacted\]/);
  } finally { session.close(); }

  await assert.rejects(probeHostKey({address: '-oProxyCommand=evil', port: 22}), {code: 'INVALID_ARGUMENT'});
  await assert.rejects(probeHostKey({address: '198.51.100.10', port: 70000}), {code: 'INVALID_ARGUMENT'});
  const probed = await probeHostKey({
    address: '198.51.100.10',
    port: 2222,
    async execFile(_cmd, args) {
      assert.ok(args.includes('-p') && args.includes('2222') && args.includes('198.51.100.10'));
      return {
        stdout: [
          '# comment',
          '[198.51.100.10]:2222 ssh-rsa AAAAB3NzaC1yc2EAAAfixture',
          '[198.51.100.10]:2222 ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIpreferred',
        ].join('\n'),
        stderr: '',
      };
    },
  });
  assert.equal(probed.keyType, 'ssh-ed25519');
  assert.equal(probed.hostKey, 'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIpreferred');
  assert.equal(probed.hostKeyFingerprint, createHash('sha256').update(probed.hostKey).digest('hex'));
});

test('remote runner panel probes host key, adds VPS safely clearing secrets, queries status, and removes host', async t => {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'document');
  t.after(() => {if (original) Object.defineProperty(globalThis, 'document', original); else delete globalThis.document;});
  class Element {
    constructor(tag) {this.tag = tag; this.children = []; this.value = ''; this.disabled = false; this.attrs = {};}
    set textContent(value) {this.text = String(value); this.children = [];}
    get textContent() {return (this.text ?? '') + this.children.map(child => child.textContent).join('');}
    set innerHTML(_) {throw Error('HTML interpolation is forbidden');}
    append(...children) {this.children.push(...children);}
    replaceChildren(...children) {this.children = children;}
    setAttribute(key, value) {this.attrs[key] = String(value);}
  }
  globalThis.document = {createElement: tag => new Element(tag)};
  const root = new Element('main');
  const all = (node = root) => [node, ...node.children.flatMap(child => all(child))];
  const button = name => all().find(node => node.tag === 'button' && node.textContent === name);
  const field = label => all().find(node => node.attrs['aria-label'] === label);

  let hosts = [];
  const calls = [];
  const ui = mountRemoteRunners(root, async (name, payload) => {
    calls.push({name, payload});
    if (name === 'runner.hosts.list') return {hosts, jobs: []};
    if (name === 'proactive.workflow.cloud.status') return {state: 'unavailable'};
    if (name === 'runner.hosts.probeKey') {
      return {ok: true, keyType: 'ssh-ed25519', hostKey: 'ssh-ed25519 AAAAC3test', hostKeyFingerprint: 'a'.repeat(64)};
    }
    if (name === 'runner.hosts.add') {
      hosts = [{id: 'vps-1', name: payload.name, user: payload.user, address: payload.address, port: payload.port, provider: payload.provider, enabled: true}];
      return {state: 'confirmed', record: hosts[0]};
    }
    if (name === 'runner.hosts.vpsStatus') {
      return {hostId: 'vps-1', hostName: 'my-vps', state: 'succeeded', receipt: {summary: 'VPS cloud-1 (x64) 运行中；云桌面状态：running', desktop: {httpsPort: 3001}}};
    }
    if (name === 'runner.hosts.remove') {
      hosts = [];
      return {removed: true, id: payload.id};
    }
    throw Error('Unexpected call ' + name);
  });
  t.after(() => ui.dispose());

  await ui.refresh();
  button('添加 VPS / 云电脑').onclick();
  field('主机名称').value = 'my-vps';
  field('主机地址').value = '198.51.100.20';
  field('SSH 端口').value = '22';
  field('SSH 用户名').value = 'root';
  await button('探测主机公钥').onclick();
  assert.equal(field('主机公钥').value, 'ssh-ed25519 AAAAC3test');
  assert.equal(field('公钥指纹').value, 'a'.repeat(64));

  const secretKey = '-----BEGIN OPENSSH PRIVATE KEY-----\nSECRET-BODY\n-----END OPENSSH PRIVATE KEY-----';
  const secretToken = 'secret-runner-token-0123456789abcdef0123456789abcdef';
  field('SSH 私钥').value = secretKey;
  field('执行器令牌').value = secretToken;
  await button('保存并启用 VPS').onclick();

  assert.equal(calls.find(c => c.name === 'runner.hosts.add').payload.privateKey, secretKey);
  assert.equal(field('添加 VPS 表单'), undefined);
  assert.match(root.textContent, /my-vps/);
  assert.equal(root.textContent.includes('SECRET-BODY'), false);
  assert.equal(root.textContent.includes(secretToken), false);

  await button('云电脑状态').onclick();
  assert.match(root.textContent, /云桌面状态：running/);
  assert.match(root.textContent, /ssh -N -L 3001:127\.0\.0\.1:3001 root@198\.51\.100\.20/);

  const copied = [];
  const origNav = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    value: {clipboard: {async writeText(value) {copied.push(value);}}},
  });
  try {
    await button('复制隧道命令').onclick();
    assert.deepEqual(copied, ['ssh -N -L 3001:127.0.0.1:3001 root@198.51.100.20']);
    assert.match(root.textContent, /已复制隧道命令/);
  } finally {
    if (origNav) Object.defineProperty(globalThis, 'navigator', origNav); else delete globalThis.navigator;
  }

  const beforeRefreshCalls = calls.filter(c => c.name === 'runner.hosts.list').length;
  button('刷新列表').onclick();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(calls.filter(c => c.name === 'runner.hosts.list').length, beforeRefreshCalls + 1);

  await button('移除主机').onclick();
  assert.equal(hosts.length, 0);
  assert.match(root.textContent, /还没有远端执行器/);
});

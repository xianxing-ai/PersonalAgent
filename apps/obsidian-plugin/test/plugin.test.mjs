import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import vm from 'node:vm';
import test from 'node:test';

const root = fileURLToPath(new URL('../', import.meta.url));
const nativeRequire = createRequire(import.meta.url);
function fixture() {
  const commands = [], events = [];
  class Plugin {addCommand(command) {commands.push(command);} registerEvent(event) {events.push(event);}}
  class Element {
    constructor(tag) {this.tag = tag; this.children = []; this.listeners = {}; this.value = '';}
    ownerDocument = {createElement: tag => new Element(tag)};
    appendChild(child) {this.children.push(child);}
    replaceChildren() {this.children = [];}
    setAttribute() {}
    addEventListener(name, listener) {this.listeners[name] = listener;}
    set innerHTML(_) {throw Error('HTML injection is forbidden');}
  }
  class Modal {
    constructor(app) {this.app = app; this.contentEl = new Element('div');}
    open() {this.onOpen();}
    close() {this.onClose();}
  }
  const module = {exports: {}};
  vm.runInNewContext(readFileSync(root + 'dist/main.js', 'utf8'), {module, exports: module.exports, AbortController, Buffer,
    require: id => id === 'obsidian' ? {Plugin, Modal, Notice: class {}}
      : id.startsWith('./') ? (() => {throw Error('Obsidian does not resolve plugin sidecar modules');})() : nativeRequire(id)});
  const file = {path: 'Allowed/a.md', stat: {mtime: 1, size: 6}};
  let body = 'needle', reads = 0, opened = [], cursor;
  const plugin = new module.exports();
  plugin.app = {vault: {getName: () => 'Synthetic vault', getMarkdownFiles: () => [file],
    getAbstractFileByPath: path => path === file.path ? file : path === 'Allowed' ? {children: [file]} : null,
    read: async () => {reads++; return body;}, on: name => ({name})},
    workspace: {getLeaf: () => ({openFile: async file => {opened.push(file.path);},
      view: {editor: {setCursor: value => {cursor = value;}}}})}};
  return {plugin, commands, events, file, opened, get reads() {return reads;}, get cursor() {return cursor;},
    edit(value) {body = value; file.stat.mtime++; file.stat.size = Buffer.byteLength(value);}};
}
const scope = () => ({deadline: new Date(Date.now() + 60000).toISOString(), signal: new AbortController().signal});

test('installable package loads without repository modules, binds explicitly and checks citations before opening', async () => {
  const manifest = JSON.parse(readFileSync(root + 'dist/manifest.json'));
  assert.equal(manifest.id, 'personal-agent-knowledge'); assert.equal(manifest.isDesktopOnly, true);
  const f = fixture(); await f.plugin.onload();
  assert.equal(f.reads, 0); assert.equal(f.plugin.port, undefined);
  assert.equal(f.commands.length, 4); assert.equal(f.events.length, 4);
  assert.throws(() => f.plugin.connect('../Allowed'));
  f.plugin.connect('Allowed');
  const hit = (await f.plugin.port.search({query: 'needle', limit: 20, ...scope()})).hits[0];
  await f.plugin.openCitation(hit.source, scope().signal);
  assert.deepEqual(f.opened, ['Allowed/a.md']); assert.equal(JSON.stringify(f.cursor), '{"line":0,"ch":0}');
  f.edit('changed'); await assert.rejects(f.plugin.openCitation(hit.source, scope().signal));
  assert.equal(f.opened.length, 1);
  assert.equal((await f.plugin.port.search({query: 'needle', limit: 20, ...scope()})).hits.length, 0);
  f.plugin.disconnect(); await assert.rejects(f.plugin.openCitation(hit.source, scope().signal));
  f.plugin.onunload(); assert.throws(() => f.plugin.connect('/'));
});

test('plugin revocation during a pending Vault read prevents navigation', async () => {
  const f = fixture(); await f.plugin.onload(); f.plugin.connect('/');
  const hit = (await f.plugin.port.search({query: 'needle', limit: 20, ...scope()})).hits[0];
  let finish; f.plugin.app.vault.read = () => new Promise(resolve => {finish = resolve;});
  const opening = f.plugin.openCitation(hit.source, scope().signal);
  f.plugin.disconnect(); finish('needle');
  await assert.rejects(opening, /撤销/); assert.deepEqual(f.opened, []);
});

test('packaged plugin modal selects scope, displays untrusted excerpts as text and clears windows on revocation', async () => {
  const f = fixture(); await f.plugin.onload();
  f.plugin.show(true);
  const connect = [...f.plugin.modals][0];
  connect.contentEl.children.find(el => el.tag === 'input').value = 'Allowed';
  await connect.contentEl.children.find(el => el.tag === 'button').listeners.click();
  assert.equal(f.plugin.modals.size, 0); assert.ok(f.plugin.port);
  f.edit('needle <img src=x onerror=alert(1)>');
  f.plugin.show(false);
  const search = [...f.plugin.modals][0];
  search.contentEl.children.find(el => el.tag === 'input').value = 'needle';
  await search.contentEl.children.find(el => el.tag === 'button').listeners.click();
  const output = search.contentEl.children.at(-1);
  assert.equal(output.children[0].textContent, 'needle <img src=x onerror=alert(1)>');
  await output.children[1].listeners.click(); assert.equal(f.opened.length, 1);
  f.plugin.disconnect(); assert.equal(f.plugin.modals.size, 0); assert.equal(search.request.signal.aborted, true);
  assert.deepEqual(search.contentEl.children, []);
});

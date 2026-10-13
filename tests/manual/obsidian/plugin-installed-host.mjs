import assert from 'node:assert/strict';
import {spawn, execFileSync} from 'node:child_process';
import {mkdirSync, mkdtempSync, writeFileSync, readFileSync, existsSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {verifyDesktopPairing} from './desktop-pairing.mjs';

// Explicit synthetic-only acceptance. No default executable, Vault or original Obsidian profile.
const args = process.argv.slice(2);
const dualProcess = args[2] === '--dual-process';
if (process.platform !== 'win32' || (args.length !== 2 && !(args.length === 3 && dualProcess)) || args[0] !== '--executable' || !path.isAbsolute(args[1])) {
  throw Error('Usage on Windows: node tests/manual/obsidian/plugin-installed-host.mjs --executable <Obsidian.exe> [--dual-process]');
}
const executable = args[1], cli = path.join(path.dirname(executable), 'Obsidian.com');
assert.ok(existsSync(executable) && existsSync(cli), 'Obsidian 1.12.7+ installer and CLI are required');
const otherProcesses = execFileSync('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command',
  '@(Get-Process -Name Obsidian -ErrorAction SilentlyContinue).Count'], {encoding: 'utf8', windowsHide: true});
assert.equal(Number(otherProcesses.trim()), 0, 'Refuse to route through another active Obsidian instance');
const workspace = fileURLToPath(new URL('../../../', import.meta.url));
const parent = path.join(workspace, '.cache', 'obsidian-installed-host'); mkdirSync(parent, {recursive: true});
const base = mkdtempSync(path.join(parent, 'case-')), profile = path.join(base, 'profile');
const vault = path.join(base, 'Synthetic-Plugin-Acceptance'), config = path.join(vault, '.obsidian');
const vaultId = '0011223344556677', pluginId = 'personal-agent-knowledge';
mkdirSync(profile); mkdirSync(path.join(vault, 'Allowed'), {recursive: true}); mkdirSync(config);
writeFileSync(path.join(vault, 'Allowed', 'note.md'), 'Synthetic GOO122 needle <img src=x onerror=alert(1)>\n');
writeFileSync(path.join(vault, 'Allowed', 'keep.md'), 'Synthetic preserved memory fixture\n');
writeFileSync(path.join(vault, 'unrelated.md'), 'Unrelated synthetic note must remain unchanged\n');
writeFileSync(path.join(config, 'core-plugins.json'), '[]');
writeFileSync(path.join(config, 'community-plugins.json'), '[]');
writeFileSync(path.join(profile, 'obsidian.json'), JSON.stringify({cli: true, updateDisabled: true,
  vaults: {[vaultId]: {path: vault, ts: Date.now(), open: true}}}));
const installScript = path.join(workspace, 'apps', 'obsidian-plugin', 'scripts', 'install.mjs');
console.log(execFileSync(process.execPath, [installScript, '--vault', vault], {encoding: 'utf8'}).trim());
let child;
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const outputs = [];
function command(name, ...parameters) {
  const result = execFileSync(cli, ['vault=' + vaultId, name, ...parameters, '--user-data-dir=' + profile],
    {encoding: 'utf8', timeout: 20000, windowsHide: true}).trim();
  outputs.push({command: name, result}); return result;
}
function evaluate(code) {
  const guard = `if(app.vault.adapter.getBasePath()!==${JSON.stringify(vault)})throw Error('Synthetic Vault binding mismatch');`;
  const result = command('eval', 'code=(async()=>{' + guard + code + '})()');
  const lines = result.split(/\r?\n/).map(line => line.replace(/^=> /, '')).filter(line => line.startsWith('{'));
  assert.ok(lines.length, 'CLI did not return the bounded JSON acceptance result: ' + result.slice(0,200));
  return JSON.parse(lines.at(-1));
}
function sensitiveCode() {
  // Never record code-bearing CLI output or include it in assertion/errors/evidence.
  try {
    const code = `if(app.vault.adapter.getBasePath()!==${JSON.stringify(vault)})throw Error();
      const p=app.plugins.getPlugin('${pluginId}');const m=[...p.modals].find(m=>m.contentEl.querySelector('input[type=password]'));
      return JSON.stringify({code:m.contentEl.querySelector('input[type=password]').value});`;
    const result = execFileSync(cli, ['vault=' + vaultId, 'eval', 'code=(()=>{' + code + '})()', '--user-data-dir=' + profile],
      {encoding: 'utf8', timeout: 20000, windowsHide: true, stdio: ['ignore', 'pipe', 'ignore']});
    const json = result.split(/\r?\n/).map(line => line.replace(/^=> /, '')).find(line => line.startsWith('{'));
    const value = JSON.parse(json).code; if (typeof value !== 'string' || !value.startsWith('PA2.')) throw Error();
    return value;
  } catch {throw Error('Synthetic plugin did not produce a valid private pairing code');}
}
async function waitForCli() {
  let startupError;
  for (let i = 0; i < 15; i++) {
    await pause(1000);
    try {if (evaluate("return JSON.stringify({bound:true});").bound) return;} catch (error) {startupError = error.message;}
  }
  throw Error('Isolated native Obsidian CLI did not become available: ' + startupError);
}
try {
  child = spawn(executable, ['--user-data-dir=' + profile], {stdio: 'ignore', windowsHide: true});
  child.on('error', error => {console.error(error.message);});
  await waitForCli();
  const version = command('version');
  command('plugins:restrict', 'off');
  await waitForCli(); // Restricted-mode changes reload the actual Obsidian window.
  command('dev:debug', 'on');
  command('plugin:enable', 'id=' + pluginId);
  command('dev:errors'); command('dev:console', 'level=error', 'limit=10');
  assert.deepEqual(evaluate(`const p=app.plugins.getPlugin('${pluginId}');return JSON.stringify({loaded:!!p,connected:!!p?.port});`),
    {loaded: true, connected: false});
  const connectedByUi = evaluate(`const p=app.plugins.getPlugin('${pluginId}');p.show(true);
    const m=[...p.modals][0];m.contentEl.querySelector('input').value='Allowed';m.contentEl.querySelector('button').click();
    return JSON.stringify({connected:!!p.port,windows:p.modals.size});`);
  assert.deepEqual(connectedByUi, {connected: true, windows: 0});
  const directSearch = evaluate(`try {const result=await app.plugins.getPlugin('${pluginId}').port.search({query:'needle',limit:20,
    deadline:new Date(Date.now()+10000).toISOString(),signal:new AbortController().signal});return JSON.stringify({hits:result.hits.length});}
    catch(error){return JSON.stringify({error:error.message,stack:error.stack});}`);
  assert.equal(directSearch.hits, 1, JSON.stringify(directSearch));
  const searched = evaluate(`const p=app.plugins.getPlugin('${pluginId}');p.show(false);const m=[...p.modals][0];
    m.contentEl.querySelector('input').value='needle';m.contentEl.querySelector('button').click();
    const output=m.contentEl.querySelector('div');
    for(let n=0;n<100&&!output.querySelector('button');n++)await new Promise(r=>setTimeout(r,25));
    if(!output.querySelector('button'))return JSON.stringify({missing:true,
      text:m.contentEl.textContent,children:[...m.contentEl.children].map(e=>({tag:e.tagName,text:e.textContent}))});
    return JSON.stringify({text:output.querySelector('p').textContent,images:output.querySelectorAll('img').length,
      label:output.querySelector('button').textContent});`);
  assert.equal(searched.images, 0, JSON.stringify(searched)); assert.ok(searched.text.includes('<img')); assert.equal(searched.label, 'Allowed/note.md:1');
  // CLI eval can read updated DOM before Electron's compositor paints the modal.
  evaluate(`await new Promise(requestAnimationFrame);await new Promise(requestAnimationFrame);return JSON.stringify({painted:true});`);
  const screenshot = path.join(base, 'plugin-search.png'); command('dev:screenshot', 'path=' + screenshot);
  const opened = evaluate(`const p=app.plugins.getPlugin('${pluginId}');
    const hit=(await p.port.search({query:'needle',limit:20,deadline:new Date(Date.now()+10000).toISOString(),signal:new AbortController().signal})).hits[0];
    window.__personalAgentSyntheticHit=hit;await p.openCitation(hit.source,new AbortController().signal);
    return JSON.stringify({path:app.workspace.getActiveFile()?.path});`);
  assert.equal(opened.path, 'Allowed/note.md');
  const pairingOffer = evaluate(`const p=app.plugins.getPlugin('${pluginId}');
    window.__personalAgentSyntheticPeer=p.createRuntimePairingPeer();
    const peer=window.__personalAgentSyntheticPeer,description=peer.describe();
    const result=await peer.search({query:'needle',limit:1,deadline:new Date(Date.now()+10000).toISOString(),signal:new AbortController().signal});
    return JSON.stringify({version:description.version,pluginId:description.pluginId,folder:description.folder,
      identityIsDigest:/^[a-f0-9]{64}$/.test(description.vaultIdentity),hits:result.hits.length});`);
  assert.deepEqual(pairingOffer, {version: 1, pluginId, folder: 'Allowed', identityIsDigest: true, hits: 1});
  const desktopPairing = dualProcess ? await verifyDesktopPairing({workspace, base, vault, evaluatePlugin: evaluate, sensitiveCode}) : undefined;
  const invalidated = evaluate(`const p=app.plugins.getPlugin('${pluginId}'),file=app.vault.getAbstractFileByPath('Allowed/note.md');
    await app.vault.modify(file,'Synthetic changed body');let denied=false;try{await p.openCitation(window.__personalAgentSyntheticHit.source,new AbortController().signal);}catch{denied=true;}
    const result=await p.port.search({query:'needle',limit:20,deadline:new Date(Date.now()+10000).toISOString(),signal:new AbortController().signal});
    p.disconnect();let peerDenied=false;try{window.__personalAgentSyntheticPeer.describe();}catch{peerDenied=true;}
    return JSON.stringify({denied,hits:result.hits.length,windows:p.modals.size,connected:!!p.port,peerDenied});`);
  assert.deepEqual(invalidated, {denied: true, hits: 0, windows: 0, connected: false, peerDenied: true});
  command('plugin:reload', 'id=' + pluginId);
  assert.equal(evaluate(`return JSON.stringify({connected:!!app.plugins.getPlugin('${pluginId}')?.port});`).connected, false);
  command('plugin:disable', 'id=' + pluginId);
  assert.equal(evaluate(`return JSON.stringify({loaded:!!app.plugins.getPlugin('${pluginId}')});`).loaded, false);
  for (let i = 0; i < 100; i++) {
    if (!JSON.parse(readFileSync(path.join(config, 'community-plugins.json'), 'utf8')).includes(pluginId)) break;
    await pause(50); // The host persists its enabled list asynchronously; never edit it ourselves.
  }
  console.log(execFileSync(process.execPath, [installScript, '--uninstall', '--vault', vault], {encoding: 'utf8'}).trim());
  assert.equal(readFileSync(path.join(vault, 'unrelated.md'), 'utf8'), 'Unrelated synthetic note must remain unchanged\n');
  const evidence = {state: 'verified', profile: 'huawei_ict_agentarts', source: 'synthetic', version,
    realObsidianHost: true, realCloud: false, cloudAttempts: 0, nativeUi: searched, citation: opened,
    invalidation: invalidated, pairingOffer, desktopPairing, crossProcessRuntimePairing: desktopPairing?.crossProcessRuntimePairing ?? false,
    screenshot: path.basename(screenshot), checks: outputs};
  writeFileSync(path.join(base, 'evidence.json'), JSON.stringify(evidence, null, 2));
  console.log('PASS: native Obsidian installed-plugin acceptance; evidence ' + base);
} finally {
  // Only the process started with our isolated profile is terminated. No global kill or user Vault cleanup.
  if (child && child.exitCode === null) child.kill();
  writeFileSync(path.join(base, 'cli-outputs.json'), JSON.stringify(outputs, null, 2));
}

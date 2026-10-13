import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {existsSync, mkdirSync, readFileSync, writeFileSync} from 'node:fs';
import path from 'node:path';
import {parseWikiCitationReference} from '@personal-agent/knowledge/wiki';

/** Actual Desktop composition; only synthetic source selection/native decisions are automated. */
export async function verifyDesktopPairing({workspace, base, vault, evaluatePlugin, sensitiveCode}) {
  const skillDirectory=path.join(base,'synthetic-paired-skill');mkdirSync(skillDirectory);
  const skillText='---\nname: synthetic-paired-skill\ndescription: Public synthetic pairing fixture\n---\nUse three short public bullet points.\n';
  writeFileSync(path.join(skillDirectory,'SKILL.md'),skillText);
  const require = createRequire(path.join(workspace, 'apps/desktop/package.json'));
  const {_electron} = require('playwright');
  const choices = ['apps/desktop/node_modules/electron/dist/electron.exe', 'node_modules/electron/dist/electron.exe'];
  const executablePath = choices.map(value => path.join(workspace, value)).find(existsSync);
  assert.ok(executablePath, 'Build/install the Desktop workspace first');
  // No inherited provider destinations, credentials or local profile; no cloud request is necessary.
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^(PA_|PANGU_|HUAWEI_|OPENAI_|ELECTRON_RUN_AS_NODE)/.test(key)));
  Object.assign(env, {PA_RUNTIME_PROFILE: 'huawei_ict_agentarts', PA_DESKTOP_TEST_USER_DATA: path.join(base, 'desktop'),
    PA_AGENTARTS_GATEWAY_URL: 'https://synthetic-pairing.huaweicloud-agentarts.com', PA_AGENTARTS_RUNTIME_NAME: 'synthetic-pairing'});
  let electron, admin;
  const invoke = (name, payload) => admin.evaluate(async ({name, payload}) => {
    const result = await window.desktop.invoke(name, payload);
    if (!result.ok) throw Error(result.error); return result.value;
  }, {name, payload});
  const wait = async predicate => {
    for (let i = 0; i < 160; i++) {const value = await predicate(); if (value) return value; await new Promise(resolve => setTimeout(resolve, 50));}
    throw Error('Synthetic Desktop pairing state did not become ready');
  };
  try {
    electron = await _electron.launch({executablePath, args: [path.join(workspace, 'apps/desktop')], env});
    const orb = await wait(() => electron.windows().find(page => page.url().includes('mode=orb')));
    await orb.evaluate(() => window.desktop.invoke('orb.open'));
    const panel = await wait(() => electron.windows().find(page => page.url().includes('mode=panel')));
    await panel.evaluate(() => window.desktop.invoke('admin.open', {page: 'memory'}));
    admin = await wait(() => electron.windows().find(page => page.url().includes('mode=admin')));
    await electron.evaluate(({dialog}, {vault,skillDirectory}) => {
      globalThis.__pairingCloudAttempts = 0;
      globalThis.__pairingConfirmationDetails = [];
      globalThis.__pairingMemoryDetails = []; globalThis.__pairingMemoryDecision = false;
      globalThis.fetch = async () => {globalThis.__pairingCloudAttempts++; throw Error('Synthetic acceptance forbids cloud calls');};
      dialog.showOpenDialog = async (_owner,options) => ({canceled: false,
        filePaths: [options.title==='选择包含 SKILL.md 的 Skill 文件夹'?skillDirectory:vault]});
      // Explicit Fake decision; the dedicated BrowserWindow and form below are real.
      dialog.showMessageBox = async (_owner, options) => {
        if(['安装 Skill','启用 Skill','卸载 Skill'].includes(options.title)) return {response:1}; // Explicit Fake Skill decisions.
        if (options.title === '确认 Obsidian 配对') globalThis.__pairingConfirmationDetails.push({
          defaultId: options.defaultId, cancelId: options.cancelId, bounded: !!options.signal,
          mentionsPrivate: options.detail.includes('私人'), mentionsReadonly: options.detail.includes('只读')});
        if(options.title==='确认私人记忆') {
          globalThis.__pairingMemoryDetails.push({defaultId:options.defaultId,cancelId:options.cancelId,
            bounded:!!options.signal,hasVersion:options.detail.includes('来源版本：'),
            hasExcerpt:options.detail.includes('摘录：Synthetic GOO122 needle')});
          return {response:globalThis.__pairingMemoryDecision ? 0 : 1};
        }
        return {response: 0};
      };
    }, {vault,skillDirectory});
    await wait(async () => {const result = await invoke('snapshot'); return result.privateMemory?.available;});
    const original = await invoke('knowledge.source.select'); assert.equal(original.available, true);
    await admin.waitForSelector('[data-knowledge-source="pair"]');
    const offered = evaluatePlugin("const tls=require('node:tls'),create=tls.createServer;window.__syntheticTlsErrors=[];tls.createServer=(...args)=>{const server=create(...args);server.on('tlsClientError',e=>window.__syntheticTlsErrors.push(e.code));return server;};const p=app.plugins.getPlugin('personal-agent-knowledge');await p.pairRuntime();return JSON.stringify({offered:!!p.bridge,passwordModal:[...p.modals].some(m=>!!m.contentEl.querySelector('input[type=password]')),notices:[...document.querySelectorAll('.notice')].map(n=>n.textContent)});");
    assert.equal(offered.offered, true, JSON.stringify(offered)); assert.equal(offered.passwordModal, true, JSON.stringify(offered));
    const code = sensitiveCode();
    await admin.locator('[data-knowledge-source="pair"]').click();
    const pairing = await wait(() => electron.windows().find(page => page.url().endsWith('/pairing/index.html')));
    assert.equal(await pairing.locator('#code').getAttribute('type'), 'password');
    assert.equal(await pairing.evaluate(() => typeof window.desktop), 'undefined');
    const isolation = await electron.evaluate(({BrowserWindow}) => {
      const window = BrowserWindow.getAllWindows().find(window => window.webContents.getURL().endsWith('/pairing/index.html'));
      const prefs = window.webContents.getLastWebPreferences();
      return {sandbox: prefs.sandbox, contextIsolation: prefs.contextIsolation, nodeIntegration: prefs.nodeIntegration};
    });
    assert.deepEqual(isolation, {sandbox: true, contextIsolation: true, nodeIntegration: false});
    try {
      await pairing.locator('#code').fill(code);
      await pairing.screenshot({path: path.join(base, 'desktop-pairing-input.png')}); // password remains masked
      await pairing.locator('button[type=submit]').click();
    } catch {throw Error('Synthetic private pairing form could not be submitted');}
    let paired;
    try {paired = await wait(async () => {const result = await invoke('snapshot'); return result.knowledgeSource?.pairing?.available && result;});}
    catch {
      const state = await invoke('snapshot');
      const uiStatus = await admin.locator('[data-knowledge-source="status"]').textContent();
      const confirmCount = await electron.evaluate(() => globalThis.__pairingConfirmationDetails.length);
      const plugin = evaluatePlugin("const p=app.plugins.getPlugin('personal-agent-knowledge');return JSON.stringify({aborted:p.bridge?.signal.aborted,tls:window.__syntheticTlsErrors,node:process.versions.node,openssl:process.versions.openssl});");
      const host = await electron.evaluate(() => ({node: process.versions.node, openssl: process.versions.openssl}));
      throw Error('Synthetic pairing failed: ' + JSON.stringify({pairing: state.knowledgeSource?.pairing, uiStatus, confirmCount, plugin,host}));
    }
    assert.equal(paired.knowledge.dataLevel, 'private'); assert.equal(paired.knowledge.writeAvailable, false);
    assert.equal(paired.knowledge.cloudExportAllowed, false); assert.notEqual(paired.knowledge.sourceId, original.sourceId);
    assert.equal((await invoke('skill.install')).enabled,false);
    const installed=(await invoke('snapshot')).installedSkills.items[0];
    const skillRef={name:installed.name,digest:installed.digest};
    await invoke('skill.enable',{...skillRef,enabled:true});
    assert.equal((await invoke('snapshot')).knowledgeSource.pairing.available,true);
    assert.match((await invoke('skill.preview',skillRef)).instructions,/three short public bullet points/);
    assert.equal(await admin.locator('[data-knowledge-source="submit"]').isDisabled(), true);
    const hits = await invoke('knowledge.search', {query: 'needle', limit: 5});
    assert.equal(hits.hits.length, 1); assert.equal(hits.hits[0].source.path, 'Allowed/note.md');
    assert.equal(hits.hits[0].source.vaultId, paired.knowledge.sourceId);
    const tasks = await invoke('snapshot');
    assert.equal(tasks.privateMemory.vaultSelected,true);
    assert.equal(await admin.locator('#memory-query').isDisabled(),false);
    // Actual admin form and native-dialog composition; only the synthetic content decision is Fake.
    const searchMemory = async query => {
      await admin.locator('#memory-query').fill(query);
      await admin.locator('#memory-search-form button').click();
      await wait(async()=>await admin.locator('[data-memory-summary="0"]').count()
        && (await admin.locator('[data-memory-save="0"]').locator('..').textContent()).includes(query==='needle'?'Allowed/note.md':'Allowed/keep.md'));
    };
    const saveMemory = async (summary, expected) => {
      await admin.locator('[data-memory-summary="0"]').fill(summary);
      await admin.locator('[data-memory-save="0"]').click();
      await wait(async()=>{const text=await admin.locator('#memory-search-form').locator('..').textContent();return text.includes(expected);});
    };
    await searchMemory('needle');
    await saveMemory('Synthetic paired memory A','已取消');
    assert.equal((await invoke('memory.listSaved')).facts.length,0);
    await electron.evaluate(()=>{globalThis.__pairingMemoryDecision=true;});
    await saveMemory('Synthetic paired memory A','已保存为版本 1');
    await saveMemory('Synthetic paired memory A','已经保存');
    await saveMemory('Synthetic paired memory B','已保存为版本 2');
    let saved=(await invoke('memory.listSaved')).facts;
    const target=saved.find(f=>f.summary==='Synthetic paired memory B');
    assert.equal(target.ref.revision,2);
    await searchMemory('preserved');
    await saveMemory('Synthetic preserved memory','已保存为版本 1');
    await admin.screenshot({path:path.join(base,'desktop-memory-confirmed.png')});
    await admin.locator('[data-knowledge-source="pair-status"]').scrollIntoViewIfNeeded();
    await admin.screenshot({path: path.join(base, 'desktop-paired.png')});
    evaluatePlugin("app.plugins.getPlugin('personal-agent-knowledge').revokeRuntimePairing();return JSON.stringify({revoked:true});");
    const disconnected = await wait(async () => {const result = await invoke('snapshot'); return !result.knowledge?.available && result;});
    assert.equal(disconnected.knowledgeSource.pairing.mode, 'plugin');
    assert.equal(disconnected.privateMemory.vaultSelected,false);
    await wait(async()=>await admin.locator('#memory-query').isDisabled());
    await assert.rejects(invoke('knowledge.search', {query: 'needle', limit: 5}));
    await assert.rejects(invoke('memory.search',{query:'needle'}));
    await invoke('knowledge.pair.revoke');
    assert.equal((await invoke('snapshot')).knowledge.sourceId, original.sourceId);
    // Pair once more, then restart the actual Desktop process while this lease is active.
    evaluatePlugin("await app.plugins.getPlugin('personal-agent-knowledge').pairRuntime();return JSON.stringify({offered:true});");
    const nextCode = sensitiveCode();
    const reconnect = invoke('knowledge.pair');
    const nextWindow = await wait(() => electron.windows().find(page => page.url().endsWith('/pairing/index.html')));
    try {await nextWindow.locator('#code').fill(nextCode); await nextWindow.locator('button[type=submit]').click();}
    catch {throw Error('Synthetic private re-pairing form could not be submitted');}
    await reconnect;
    const beforeRestart = await invoke('snapshot');
    assert.equal(beforeRestart.knowledgeSource.pairing.available, true);
    const confirmation = await electron.evaluate(() => ({details: globalThis.__pairingConfirmationDetails, cloudAttempts: globalThis.__pairingCloudAttempts}));
    const memoryConfirmation = await electron.evaluate(()=>globalThis.__pairingMemoryDetails);
    assert.equal(memoryConfirmation.length,4,'decline, initial, correction and unrelated save; duplicate skips confirmation');
    assert.deepEqual(memoryConfirmation[0],{defaultId:1,cancelId:1,bounded:true,hasVersion:true,hasExcerpt:true});
    assert.equal(confirmation.cloudAttempts, 0); assert.equal(confirmation.details.length, 2);
    assert.deepEqual(confirmation.details[0], {defaultId: 1, cancelId: 1, bounded: true, mentionsPrivate: true, mentionsReadonly: true});
    await electron.close(); electron = undefined;
    electron = await _electron.launch({executablePath, args: [path.join(workspace, 'apps/desktop')], env});
    const restartedOrb = await wait(() => electron.windows().find(page => page.url().includes('mode=orb')));
    await restartedOrb.evaluate(() => window.desktop.invoke('orb.open'));
    const restartedPanel = await wait(() => electron.windows().find(page => page.url().includes('mode=panel')));
    await restartedPanel.evaluate(() => window.desktop.invoke('admin.open', {page: 'memory'}));
    admin = await wait(() => electron.windows().find(page => page.url().includes('mode=admin')));
    await wait(async () => (await invoke('snapshot')).privateMemory?.available);
    const restarted = await invoke('snapshot');
    assert.equal(restarted.installedSkills.items[0].digest,skillRef.digest);
    assert.equal(restarted.installedSkills.items[0].enabled,true);
    assert.equal(restarted.knowledgeSource.pairing.mode, 'plugin'); assert.equal(restarted.knowledge.available, false);
    assert.equal(restarted.privateMemory.vaultSelected,false);
    await wait(async()=>await admin.locator('#memory-query').isDisabled());
    await assert.rejects(invoke('knowledge.search', {query: 'needle', limit: 5}));
    saved=(await invoke('memory.listSaved')).facts;
    assert.equal(saved.length,2); assert.equal(saved.find(f=>f.ref.id===target.ref.id).summary,'Synthetic paired memory B');
    await assert.rejects(invoke('memory.search',{query:'needle'}));
    const pluginClosed = evaluatePlugin("return JSON.stringify({aborted:app.plugins.getPlugin('personal-agent-knowledge').bridge?.signal.aborted});");
    assert.equal(pluginClosed.aborted, true);
    await electron.evaluate(({dialog})=>{
      globalThis.__pairingCloudAttempts=0;
      globalThis.__pairingRecoveryDetails=[];globalThis.__pairingRecoveryMemoryConfirmations=0;
      globalThis.fetch=async()=>{globalThis.__pairingCloudAttempts++;throw Error('Synthetic acceptance forbids cloud calls');};
      dialog.showMessageBox=async(_owner,options)=>{
        if(options.title==='卸载 Skill') return {response:1}; // Explicit Fake uninstall decision.
        if(options.title==='确认 Obsidian 配对') globalThis.__pairingRecoveryDetails.push({
          defaultId:options.defaultId,cancelId:options.cancelId,bounded:!!options.signal});
        if(options.title==='确认私人记忆') globalThis.__pairingRecoveryMemoryConfirmations++;
        return {response:0}; // Explicit Fake pairing/withdraw/delete decisions.
      };
    });
    const replay = assert.rejects(invoke('knowledge.pair'));
    const replayWindow = await wait(()=>electron.windows().find(page=>page.url().endsWith('/pairing/index.html')));
    try {await replayWindow.locator('#code').fill(nextCode);await replayWindow.locator('button[type=submit]').click();}
    catch {throw Error('Synthetic private replay form could not be submitted');}
    await replay;
    assert.equal((await invoke('snapshot')).privateMemory.vaultSelected,false);
    assert.equal(await electron.evaluate(()=>globalThis.__pairingRecoveryDetails.length),0);
    evaluatePlugin(`window.__personalAgentSyntheticRecoveryReads=[];
      const p=app.plugins.getPlugin('personal-agent-knowledge'),create=p.createRuntimePairingPeer.bind(p);
      p.createRuntimePairingPeer=()=>{const peer=create(),read=peer.readCitation.bind(peer);
        peer.readCitation=async request=>{const result=await read(request);
          window.__personalAgentSyntheticRecoveryReads.push({path:request.source.path,line:request.source.line,revision:request.source.revision});return result;};
        return peer;};
      await p.pairRuntime();return JSON.stringify({offered:true});`);
    const recoveryCode=sensitiveCode(),repair=invoke('knowledge.pair');
    const repairWindow=await wait(()=>electron.windows().find(page=>page.url().endsWith('/pairing/index.html')));
    try {await repairWindow.locator('#code').fill(recoveryCode);await repairWindow.locator('button[type=submit]').click();}
    catch {throw Error('Synthetic private recovery form could not be submitted');}
    await repair;
    const repaired=await invoke('snapshot');
    assert.equal(repaired.privateMemory.vaultSelected,true);
    assert.notEqual(repaired.knowledge.sourceId,beforeRestart.knowledge.sourceId);
    assert.notEqual(repaired.knowledge.sourceId,paired.knowledge.sourceId);
    await wait(async()=>!await admin.locator('#memory-query').isDisabled());
    const recoveredSaved=(await invoke('memory.listSaved')).facts;
    assert.deepEqual(recoveredSaved,saved,'fresh citation verification does not rewrite confirmed facts');
    const reference=parseWikiCitationReference(target.sourceRef);assert.ok(reference);
    const reads=evaluatePlugin('return JSON.stringify({reads:window.__personalAgentSyntheticRecoveryReads});').reads;
    assert.ok(reads.some(read=>read.path===reference.path&&read.line===reference.line&&read.revision===reference.revision),
      'saved reference must be read by the actual plugin after restarting Desktop');
    const recoveredHit=(await invoke('memory.search',{query:'needle'})).hits[0].source;
    assert.equal(recoveredHit.sourceId,original.sourceId);assert.equal(recoveredHit.pageId,reference.pageId);
    assert.equal(recoveredHit.revision,reference.revision);
    const recoveredPreview=await invoke('memory.previewSave',{source:recoveredHit});
    assert.equal(recoveredPreview.citation,'Synthetic GOO122 needle <img src=x onerror=alert(1)>');
    assert.deepEqual(await invoke('memory.save',{source:recoveredHit,baseline:recoveredPreview,summary:target.summary}),
      {state:'unchanged',revision:2});
    assert.deepEqual(await electron.evaluate(()=>globalThis.__pairingRecoveryDetails),[{defaultId:1,cancelId:1,bounded:true}]);
    assert.equal(await electron.evaluate(()=>globalThis.__pairingRecoveryMemoryConfirmations),0);
    const recoveredTask=await invoke('knowledge.search',{query:'needle',limit:5});
    assert.equal(recoveredTask.hits[0].source.vaultId,repaired.knowledge.sourceId);
    await searchMemory('needle');await admin.locator('#memory-list-saved').click();
    await wait(async()=>await admin.locator('[data-memory-withdraw]').count()===2);
    await admin.screenshot({path:path.join(base,'desktop-memory-repaired.png')});
    // Only this harness's isolated synthetic note changes; native decisions remain explicit Fake.
    const disconnectSource = async () => {
      evaluatePlugin("app.plugins.getPlugin('personal-agent-knowledge').revokeRuntimePairing();return JSON.stringify({revoked:true});");
      await wait(async()=>!(await invoke('snapshot')).knowledge.available);
      await wait(async()=>await admin.locator('#memory-query').isDisabled());
      await assert.rejects(invoke('memory.search',{query:'needle'}));
    };
    const repairSource = async () => {
      evaluatePlugin("await app.plugins.getPlugin('personal-agent-knowledge').pairRuntime();return JSON.stringify({offered:true});");
      const code=sensitiveCode(),pending=invoke('knowledge.pair');
      const window=await wait(()=>electron.windows().find(page=>page.url().endsWith('/pairing/index.html')));
      try {await window.locator('#code').fill(code);await window.locator('button[type=submit]').click();}
      catch {throw Error('Synthetic source recovery form could not be submitted');}
      await pending;
      await wait(async()=>!await admin.locator('#memory-query').isDisabled());
    };
    const sourceRecovery = [];
    for(const change of ['rename','outside','missing']) {
      await disconnectSource();
      const movedPath=change==='rename'?'Allowed/renamed.md':change==='outside'?'moved-outside.md':'held-note.md';
      evaluatePlugin(`const file=app.vault.getAbstractFileByPath('Allowed/note.md');
        window.__syntheticHeldBody=await app.vault.read(file);
        await app.vault.rename(file,${JSON.stringify(movedPath)});
        return JSON.stringify({originalMissing:!app.vault.getAbstractFileByPath('Allowed/note.md')});`);
      await repairSource();
      await assert.rejects(invoke('memory.previewSave',{source:recoveredHit}));
      const unavailableSaved=(await invoke('memory.listSaved')).facts;
      assert.deepEqual(unavailableSaved,saved,'unproved moves and temporary absence must not retract or rewrite facts');
      assert.equal(await electron.evaluate(()=>globalThis.__pairingRecoveryMemoryConfirmations),0);
      evaluatePlugin(`await app.vault.rename(app.vault.getAbstractFileByPath(${JSON.stringify(movedPath)}),'Allowed/note.md');
        return JSON.stringify({restored:!!app.vault.getAbstractFileByPath('Allowed/note.md')});`);
      const restoredPreview=await invoke('memory.previewSave',{source:recoveredHit});
      assert.equal(restoredPreview.citation,recoveredPreview.citation);
      assert.deepEqual((await invoke('memory.listSaved')).facts,saved);
      sourceRecovery.push({change,oldReferenceDenied:true,unrelatedFactPreserved:true,
        noInferredWithdrawal:true,restoredWithoutNewRevision:true});
    }
    await disconnectSource();
    evaluatePlugin("await app.vault.modify(app.vault.getAbstractFileByPath('Allowed/note.md'),'Synthetic changed needle body');return JSON.stringify({modified:true});");
    assert.deepEqual((await invoke('memory.listSaved')).facts,saved,'disconnection alone cannot prove an edit');
    await repairSource();
    const changedSaved=(await invoke('memory.listSaved')).facts;
    const changedTarget=changedSaved.find(f=>f.ref.id===target.ref.id);
    assert.equal(changedTarget.state,'withdrawn');assert.equal(changedTarget.ref.revision,3);
    assert.equal(changedSaved.length,2);
    assert.deepEqual(changedSaved.find(f=>f.ref.id!==target.ref.id),saved.find(f=>f.ref.id!==target.ref.id));
    await assert.rejects(invoke('memory.previewSave',{source:recoveredHit}));
    const changedHit=(await invoke('memory.search',{query:'needle'})).hits[0].source;
    assert.equal(changedHit.pageId,reference.pageId);assert.notEqual(changedHit.revision,reference.revision);
    assert.equal(await electron.evaluate(()=>globalThis.__pairingRecoveryMemoryConfirmations),0);
    assert.deepEqual((await invoke('memory.listSaved')).facts,changedSaved,'observed edit appends exactly one withdrawal');
    await admin.locator('#memory-list-saved').click();
    await wait(async()=>await admin.locator('[data-memory-delete]').first().locator('..').textContent().then(text=>text.includes('来源已变化'))
      || await admin.locator('[data-memory-delete]').last().locator('..').textContent().then(text=>text.includes('来源已变化')));
    await admin.screenshot({path:path.join(base,'desktop-memory-source-changed.png')});
    // Leave the harness's initial note available for its original plugin invalidation check.
    evaluatePlugin("await app.vault.modify(app.vault.getAbstractFileByPath('Allowed/note.md'),window.__syntheticHeldBody);return JSON.stringify({restored:true});");
    assert.equal((await invoke('memory.listSaved')).facts.find(f=>f.ref.id===target.ref.id).state,'withdrawn',
      'restoring source text never automatically confirms the withdrawn fact');
    evaluatePlugin("await app.vault.modify(app.vault.getAbstractFileByPath('Allowed/note.md'),'Synthetic changed needle body');return JSON.stringify({modified:true});");
    const correction=(await invoke('memory.search',{query:'needle'})).hits[0].source;
    assert.deepEqual(await invoke('memory.save',{source:correction,baseline:await invoke('memory.previewSave',{source:correction}),
      summary:'Synthetic explicitly corrected memory C'}),{state:'saved',revision:4});
    assert.equal(await electron.evaluate(()=>globalThis.__pairingRecoveryMemoryConfirmations),1);
    saved=(await invoke('memory.listSaved')).facts;
    assert.equal(saved.find(f=>f.ref.id===target.ref.id).state,'active');
    evaluatePlugin("await app.vault.modify(app.vault.getAbstractFileByPath('Allowed/note.md'),window.__syntheticHeldBody);return JSON.stringify({restored:true});");
    evaluatePlugin("app.plugins.getPlugin('personal-agent-knowledge').revokeRuntimePairing();return JSON.stringify({revoked:true});");
    await wait(async()=>!(await invoke('snapshot')).knowledge.available);
    await wait(async()=>await admin.locator('#memory-query').isDisabled());
    await assert.rejects(invoke('memory.search',{query:'needle'}));
    await admin.locator('#memory-list-saved').click();
    const targetIndex=saved.findIndex(f=>f.ref.id===target.ref.id);
    await admin.locator(`[data-memory-withdraw="${targetIndex}"]`).click();
    await wait(async()=>{const facts=(await invoke('memory.listSaved')).facts;return facts.find(f=>f.ref.id===target.ref.id)?.state==='withdrawn';});
    await wait(async()=>await admin.locator('#memory-saved-status').textContent().then(t=>t.includes('已撤回')));
    assert.equal((await invoke('memory.listSaved')).facts.find(f=>f.ref.id===target.ref.id).ref.revision,5);
    const deleteIndex=(await invoke('memory.listSaved')).facts.findIndex(f=>f.ref.id===target.ref.id);
    await admin.locator(`[data-memory-delete="${deleteIndex}"]`).click();
    await wait(async()=>await admin.locator('#memory-saved-status').textContent().then(t=>t.includes('已删除')));
    saved=(await invoke('memory.listSaved')).facts;
    assert.deepEqual(saved.map(f=>f.summary),['Synthetic preserved memory']);
    assert.equal((await invoke('snapshot')).installedSkills.items[0].digest,skillRef.digest,'memory deletion preserves installed Skill');
    await invoke('skill.uninstall',skillRef);
    assert.deepEqual((await invoke('snapshot')).installedSkills.items,[]);
    assert.deepEqual((await invoke('memory.listSaved')).facts.map(f=>f.summary),['Synthetic preserved memory']);
    assert.equal(readFileSync(path.join(skillDirectory,'SKILL.md'),'utf8'),skillText);
    assert.equal((await invoke('snapshot')).privateMemory.vaultSelected,false);
    assert.equal(await admin.locator('#memory-query').isDisabled(),true);
    await admin.screenshot({path:path.join(base,'desktop-memory-erased.png')});
    assert.equal(await electron.evaluate(()=>globalThis.__pairingCloudAttempts),0);
    await invoke('knowledge.pair.revoke'); assert.equal((await invoke('snapshot')).knowledge.sourceId, original.sourceId);
    return {realDesktopHost: true, crossProcessRuntimePairing: true, source: 'synthetic', nativeDecision: 'explicit_fake',
      installedSkill:{nativeDecision:'explicit_fake',installedWhilePaired:true,restartPreserved:true,
        memoryDeletionPreservedSkill:true,uninstallPreservedMemory:true,originalSourceUnchanged:true},
      passwordInput: true, isolation, confirmedSearch: {hits: hits.hits.length, path: hits.hits[0].source.path},
      revocationFailsClosed: true, realDesktopRestartFailsClosed: true, explicitFilesystemRestore: true, cloudAttempts: confirmation.cloudAttempts,
      taskCount: tasks.tasks?.length ?? tasks.tasks?.items?.length,
      memory:{nativeDecision:'explicit_fake',declinedWithoutWrite:true,savedRevision:2,duplicateWithoutConfirmation:true,
        survivesRestart:true,disconnectedSearchDenied:true,disconnectedSearchDisabled:true,oldPairingCodeDenied:true,
        repairedWithFreshTaskSource:true,savedCitationReadByPlugin:true,stablePageIdentity:true,repairedDuplicateRevision:2,
        withdrawnRevision:5,targetErased:true,unrelatedFactPreserved:true,observedWithdrawalRevision:3,explicitCorrectionRevision:4,
        sourceRecovery,offlineEditWithdrawn:true,changedCitationDenied:true,newContentNotAutoConfirmed:true,
        restoredTextDoesNotReactivate:true}};
  } finally {if (electron) await electron.close();}
}

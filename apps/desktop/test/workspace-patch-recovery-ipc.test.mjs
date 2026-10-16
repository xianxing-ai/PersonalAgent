import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,rm} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {_electron} from 'playwright';

async function recoveryWindow(electron) {
  const seen=new Set();let timer,onWindow;
  try {
    return await new Promise((resolve,reject)=>{
      timer=setTimeout(()=>reject(Error('Recovery fixture window did not load')),30000);
      onWindow=page=>{
        if(seen.has(page))return;seen.add(page);
        void page.waitForURL('**/workspace-patch-recovery.html',{timeout:30000})
          .then(()=>resolve(page),()=>{});
      };
      // Listen before taking the snapshot so neither existing nor new windows are missed.
      electron.on('window',onWindow);
      for(const page of electron.windows())onWindow(page);
    });
  } finally {
    clearTimeout(timer);electron.off('window',onWindow);
  }
}

test('management IPC recovers the original cancelled SQLite task and publishes its fresh state',
  {skip:!process.env.PA_PATCH_RECOVERY_ELECTRON,timeout:60000},async()=>{
  const cache=fileURLToPath(new URL('../../../.cache/',import.meta.url));await mkdir(cache,{recursive:true});
  const directory=await mkdtemp(path.join(cache,'desktop-patch-ipc-'));
  const env={...process.env,PA_PATCH_RECOVERY_FIXTURE:directory};delete env.ELECTRON_RUN_AS_NODE;
  let electron;
  try {
    electron=await _electron.launch({executablePath:process.env.PA_PATCH_RECOVERY_ELECTRON,
      args:[fileURLToPath(new URL('./fixtures/workspace-patch-recovery-app.mjs',import.meta.url))],env,timeout:25000});
    const page=await recoveryWindow(electron);
    const errors=[];page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
    assert.match(await page.title(),/Runtime IPC/);
    const input=await electron.evaluate(()=>({taskId:patchFixture.taskId,expectedRevision:patchFixture.initialRevision}));
    const other=electron.windows().find(p=>p!==page);
    const rejected=await other.evaluate(input=>window.desktop.invoke('coding.reconcile',input),input);
    assert.equal(rejected.ok,false);assert.doesNotMatch(rejected.error,/demo.mjs|runtime.sqlite/);
    assert.equal((await electron.evaluate(()=>patchFixture.inspect())).calls.readback,0);
    await electron.evaluate(()=>patchFixture.hold());
    await page.getByRole('button',{name:'核实补丁结果',exact:true}).click();
    // A second real IPC request shares the in-flight original recovery.
    const duplicate=page.evaluate(input=>window.desktop.invoke('coding.reconcile',input),input);
    await page.waitForFunction(()=>document.querySelector('[data-patch-reconcile]').disabled);
    await electron.evaluate(()=>patchFixture.release());
    const reply=await duplicate;assert.equal(reply.ok,true);assert.equal(reply.value.outcome,'applied');
    await page.getByText('任务已取消，但此前修改已写入。',{exact:false}).waitFor();
    const updates=await page.evaluate(()=>window.fixtureUpdates);
    assert.ok(updates.length>0);
    assert.ok(updates.every(update=>update.tasks[0].state==='cancelled'),'IPC must publish fresh terminal task state');
    assert.ok(updates.every(update=>update.tasks[0].revision===reply.value.revision));
    const receipt=await electron.evaluate(()=>patchFixture.inspect());
    assert.equal(receipt.record.evidenceId,reply.value.runId);assert.equal(receipt.record.inputDigest,receipt.original.inputDigest);
    assert.equal(receipt.record.state,'confirmed');assert.equal(receipt.record.reconciliationOutcome,'applied');
    assert.equal(receipt.usesRemaining,0);assert.equal(receipt.bytesMatch,true);
    assert.deepEqual(receipt.calls,{write:1,cloud:2,readback:2,acknowledgement:1});
    await electron.evaluate(()=>patchFixture.restart());
    const repeated=await page.evaluate(input=>window.desktop.invoke('coding.reconcile',input),
      {taskId:input.taskId,expectedRevision:reply.value.revision});
    assert.deepEqual(repeated,reply);
    assert.deepEqual((await electron.evaluate(()=>patchFixture.inspect())).calls,receipt.calls);
    assert.doesNotMatch(await page.locator('body').innerText(),/demo.mjs|runtime.sqlite|Error overlay/);
    assert.deepEqual(errors,[]);
    if(process.env.PA_PATCH_RECOVERY_SCREENSHOT) {
      await mkdir(path.dirname(process.env.PA_PATCH_RECOVERY_SCREENSHOT),{recursive:true});
      await page.screenshot({path:process.env.PA_PATCH_RECOVERY_SCREENSHOT});
    }
  }finally{await electron?.close();await rm(directory,{recursive:true,force:true});}
});

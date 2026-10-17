// Two real Electron processes; no provider, window or user configuration.
const {spawnSync}=require('node:child_process');
const {mkdirSync,mkdtempSync,readFileSync}=require('node:fs');
const path=require('node:path');
const assert=require('node:assert/strict');
const base=path.resolve(__dirname,'../../../.cache/remote-mcp-secure-storage');
mkdirSync(base,{recursive:true});
const target=mkdtempSync(path.join(base,'case-'));
const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;
for(const phase of ['save','restore']){
  const result=spawnSync(require('electron'),[path.join(__dirname,'remote-mcp-secure-storage-fixture.cjs'),`--mcp-case=${target}`,`--mcp-phase=${phase}`],
    {env,windowsHide:true,encoding:'utf8',timeout:60000});
  assert.equal(result.error,undefined,'Electron fixture must start');
  assert.equal(result.status,0,`Electron ${phase} fixture must finish successfully`);
}
const receipt=JSON.parse(readFileSync(path.join(target,'receipt.json'),'utf8'));
assert.equal(receipt.status,'passed');assert.equal(receipt.separateProcesses,true);
console.log(JSON.stringify(receipt));

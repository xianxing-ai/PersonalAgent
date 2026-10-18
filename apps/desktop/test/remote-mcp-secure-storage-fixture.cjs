const {app,safeStorage}=require('electron');
const assert=require('node:assert/strict');
const {existsSync,mkdirSync,readFileSync,writeFileSync}=require('node:fs');
const {createHash}=require('node:crypto');
const path=require('node:path');
const {pathToFileURL}=require('node:url');
const base=path.resolve(__dirname,'../../../.cache/remote-mcp-secure-storage');
const target=path.resolve(process.argv.find(value=>value.startsWith('--mcp-case='))?.slice(11)??'');
const phase=process.argv.find(value=>value.startsWith('--mcp-phase='))?.slice(12);
assert.equal(path.dirname(target),base);assert.match(path.basename(target),/^case-/);assert.ok(['save','restore'].includes(phase));
const electronData=path.join(target,'electron');mkdirSync(electronData,{recursive:true});app.setPath('userData',electronData);
const digest=value=>createHash('sha256').update(value).digest('hex');
let step='ready';

app.whenReady().then(async()=>{
  assert.equal(safeStorage.isEncryptionAvailable(),true);
  const {createRemoteMcpConfig}=await import(pathToFileURL(path.resolve(__dirname,'../electron/remote-mcp-config.js')).href);
  const userData=path.join(target,'settings'),token='synthetic-native-secure-storage-only';
  const config=createRemoteMcpConfig({userData,safeStorage}),file=path.join(userData,'remote-mcp-config.json');
  try{
    if(phase==='save'){
      const schema={type:'object',properties:{text:{type:'string'}},required:['text'],additionalProperties:false};
      config.configure({endpoint:'https://synthetic-mcp.example/mcp',server:{name:'synthetic-reference',version:'1.0.0'},
        tool:{remoteName:'reference',descriptor:{name:'mcp.remote.synthetic',version:'2.0.0',inputSchema:schema,outputSchema:schema,requiredScopes:['synthetic:read']}},
        directoryDigest:'a'.repeat(64),credential:{token,expiresAt:new Date(Date.now()+60000).toISOString()}});
      const cipher=readFileSync(file,'utf8');assert.equal(cipher.includes(token),false);assert.equal(cipher.includes('https://synthetic-mcp.example'),false);
      assert.equal(config.snapshot().sessionAllowed,false);
      writeFileSync(path.join(target,'saved.json'),JSON.stringify({pid:process.pid,bindingDigest:digest(config.binding().configurationRef),cipherDigest:digest(cipher)}));
    }else{
      step='distinct-process';const saved=JSON.parse(readFileSync(path.join(target,'saved.json'),'utf8'));assert.notEqual(process.pid,saved.pid);
      step='cipher-preserved';assert.equal(digest(readFileSync(file,'utf8')),saved.cipherDigest);
      step='reload';assert.equal(config.snapshot().status,'saved_disconnected');
      step='fresh-session';
      assert.notEqual(digest(config.binding().configurationRef),saved.bindingDigest);
      step='secret-read';
      assert.equal(config.secretStore.read(config.binding().credential.secretRef,new AbortController().signal),token);
      step='revoke';
      config.revoke();assert.equal(existsSync(file),false);
      writeFileSync(path.join(target,'receipt.json'),JSON.stringify({status:'passed',platform:process.platform,electron:process.versions.electron,
        realSafeStorage:true,separateProcesses:true,restoredDisconnected:true,freshSessionBinding:true,ciphertextRemoved:true,modelCalls:0,agentArtsCalls:0}));
    }
  }finally{config.dispose();}
  // Graceful quit flushes Chromium's encryption state before the next process.
  app.quit();
}).catch(error=>{writeFileSync(path.join(target,'receipt.json'),JSON.stringify({status:'failed',step,errorType:error?.name??'Error'}));app.exit(1);});

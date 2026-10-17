import assert from 'node:assert/strict';
import test from 'node:test';
import {mkdtempSync, readFileSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createHuaweiSisRequestAuth} from '../electron/huawei-sis-auth.js';
import {createDesktopSisConfigHost} from '../electron/huawei-sis-config.js';
const config = {region:'cn-north-4',projectId:'synthetic-project',accessKeyId:'SYNTHETICACCESSKEY',secretAccessKey:'synthetic-private-key-never-real'};
const request = {method:'POST',url:'https://sis-ext.cn-north-4.myhuaweicloud.com/v1/synthetic-project/asr/short-audio',
  body:'{}',deadline:'2030-01-01T00:00:00Z',signal:new AbortController().signal};
test('AK signing binds exact body, endpoint and deadline without returning SK', async () => {
  const signer=createHuaweiSisRequestAuth(config,{now:()=>Date.parse('2026-01-01T00:00:00Z')});
  const first=await signer.getSisRequestHeaders(request);
  assert.equal(first['X-Sdk-Date'],'20260101T000000Z');
  assert.match(first.Authorization,/^SDK-HMAC-SHA256 Access=SYNTHETICACCESSKEY, SignedHeaders=content-type;host;x-project-id;x-sdk-date, Signature=[a-f0-9]{64}$/);
  assert.equal(first['X-Project-Id'],config.projectId);
  assert.equal(JSON.stringify(first).includes(config.secretAccessKey),false);
  assert.notEqual((await signer.getSisRequestHeaders({...request,body:'{"changed":true}'})).Authorization,first.Authorization);
  for(const change of [{url:'https://example.com/v1/synthetic-project/asr/short-audio'},
    {url:request.url+'?redirect=1'},{method:'GET'},{deadline:'2020-01-01T00:00:00Z'},
    {signal:AbortSignal.abort()}]) await assert.rejects(signer.getSisRequestHeaders({...request,...change}));
});
test('AK configuration persists encrypted separately, snapshot never includes credentials', t => {
  const dir=mkdtempSync(path.join(tmpdir(),'sis-ak-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));
  const safeStorage={isEncryptionAvailable:()=>true,encryptString:value=>Buffer.from(value).reverse(),decryptString:value=>Buffer.from(value).reverse().toString()};
  const open=()=>createDesktopSisConfigHost({userData:dir,safeStorage,env:{}});
  const host=open();host.configureAccessKey(config);
  assert.deepEqual(open().currentAccessKey(),config);
  assert.equal(host.snapshot().tokenStatus,'not_required');
  assert.equal(host.snapshot().agentArtsProxy,'unavailable');
  assert.equal(JSON.stringify(host.snapshot()).includes(config.accessKeyId),false);
  assert.equal(readFileSync(path.join(dir,'huawei-sis-access-key.json'),'utf8').includes(config.secretAccessKey),false);
});

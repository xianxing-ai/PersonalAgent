#!/usr/bin/env node
/**
 * Local OpenCLI click acceptance. Requires an installed Browser Bridge extension.
 * Writes a device receipt under .cache/ (gitignored). Does not exercise AgentArts
 * authorization or cloud continuation; those remain a separate authorized run.
 *
 * Usage (repo root after npm install / contracts build):
 *   node apps/desktop/test/opencli-browser-click-acceptance.mjs
 * Optional:
 *   PA_OPENCLI_CLICK_URL=https://example.com/
 */
import {createHash} from 'node:crypto';
import {mkdir,writeFile,readFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {assertOpenCliPublicUrl,createOpenCliPage,projectOpenCliPage,checkOpenCliControl,operateOpenCliControl,probeOpenCliExtension} from '../electron/opencli-browser-host.js';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..','..','..');
const cacheDir=path.join(root,'.cache','computer-control-live');
const url=process.env.PA_OPENCLI_CLICK_URL||'https://example.com/';
const marker='data-pa-click-acceptance';
const controller=new AbortController();
const deadline=new Date(Date.now()+60_000).toISOString();
const started=Date.now();
const hostSource=await readFile(new URL('../electron/opencli-browser-host.js',import.meta.url));
const sourceSha=createHash('sha256').update(hostSource).digest('hex');
let probe,page,receipt;

async function writeReceipt(value) {
  await mkdir(cacheDir,{recursive:true});
  const target=path.join(cacheDir,'opencli-click-device-receipt.json');
  await writeFile(target,JSON.stringify(value,null,2));
  console.log(JSON.stringify({receiptPath:target,...value},null,2));
}

try {
  await probeOpenCliExtension({signal:controller.signal});
  probe={connected:true,state:'ready'};
} catch (error) {
  probe={connected:false,state:'unavailable',code:error?.code,message:String(error?.message??error)};
  await writeReceipt({ok:false,kind:'opencli-click',sourceSha256:sourceSha,probe,url,error:'OpenCLI Browser Bridge 未连通；请安装扩展后重试。本脚本不会自动安装扩展。',elapsedMs:Date.now()-started,recordedAt:new Date().toISOString(),cloudChain:'not_run'});
  process.exit(1);
}

try {
  const admitted=await assertOpenCliPublicUrl(url);
  page=await createOpenCliPage('personal-agent-click-acceptance',controller.signal,deadline,{probe:async()=>{}});
  const tabId=await page.newTab(admitted.href);
  if(typeof tabId!=='string'||!tabId)throw Error('missing tab id');
  page.setActivePage(tabId);
  await assertOpenCliPublicUrl(admitted.origin,{expectedOrigin:admitted.origin});
  const observed=await page.evaluate(projectOpenCliPage,admitted.origin,marker);
  if(!observed||observed.rejected||new URL(observed.url).origin!==admitted.origin)throw Error('left authorized origin');
  const candidate=observed.controls.find(item=>item.tag==='a'&&item.href&&new URL(item.href).origin===admitted.origin)
    ??observed.controls.find(item=>item.tag==='button'||item.tag==='a');
  if(!candidate)throw Error('no same-origin clickable control in projection');
  if(await page.evaluate(checkOpenCliControl,admitted.origin,marker,candidate.ref,candidate)!==true)throw Error('control stale before click');
  const beforeUrl=observed.url;
  const written=await page.evaluate(operateOpenCliControl,admitted.origin,marker,candidate.ref,candidate,'click');
  if(written?.applied!==true)throw Error('click not applied');
  const after=await page.evaluate(projectOpenCliPage,admitted.origin,marker);
  if(!after||after.rejected||new URL(after.url).origin!==admitted.origin)throw Error('left authorized origin after click');
  await assertOpenCliPublicUrl(after.url,{expectedOrigin:admitted.origin});
  const sameControl=after.controls.some(item=>item.actionRef===candidate.ref&&item.tag===candidate.tag
    &&item.type===candidate.type&&item.name===candidate.name);
  const navigated=after.url!==beforeUrl;
  if(!sameControl&&!navigated)throw Error('independent observe did not verify click');
  receipt={
    ok:true,
    kind:'opencli-click',
    sourceSha256:sourceSha,
    probe,
    url:admitted.href,
    origin:admitted.origin,
    beforeUrl,
    afterUrl:after.url,
    control:{ref:candidate.ref,tag:candidate.tag,type:candidate.type,name:candidate.name},
    fieldVerified:true,
    verification:sameControl?'actionRef':'same_origin_navigation',
    elapsedMs:Date.now()-started,
    recordedAt:new Date().toISOString(),
    cloudChain:'not_run',
    note:'Device click only. AgentArts→Runtime→authorization→cloud final answer remains separate.',
  };
} catch (error) {
  receipt={ok:false,kind:'opencli-click',sourceSha256:sourceSha,probe,url,error:String(error?.message??error),code:error?.code,elapsedMs:Date.now()-started,recordedAt:new Date().toISOString(),cloudChain:'not_run'};
  process.exitCode=1;
} finally {
  page?.dispose?.();
  await writeReceipt(receipt??{ok:false,kind:'opencli-click',sourceSha256:sourceSha,probe,url,error:'missing receipt',elapsedMs:Date.now()-started,recordedAt:new Date().toISOString(),cloudChain:'not_run'});
}

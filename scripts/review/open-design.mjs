import {readFile} from 'node:fs/promises';
import {execFileSync,spawn} from 'node:child_process';
import {createInterface} from 'node:readline/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {root,policy,createManifest} from './design-manifest.mjs';

const manifest=await createManifest();
const stored=JSON.parse(await readFile(path.join(root,policy.designDirectory,'review-manifest.json'),'utf8'));
if(stored.digest!==manifest.digest || JSON.stringify(stored.files)!==JSON.stringify(manifest.files)) throw Error('Design content differs from the committed manifest; do not approve.');
const head=execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim();
if(!/^[a-f0-9]{40}$/.test(head)) throw Error('Invalid Git HEAD');
const changes=execFileSync('git',['status','--porcelain','--',policy.designDirectory],{cwd:root,encoding:'utf8'}).trim();
if(changes) throw Error('Local design files have changes; use the PR revision before reviewing.');
if(process.argv.includes('--verify-only')) {
  console.log(JSON.stringify({verified:true,head,digest:manifest.digest,files:manifest.files.length}));
} else {
  if(!process.stdin.isTTY) throw Error('Interactive local reading is required; --verify-only does not create a reading receipt.');
  for(const name of policy.requiredFiles.filter(name=>name.endsWith('.svg')||name==='index.html')) {
    const url=pathToFileURL(path.join(root,policy.designDirectory,name)).href;
    const command=process.platform==='win32'?'explorer.exe':process.platform==='darwin'?'open':'xdg-open';
    const child=spawn(command,[url],{shell:false,detached:true,stdio:'ignore',windowsHide:true});
    await new Promise((resolve,reject)=>{child.once('spawn',resolve);child.once('error',reject);});
    child.unref();
  }
  console.log('Requested opening the offline reader and all four SVGs. Verify they actually opened, then read the full DESIGN.md text, module estimates and Wiki handoff inside the reader.');
  console.log('This launcher records your personal attestation, not independently verified OS/browser telemetry. Never sign on behalf of another person.');
  const terminal=createInterface({input:process.stdin,output:process.stdout});
  const answer=await terminal.question('After reading on YOUR computer, type 已在本机阅读 and press Enter: ');
  terminal.close();
  if(answer!=='已在本机阅读') throw Error('No reading confirmation was given.');
  const receipt={version:1,headSha:head,manifestDigest:manifest.digest,confirmedOnOwnComputer:true,
    confirmedFiles:policy.requiredFiles,confirmedAt:new Date().toISOString()};
  console.log(`\nPaste this into your OWN GitHub review body; submit Approve only after checking the changes:\n<!-- ${policy.receiptMarker} -->\n\`\`\`json\n${JSON.stringify(receipt,null,2)}\n\`\`\``);
  // No GitHub write, approval, merge, token access or simulated confirmation.
}

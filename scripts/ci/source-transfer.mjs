import {createHash} from 'node:crypto';
import {createReadStream} from 'node:fs';
import {appendFile,copyFile,lstat,mkdir,mkdtemp} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const script=fileURLToPath(import.meta.url);
function git(root,...args) {
  return execFileSync('git',['-C',root,...args],{encoding:'utf8',windowsHide:true,stdio:['ignore','pipe','pipe']}).trim();
}
async function digest(file) {
  const hash=createHash('sha256');
  for await(const bytes of createReadStream(file)) hash.update(bytes);
  return hash.digest('hex');
}
function checkSha(sha) { if(!/^[a-f0-9]{40}$/.test(sha??'')) throw Error('Invalid expected source SHA'); }

export async function packSource(root,tempRoot,sha) {
  checkSha(sha);
  const metadata=await lstat(path.join(root,'.git'));
  if(!metadata.isDirectory()||metadata.isSymbolicLink()||git(root,'rev-parse','HEAD')!==sha) throw Error('Source must be an exact ordinary checkout');
  const keys=git(root,'config','--local','--name-only','--list').toLowerCase().split('\n');
  if(keys.some(key=>/^(credential\.|http\.|url\.|include\.|includeif\.|core\.sshcommand$)/.test(key))) throw Error('Refusing to archive authentication or external Git configuration');
  if(!/^https:\/\/github\.com\/[-\w]+\/[-\w.]+$/.test(git(root,'remote','get-url','origin'))) throw Error('Refusing nonstandard or credential-bearing origin');
  git(root,'diff','--exit-code','HEAD');
  const directory=await mkdtemp(path.join(tempRoot,'ci-transfer-'));
  const archive=path.join(directory,'source.tgz');
  // Only Git objects/metadata are transferred. No workspace caches, .env or
  // dependency trees; checkout has already removed its short-lived auth header.
  execFileSync('tar',['--exclude=.git/hooks','--exclude=.git/logs','-czf',archive,'.git'],{cwd:root,windowsHide:true,stdio:'pipe'});
  await copyFile(script,path.join(directory,'source-transfer.mjs'));
  return {directory,sha256:await digest(archive)};
}

export async function restoreSource(directory,tempRoot,sha,expectedDigest) {
  checkSha(sha);
  if(!/^[a-f0-9]{64}$/.test(expectedDigest??'')||await digest(path.join(directory,'source.tgz'))!==expectedDigest) throw Error('CI source archive digest mismatch');
  // Use a new directory under this job's temporary root. Never clean or overlay
  // an existing runner checkout or another job's workspace.
  const root=await mkdtemp(path.join(tempRoot,'ci-source-'));
  execFileSync('tar',['-xzf',path.join(directory,'source.tgz'),'-C',root],{windowsHide:true,stdio:'pipe'});
  const hooks=path.join(root,'.git','disabled-hooks');
  await mkdir(hooks);
  git(root,'config','core.hooksPath',hooks);
  git(root,'config','core.autocrlf','false');
  git(root,'config','core.filemode','false');
  git(root,'checkout','--force','--detach',sha);
  if(git(root,'rev-parse','HEAD')!==sha) throw Error('Restored source SHA mismatch');
  git(root,'diff','--exit-code','HEAD');
  return root;
}

if(process.argv[1]&&path.resolve(process.argv[1])===script) {
  if(process.argv[2]==='pack') {
    const receipt=await packSource(process.cwd(),process.env.RUNNER_TEMP,process.env.GITHUB_SHA);
    await appendFile(process.env.GITHUB_OUTPUT,`directory=${receipt.directory}\nsha256=${receipt.sha256}\n`);
  } else if(process.argv[2]==='restore') {
    const root=await restoreSource(path.dirname(script),process.env.RUNNER_TEMP,process.env.GITHUB_SHA,process.env.CI_SOURCE_SHA256);
    await appendFile(process.env.GITHUB_OUTPUT,`directory=${root}\n`);
    console.log(`Restored verified GitHub Actions source for ${process.env.GITHUB_SHA}; no Git network fetch used.`);
  } else throw Error('Expected pack or restore');
}

import {createHash} from 'node:crypto';
import {createReadStream} from 'node:fs';
import {readFile,writeFile,appendFile,mkdtemp} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

async function hash(file) {
  const digest=createHash('sha256');
  for await(const chunk of createReadStream(file)) digest.update(chunk);
  return digest.digest('hex');
}
async function lockedElectron(root) {
  const lock=JSON.parse(await readFile(path.join(root,'package-lock.json'),'utf8'));
  const version=lock.packages?.['node_modules/electron']?.version;
  if(!/^\d+\.\d+\.\d+$/.test(version??'')) throw Error('Expected an exact locked Electron release');
  return {version,lockSha256:await hash(path.join(root,'package-lock.json'))};
}
export async function packElectronCache(root,tempRoot,downloadImpl) {
  const locked=await lockedElectron(root);
  const installed=JSON.parse(await readFile(path.join(root,'node_modules/electron/package.json'),'utf8'));
  if(installed.version!==locked.version) throw Error('Installed Electron package differs from the lockfile');
  if(['ELECTRON_MIRROR','ELECTRON_CUSTOM_DIR','ELECTRON_CUSTOM_FILENAME','electron_use_remote_checksums'].some(key=>process.env[key])) throw Error('CI cache requires official Electron URLs and embedded checksums');
  const checksums=JSON.parse(await readFile(path.join(root,'node_modules/electron/checksums.json'),'utf8'));
  const filename=`electron-v${locked.version}-win32-x64.zip`;
  if(!/^[a-f0-9]{64}$/.test(checksums[filename]??'')) throw Error('Missing official Windows Electron checksum');
  const cacheRoot=await mkdtemp(path.join(tempRoot,'ci-electron-cache-'));
  const download=downloadImpl??(await import('@electron/get')).downloadArtifact;
  const file=await download({version:locked.version,artifactName:'electron',platform:'win32',arch:'x64',cacheRoot,checksums});
  const relative=path.relative(cacheRoot,file).split(path.sep).join('/');
  if(!new RegExp(`^[a-f0-9]{64}/${filename.replaceAll('.','\\.')}$`).test(relative)||await hash(file)!==checksums[filename]) throw Error('Electron cache path or official checksum mismatch');
  await writeFile(path.join(cacheRoot,'ci-receipt.json'),JSON.stringify({...locked,filename,relative,zipSha256:checksums[filename]})+'\n');
  const directory=await mkdtemp(path.join(tempRoot,'ci-electron-transfer-'));
  const archive=path.join(directory,'electron-cache.tgz');
  execFileSync('tar',['-czf',archive,'.'],{cwd:cacheRoot,windowsHide:true,stdio:'pipe'});
  return {directory,sha256:await hash(archive),version:locked.version};
}
export async function restoreElectronCache(root,directory,tempRoot,expectedDigest) {
  const archive=path.join(directory,'electron-cache.tgz');
  if(!/^[a-f0-9]{64}$/.test(expectedDigest??'')||await hash(archive)!==expectedDigest) throw Error('Electron cache archive digest mismatch');
  const locked=await lockedElectron(root);
  const cacheRoot=await mkdtemp(path.join(tempRoot,'ci-electron-ready-'));
  execFileSync('tar',['-xzf',archive,'-C',cacheRoot],{windowsHide:true,stdio:'pipe'});
  const receipt=JSON.parse(await readFile(path.join(cacheRoot,'ci-receipt.json'),'utf8'));
  const filename=`electron-v${locked.version}-win32-x64.zip`;
  if(receipt.version!==locked.version||receipt.lockSha256!==locked.lockSha256||receipt.filename!==filename||
    !new RegExp(`^[a-f0-9]{64}/${filename.replaceAll('.','\\.')}$`).test(receipt.relative??'')||
    await hash(path.join(cacheRoot,receipt.relative))!==receipt.zipSha256) throw Error('Electron cache does not match this locked source');
  return cacheRoot;
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  if(process.argv[2]==='pack') {
    const result=await packElectronCache(process.cwd(),process.env.RUNNER_TEMP);
    await appendFile(process.env.GITHUB_OUTPUT,`directory=${result.directory}\nsha256=${result.sha256}\n`);
    console.log(`Official Electron ${result.version} win32/x64 cache verified against the npm package's embedded checksum.`);
  } else if(process.argv[2]==='restore') {
    const cache=await restoreElectronCache(process.cwd(),path.join(process.env.RUNNER_TEMP,'ci-electron-transfer'),process.env.RUNNER_TEMP,process.env.CI_ELECTRON_CACHE_SHA256);
    await appendFile(process.env.GITHUB_ENV,`electron_config_cache=${cache}\n`);
    console.log('Verified same-run Electron cache ready; the original npm ci and postinstall will still run.');
  } else throw Error('Expected pack or restore');
}

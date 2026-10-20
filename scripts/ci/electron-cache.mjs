import {createHash} from 'node:crypto';
import {createReadStream} from 'node:fs';
import {readFile,writeFile,appendFile,mkdtemp,lstat} from 'node:fs/promises';
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
  return {directory,sha256:await hash(archive),size:(await lstat(archive)).size,version:locked.version};
}
export async function prepareElectronTransfer(tempRoot) {
  // A fresh destination prevents interrupted downloads from a previous attempt
  // from being mistaken for this job's artifact. Never clean shared temp paths.
  return mkdtemp(path.join(tempRoot,'ci-electron-download-'));
}
export async function restoreElectronCache(root,directory,tempRoot,expectedDigest,expectedSize) {
  const archive=path.join(directory,'electron-cache.tgz');
  if(!/^[a-f0-9]{64}$/.test(expectedDigest??'')) throw Error('Electron cache archive digest mismatch: invalid expected SHA256');
  if(expectedSize!==undefined&&!/^[1-9]\d*$/.test(String(expectedSize))) throw Error('Invalid expected Electron cache archive size');
  let metadata;
  try { metadata=await lstat(archive); }
  catch(error) {
    if(error.code==='ENOENT') throw Error('Electron cache archive missing: artifact download did not produce electron-cache.tgz');
    throw Error('Electron cache archive metadata could not be read');
  }
  if(!metadata.isFile()||metadata.isSymbolicLink()) throw Error('Electron cache archive must be a regular file');
  const actualSha256=await hash(archive);
  if(actualSha256!==expectedDigest||(expectedSize!==undefined&&String(metadata.size)!==String(expectedSize))) {
    throw Error('Electron cache archive digest mismatch: '+JSON.stringify({size:metadata.size,expectedSize:expectedSize??null,actualSha256,expectedSha256:expectedDigest}));
  }
  const locked=await lockedElectron(root);
  const cacheRoot=await mkdtemp(path.join(tempRoot,'ci-electron-ready-'));
  // GNU tar interprets a drive colon in -f as a remote host. Resolve the
  // already verified artifact through cwd so both GNU tar and bsdtar work.
  execFileSync('tar',['-xzf','electron-cache.tgz','-C',cacheRoot],{cwd:directory,windowsHide:true,stdio:'pipe'});
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
    await appendFile(process.env.GITHUB_OUTPUT,`directory=${result.directory}\nsha256=${result.sha256}\nsize=${result.size}\n`);
    console.log(`Official Electron ${result.version} win32/x64 cache verified against the npm package's embedded checksum.`);
  } else if(process.argv[2]==='prepare') {
    const directory=await prepareElectronTransfer(process.env.RUNNER_TEMP);
    await appendFile(process.env.GITHUB_OUTPUT,`directory=${directory}\n`);
  } else if(process.argv[2]==='restore') {
    const cache=await restoreElectronCache(process.cwd(),process.env.CI_ELECTRON_TRANSFER_DIRECTORY??path.join(process.env.RUNNER_TEMP,'ci-electron-transfer'),process.env.RUNNER_TEMP,process.env.CI_ELECTRON_CACHE_SHA256,process.env.CI_ELECTRON_CACHE_SIZE);
    await appendFile(process.env.GITHUB_ENV,`electron_config_cache=${cache}\n`);
    console.log('Verified same-run Electron cache ready; the original npm ci and postinstall will still run.');
  } else throw Error('Expected pack, prepare or restore');
}

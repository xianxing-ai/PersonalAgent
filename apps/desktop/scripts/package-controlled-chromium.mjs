import {cp} from 'node:fs/promises';
import path from 'node:path';
import {controlledChromiumFiles,developmentChromiumPath,locateControlledChromium} from '../electron/controlled-chromium.js';

export default async function afterPack({appOutDir,electronPlatformName}){
  if(electronPlatformName!=='win32'||process.platform!=='win32'||process.arch!=='x64')
    throw new Error('Synstar 的浏览器发行包需要 Windows x64 构建机。');
  locateControlledChromium();
  const destination=path.join(appOutDir,'resources','controlled-chromium');
  for(const {directory} of controlledChromiumFiles()){
    await cp(path.join(developmentChromiumPath,directory),path.join(destination,directory),{recursive:true});
  }
}

import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {prepareNativeDesktopComponent} from '../electron/native-desktop-component.js';
import {computerControlFailure} from '../electron/computer-control-errors.js';

export async function prepareNativeDesktopBeforeStart({platform=process.platform,prepare=prepareNativeDesktopComponent,stderr=process.stderr,now=Date.now}={}){
  if(platform!=='win32')return {prepared:false,skipped:true};
  try{
    await prepare({electronDir:path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../electron'),
      signal:new AbortController().signal,deadline:new Date(now()+120_000).toISOString()});
    return {prepared:true};
  }catch(error){
    const detail=computerControlFailure(error);
    stderr.write(`电脑控制组件尚未准备成功 [${detail.code}; stage=${detail.stage}]：${detail.message}\n桌面程序将在启动时检查组件。\n`);
    return {prepared:false,failure:detail};
  }
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))await prepareNativeDesktopBeforeStart();

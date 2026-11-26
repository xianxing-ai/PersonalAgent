import {createRequire} from 'node:module';
import {readFileSync,realpathSync,statSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const require=createRequire(import.meta.url);
const desktop=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const installationHint='请在工作区运行 npm run browser:prepare --workspace=@personal-agent/desktop，或重新安装包含浏览器内核的 Synstar。';
export const developmentChromiumPath=path.join(desktop,'.cache','controlled-chromium');

function platformFiles(){
  if(process.platform==='win32'&&process.arch==='x64')return {
    chromium:'chrome-win64/chrome.exe',ffmpeg:'ffmpeg-win64.exe',winldd:'PrintDeps.exe',
  };
  if(process.platform==='linux'&&['arm64','x64'].includes(process.arch))return {
    chromium:process.arch==='arm64'?'chrome-linux-arm64/chrome':'chrome-linux64/chrome',ffmpeg:'ffmpeg-linux',
  };
  if(process.platform==='darwin'&&['arm64','x64'].includes(process.arch))return {
    chromium:`chrome-mac-${process.arch}/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing`,ffmpeg:'ffmpeg-mac',
  };
  throw new Error('此系统和架构没有可用的 Synstar 专用 Chromium 发行包。');
}

/** The desktop package pins the driver; its own manifest pins every native component. */
export function controlledChromiumFiles(){
  const expected=JSON.parse(readFileSync(path.join(desktop,'package.json'),'utf8')).dependencies.playwright;
  const driver=require('playwright/package.json');
  const driverRequire=createRequire(require.resolve('playwright/package.json'));
  const corePath=driverRequire.resolve('playwright-core/package.json');
  if(driver.version!==expected||driverRequire('playwright-core/package.json').version!==expected)
    throw new Error('Playwright 依赖与桌面应用锁定版本不一致，请恢复工作区依赖。');
  const manifest=JSON.parse(readFileSync(path.join(path.dirname(corePath),'browsers.json'),'utf8')).browsers;
  return Object.entries(platformFiles()).map(([name,file])=>{
    const entry=manifest.find(item=>item.name===name);
    if(!entry||!/^\d+$/u.test(entry.revision))throw new Error('Playwright 浏览器组件清单无效。');
    return {name,directory:name+'-'+entry.revision,file};
  });
}

export function locateControlledChromium(){
  const packaged=!!process.versions.electron&&!process.defaultApp;
  const root=packaged?path.join(process.resourcesPath,'controlled-chromium'):developmentChromiumPath;
  const files=controlledChromiumFiles();
  try{
    const installed=realpathSync(root);
    for(const {directory,file} of files){
      const filename=path.join(installed,directory,file);
      const relative=path.relative(installed,realpathSync(filename));
      if(relative.startsWith('..'+path.sep)||path.isAbsolute(relative)||!statSync(filename).isFile()||
        !statSync(path.join(installed,directory,'INSTALLATION_COMPLETE')).isFile())throw new Error('Incomplete browser');
    }
    const chromium=files.find(item=>item.name==='chromium');
    return path.join(installed,chromium.directory,chromium.file);
  }catch{throw Object.assign(new Error('Synstar 专用浏览器组件缺失或不完整。'+installationHint),{code:'ENOENT'});}
}

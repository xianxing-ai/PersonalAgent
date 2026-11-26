import {createRequire} from 'node:module';
import {spawnSync} from 'node:child_process';
import path from 'node:path';
import {developmentChromiumPath,locateControlledChromium} from '../electron/controlled-chromium.js';

// Installation happens at developer setup or packaging time. Runtime launch only validates local files.
const require=createRequire(import.meta.url);
const cli=path.join(path.dirname(require.resolve('playwright/package.json')),'cli.js');
if(process.argv.includes('--windows-package')&&(process.platform!=='win32'||process.arch!=='x64'))
  throw new Error('请在 Windows x64 构建机上准备桌面安装包。');
let executable;
try{executable=locateControlledChromium();}catch(error){if(error.code!=='ENOENT')throw error;}
if(!executable){
  const env={...process.env,PLAYWRIGHT_BROWSERS_PATH:developmentChromiumPath};
  // Let the locked installer select its official mirrors, including for ffmpeg and winldd.
  for(const key of Object.keys(env)){
    if(/^(?:npm_(?:package_)?config_)?PLAYWRIGHT_(?:CHROMIUM_)?DOWNLOAD_HOST$/iu.test(key))delete env[key];
  }
  const result=spawnSync(process.execPath,[cli,'install','--no-shell','chromium'],{
    env,stdio:'inherit',windowsHide:true,
  });
  if(result.error)throw result.error;
  if(result.status!==0)throw new Error('专用 Chromium 安装失败，请检查安装输出后重试。');
  executable=locateControlledChromium();
}
console.info('Synstar 专用 Chromium 已就绪：'+executable);

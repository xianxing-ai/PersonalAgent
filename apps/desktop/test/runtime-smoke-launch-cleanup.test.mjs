import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import path from 'node:path';
import {runInNewContext} from 'node:vm';

const source=readFileSync(new URL('./runtime-application-smoke.cjs',import.meta.url),'utf8');
const launchSource=source.slice(source.indexOf('async function launchDesktop('),source.indexOf('\nasync function openAdmin('));
for(const cleanupFails of [false,true])test(`actual smoke launch retains owned cleanup ${cleanupFails?'failure evidence':'before returning failure'}`,async()=>{
  const app={},startupError=Error('Synthetic identity check failed'),cleanupError=Error('Synthetic cleanup unavailable');
  let cleaned=0;
  const launch=runInNewContext('('+launchSource+')',{Date,path,process:{env:{}},require:{resolve:()=>'/synthetic/playwright/package.json'},
    desktopDir:'/synthetic/desktop',executablePath:'/synthetic/electron.exe',_electron:{launch:async()=>app},evaluateBounded:async()=>12345,
    trackOwnedDesktop(actual){assert.equal(actual,app);throw startupError;},
    closeDesktop:async actual=>{assert.equal(actual,app);cleaned++;if(cleanupFails)throw cleanupError;}});
  await assert.rejects(launch('/synthetic/profile',{}),error=>cleanupFails
    ?error.errors?.[0]===startupError&&error.errors?.[1]===cleanupError:error===startupError);
  assert.equal(cleaned,1);
});

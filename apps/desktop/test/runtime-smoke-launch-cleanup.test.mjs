import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import path from 'node:path';
import {runInNewContext} from 'node:vm';
import {createRequire} from 'node:module';

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


test('startup failure before process registration retains the error without touching an unowned Desktop',async()=>{
  const require=createRequire(import.meta.url);
  const {closeDesktop}=require('../../../tests/manual/agentarts/desktop-pelican-default-live.cjs');
  let closes=0;const app={close:()=>{closes++;}},startupError=Error('Synthetic main identity unavailable');
  const launch=runInNewContext('('+launchSource+')',{Date,path,process:{env:{}},require:{resolve:()=>'/synthetic/playwright/package.json'},
    desktopDir:'/synthetic/desktop',executablePath:'/synthetic/electron.exe',_electron:{launch:async()=>app},
    evaluateBounded:async()=>{throw startupError;},trackOwnedDesktop:()=>assert.fail('identity not obtained'),closeDesktop});
  await assert.rejects(launch('/synthetic/profile',{}),error=>error.errors?.[0]===startupError
    &&/unowned Desktop/u.test(error.errors?.[1]?.message));
  assert.equal(closes,0);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import path from 'node:path';

const main=readFileSync(new URL('../electron/main.js',import.meta.url),'utf8');
const begin=main.indexOf("const hostPath = path.resolve(dir, '../../windows-host/host/bin/Release/net8.0-windows/WindowsHost.Host.exe');");
const end=main.indexOf('if (syntheticFactSource)',begin);
assert.ok(begin>=0&&end>begin,'actual Main Windows Host composition must exist');
function compose({packaged=true,invalid=false,synthetic=false,platform='win32',developmentExists=true}={}){
  let transport,loads=0,developmentReads=0,warnings=0;
  const component={hostPath:'published-host',bridgePath:'published-bridge',manifestSha256:'a'.repeat(64),assertCurrentBundle:()=>true};
  const context={dir:path.resolve('apps/desktop/electron'),path,syntheticMvp:synthetic,notepadHost:undefined,
    process:{platform,resourcesPath:'published-resources'},app:{isPackaged:packaged,getPath:()=>path.resolve('.cache/native-main-userdata')},
    existsSync:()=>{developmentReads++;return developmentExists;},
    readWindowsHostComponent:resources=>{loads++;assert.equal(resources,'published-resources');if(invalid)throw Error('Invalid bundle');return component;},
    createDesktopNotepadHost:options=>options,runtimeModule:{createWindowsHostBridgeTransport:options=>(transport=options)},
    publish(){},console:{warn(){warnings++;}}};
  runInNewContext(main.slice(begin,end),context);
  return {host:context.notepadHost,transport,component,loads,developmentReads,warnings};
}
test('packaged Main forwards the verified Host/Bridge inventory guard to its original transport',()=>{
  const result=compose();assert.ok(result.host);assert.equal(result.loads,1);assert.equal(result.developmentReads,0);
  for(const key of ['hostPath','bridgePath','manifestSha256','assertCurrentBundle'])assert.equal(result.transport[key],result.component[key]);
  assert.equal(result.transport.journalDirectory,path.resolve('.cache/native-main-userdata/native-tools/windows-host-journal'));
});
test('an invalid packaged Host/Bridge never falls back to development files',()=>{
  const result=compose({invalid:true});assert.equal(result.host,undefined);assert.equal(result.transport,undefined);
  assert.equal(result.loads,1);assert.equal(result.developmentReads,0);assert.equal(result.warnings,1);
});
test('development keeps its explicit legacy paths while non-native and synthetic modes do not prepare a host',()=>{
  const result=compose({packaged:false});assert.ok(result.host);assert.equal(result.loads,0);assert.equal(result.developmentReads,2);
  assert.equal(result.transport.assertCurrentBundle,undefined);
  assert.match(result.transport.hostPath,/WindowsHost\.Host\.exe$/);
  for(const options of [{packaged:false,developmentExists:false},{synthetic:true},{platform:'linux'}]){
    const unavailable=compose(options);assert.equal(unavailable.host,undefined);assert.equal(unavailable.loads,0);
  }
});

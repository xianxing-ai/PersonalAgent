import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdirSync,mkdtempSync,readFileSync,writeFileSync,rmSync} from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';

async function fixture(){
  const cache=path.resolve('.cache');mkdirSync(cache,{recursive:true});
  const directory=mkdtempSync(path.join(cache,'runtime-identity-')),dist=path.join(directory,'dist');mkdirSync(dist);
  writeFileSync(path.join(directory,'package.json'),' {"type":"module"}');
  writeFileSync(path.join(dist,'index.js'),'export const fixture = true;\n');
  writeFileSync(path.join(dist,'build-identity.js'),readFileSync(new URL('../dist/build-identity.js',import.meta.url)));
  return {directory,dist,host:await import(pathToFileURL(path.join(dist,'build-identity.js')).href)};
}
test('Runtime artifact identity is stable, byte-bound and invalid after any later dist drift',async()=>{
  const f=await fixture();try{
    const identity=f.host.readRuntimeBuildIdentity();assert.match(identity,/^runtime-artifacts:sha256:[a-f0-9]{64}$/);
    assert.equal(f.host.readRuntimeBuildIdentity(),identity);
    writeFileSync(path.join(f.dist,'index.js'),'export const fixture = false;\n');assert.equal(f.host.readRuntimeBuildIdentity(),undefined);
    writeFileSync(path.join(f.dist,'index.js'),'export const fixture = true;\n');assert.equal(f.host.readRuntimeBuildIdentity(),undefined);
  }finally{rmSync(f.directory,{recursive:true,force:true});}
});
test('a missing original artifact cannot be replaced by a newly inferred loaded Runtime version',async()=>{
  const f=await fixture();try{rmSync(path.join(f.dist,'index.js'));assert.equal(f.host.readRuntimeBuildIdentity(),undefined);}
  finally{rmSync(f.directory,{recursive:true,force:true});}
});

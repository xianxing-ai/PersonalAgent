'use strict';
const assert=require('node:assert/strict');
const path=require('node:path');
const {test}=require('node:test');
const {createHash}=require('node:crypto');
const {countCorrectedModules,names,assertVerifiedPatchPair}=require('./desktop-progressive-development-live.cjs');
const root=path.resolve('synthetic-public-fixture');
const content=(index,operator)=>`'use strict';\nmodule.exports = value => value ${operator} ${index+1};\n`;

test('progress observes exact corrected bytes across the complete public source set',()=>{
  const seen=[];
  const observation=countCorrectedModules(root,{readText:file=>{
    const index=names.indexOf(path.basename(file));assert.ok(index>=0);seen.push(file);
    return content(index,index<4?'+':'-');
  }});
  assert.deepEqual(observation,{available:true,correctedModules:4});
  assert.deepEqual(seen,names.map(name=>path.join(root,name)));
});

test('a transient native sharing lock makes only that sample unobservable; the next complete sample retains exact counts',()=>{
  let busy=true;
  const readText=file=>{
    const index=names.indexOf(path.basename(file));
    if(busy&&index===12)throw Object.assign(Error('Synthetic exclusive writer lock'),{code:'EBUSY'});
    return content(index,'+');
  };
  assert.deepEqual(countCorrectedModules(root,{readText}),{available:false,code:'EBUSY',relativePath:'metric-13.cjs'});
  busy=false;
  assert.deepEqual(countCorrectedModules(root,{readText}),{available:true,correctedModules:14});
});

test('missing files, denied reads and unrelated failures remain acceptance failures',()=>{
  for(const code of ['ENOENT','EACCES','EPERM','EIO']){
    const original=Object.assign(Error('Synthetic read failure'),{code});
    assert.throws(()=>countCorrectedModules(root,{readText:()=>{throw original;}}),error=>error===original);
  }
});

test('unexpected source bytes cannot count as corrected progress',()=>{
  assert.deepEqual(countCorrectedModules(root,{readText:()=>content(0,'+')+'\n'}),{available:true,correctedModules:0});
});

function patchPair(){
  const sourceText=content(0,'-'),expectedText=content(0,'+'),name=names[0];
  const hash=text=>createHash('sha256').update(text).digest('hex');
  const original={path:name,beforeSha256:hash(sourceText),afterSha256:hash(expectedText)};
  return {name,sourceText,expectedText,
    previewArguments:{path:name,expectedSha256:original.beforeSha256,edits:[{oldText:'value - 1;',newText:'value + 1;'}]},
    applyArguments:{path:name,expectedSha256:original.beforeSha256,edits:[{oldText:'value - 1',newText:'value + 1'}]},
    previewResult:{...original,changed:true,previewText:expectedText},applyResult:{...original,applied:true}};
}

test('separately bound preview and apply may select different spans only when the exact original and final documents match',()=>{
  const pair=patchPair();assert.notDeepEqual(pair.previewArguments,pair.applyArguments);
  assert.doesNotThrow(()=>assertVerifiedPatchPair(pair));
});

test('patch-pair readback rejects different inputs, source hashes, output hashes, predicted text or execution state',()=>{
  const cases=[
    pair=>{pair.applyArguments.path=names[1];},pair=>{pair.previewArguments.path=names[1];},
    pair=>{pair.applyArguments.expectedSha256='0'.repeat(64);},pair=>{pair.previewArguments.expectedSha256='0'.repeat(64);},
    pair=>{pair.previewResult.beforeSha256='0'.repeat(64);},pair=>{pair.applyResult.beforeSha256='0'.repeat(64);},
    pair=>{pair.previewResult.afterSha256='0'.repeat(64);},pair=>{pair.applyResult.afterSha256='0'.repeat(64);},
    pair=>{pair.previewResult.previewText+='\n';},pair=>{pair.previewResult.changed=false;},
    pair=>{pair.applyResult.applied=false;},pair=>{pair.applyResult.path=names[1];},
  ];
  for(const mutate of cases){const pair=patchPair();mutate(pair);assert.throws(()=>assertVerifiedPatchPair(pair));}
});

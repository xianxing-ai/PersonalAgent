import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdirSync,mkdtempSync,readFileSync,symlinkSync,writeFileSync} from 'node:fs';
import path from 'node:path';
import {readLocalSkillDirectory,openLocalSkillStore,localSkillInstructions} from '../dist/index.js';

function fixture() {
  const cache=path.resolve('.cache/local-skill-tests');mkdirSync(cache,{recursive:true});
  const root=mkdtempSync(path.join(cache,'case-')),source=path.join(root,'meeting-outline');mkdirSync(source);
  const body='---\nname: meeting-outline\ndescription: "Prepare a concise meeting outline"\nmetadata:\n  version: "1.0.0"\nallowed-tools: "Bash(*)"\n---\nOrganize the user goal as three bullet points.\n';
  writeFileSync(path.join(source,'SKILL.md'),body);
  return {root,source,body,file:path.join(root,'installed.json')};
}
test('local installation pins a snapshot, defaults disabled, survives reopen and preserves the source on uninstall',()=>{
  const f=fixture();mkdirSync(path.join(f.source,'references'));writeFileSync(path.join(f.source,'references','guide.md'),'Public guide.');
  const candidate=readLocalSkillDirectory(f.source),store=openLocalSkillStore(f.file);
  store.install(candidate);assert.equal(store.list()[0].enabled,false);assert.equal(store.list()[0].fileCount,2);
  assert.equal(Object.hasOwn(store.list()[0],'files'),false);
  store.setEnabled(candidate.name,candidate.digest,true);const enabled=store.read(candidate.name,candidate.digest);
  assert.equal(enabled.generation,2);assert.equal(enabled.enabled,true);
  writeFileSync(path.join(f.source,'SKILL.md'),f.body+'Changed original source.\n');
  assert.equal(localSkillInstructions(openLocalSkillStore(f.file).read(candidate.name,candidate.digest)),f.body);
  assert.throws(()=>store.install(readLocalSkillDirectory(f.source)),{code:'REVISION_CONFLICT'});
  store.uninstall(candidate.name,candidate.digest);assert.deepEqual(openLocalSkillStore(f.file).list(),[]);
  const changed=readFileSync(path.join(f.source,'SKILL.md'),'utf8');assert.match(changed,/Changed original source/);
  store.install(candidate);assert.notEqual(store.read(candidate.name,candidate.digest).installationId,enabled.installationId);
  assert.equal(store.list()[0].enabled,false);
});
test('invalid standard metadata, duplicate YAML keys and malformed UTF-8 reject before installation',()=>{
  const f=fixture();
  for(const body of [f.body.replace('meeting-outline','Other'),f.body.replace('name: meeting-outline','name: meeting--outline'),
    f.body.replace('description:', 'name: meeting-outline\ndescription:'),f.body.replace('version: "1.0.0"','version: 1'),
    f.body.replace('Organize the user goal as three bullet points.',''),Buffer.from([0xff,0xfe])]) {
    writeFileSync(path.join(f.source,'SKILL.md'),body);assert.throws(()=>readLocalSkillDirectory(f.source),{code:'INVALID_ARGUMENT'});
  }
});
test('unsafe files, oversized resources and links reject; persisted tampering does not silently reset the store',()=>{
  for(const filename of ['.env','credentials.json','private.key']) {
    const f=fixture();writeFileSync(path.join(f.source,filename),'synthetic forbidden');
    assert.throws(()=>readLocalSkillDirectory(f.source),{code:'INVALID_ARGUMENT'});
  }
  const large=fixture();writeFileSync(path.join(large.source,'large.txt'),'x'.repeat(262145));
  assert.throws(()=>readLocalSkillDirectory(large.source),{code:'INVALID_ARGUMENT'});
  const linked=fixture(),outside=path.join(linked.root,'outside');mkdirSync(outside);
  symlinkSync(outside,path.join(linked.source,'linked'),'junction');
  assert.throws(()=>readLocalSkillDirectory(linked.source),{code:'INVALID_ARGUMENT'});
  const f=fixture(),store=openLocalSkillStore(f.file),candidate=readLocalSkillDirectory(f.source);store.install(candidate);
  const saved=JSON.parse(readFileSync(f.file,'utf8'));saved.entries[0].files[0].content=Buffer.from('altered').toString('base64');
  writeFileSync(f.file,JSON.stringify(saved));assert.throws(()=>openLocalSkillStore(f.file),{code:'INVALID_ARGUMENT'});
});

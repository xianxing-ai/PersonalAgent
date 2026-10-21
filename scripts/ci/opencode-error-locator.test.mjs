import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {REPOSITORY,MODELS,DISCLAIMER,validRun,matchingPr,marker,safeLine,errorExcerpt,annotationExcerpt,locations,sourceExcerpt,
  isolatedEnv,parseModel,locate,commentBody,reportBody} from './opencode-error-locator.mjs';
const run={id:123,run_attempt:2,name:'Foundation',path:'.github/workflows/ci.yml',event:'pull_request',status:'completed',conclusion:'failure',head_sha:'a'.repeat(40),repository:{full_name:REPOSITORY,private:false}};
const pr={number:471,state:'open',head:{sha:run.head_sha},base:{ref:'main',repo:{full_name:REPOSITORY,private:false}}};
const report={number:471,runId:123,attempt:2,head:run.head_sha,status:'suggestion',model:MODELS[0],text:'可能位于 apps/example.js:2，需核实。'};

test('only exact Foundation failed PR or merge queue runs qualify',()=>{
  assert.ok(validRun(run));assert.ok(validRun({...run,event:'merge_group'}));
  for(const edit of [{id:'123'},{run_attempt:0},{name:'other'},{path:'evil.yml'},{event:'push'},
    {status:'in_progress'},{conclusion:'success'},{head_sha:'bad'},{repository:{full_name:REPOSITORY,private:true}}])assert.equal(validRun({...run,...edit}),false);
});
test('PR must be current, open, public and in the target repository',()=>{
  assert.ok(matchingPr(pr,run));
  for(const edit of [{number:'471'},{state:'closed'},{head:{sha:'b'.repeat(40)}},
    {base:{ref:'main',repo:{full_name:'other/repo',private:false}}},
    {base:{ref:'main',repo:{full_name:REPOSITORY,private:true}}}])assert.equal(matchingPr({...pr,...edit},run),false);
});
test('secret-shaped values, credentials, URLs and emails are removed',()=>{
  for(const value of ['Authorization: Bearer abc','password=abc','API_KEY=abc','Cookie: session=abc',
    '-----BEGIN PRIVATE KEY-----','token ghp_abc123','sk-testvalue','https://host/?key=x','owner@example.com',
    'ABCDEFGHIJKLMNOPQRSTUVWXYZ123456789'])assert.equal(safeLine(value),'[敏感片段已省略]');
  assert.equal(safeLine('\u001b[31mTypeError: bad value\u001b[0m'),'TypeError: bad value');
});
test('error extraction is bounded and does not share entire logs',()=>{
  const lines=errorExcerpt('ordinary startup\nordinary progress\nTypeError: x\n at apps/runtime/file.ts:3:4\nordinary end');
  assert.ok(lines.some(l=>l.includes('TypeError')));assert.ok(!lines.includes('ordinary startup'));
  assert.ok(!lines.some(l=>l.includes('password')));
  assert.ok(errorExcerpt('Error: bad\n'.repeat(1000)).length<=100);
  assert.deepEqual(errorExcerpt('x'.repeat(1000001)),[]);
  assert.deepEqual(errorExcerpt('Error: password follows\nhunter2\nretry failed'),[]);
  assert.deepEqual(errorExcerpt('TypeError: x\nTOKEN=\nshort-value'),[]);
});
test('successful tests mentioning errors do not exhaust failure evidence',()=>{
  const noise='✔ handles error and failed exception state\n'.repeat(200);
  const excerpt=errorExcerpt(noise+'not ok 201 - broken calculation\nTypeError: missing input\n at apps/runtime/math.ts:8:2');
  assert.ok(excerpt.some(line=>line.includes('not ok 201')));
  assert.ok(excerpt.some(line=>line.includes('math.ts:8')));
  assert.ok(excerpt.length<20);
  const separated='Error: password follows\nhunter2\n'+'ordinary progress\n'.repeat(20)+'TypeError: clean failure\n at apps/runtime/math.ts:8';
  const clean=errorExcerpt(separated);
  assert.ok(clean.some(line=>line.includes('clean failure')));
  assert.ok(!clean.some(line=>line.includes('hunter2')));
});
test('bounded failure annotations remain usable when full logs are unavailable',()=>{
  const annotations=[{annotation_level:'failure',message:'Type string is not assignable to number',path:'apps/runtime/main.ts',start_line:12},
    {annotation_level:'failure',message:'Process completed with exit code 1.'},
    {annotation_level:'failure',message:'password follows\nhunter2'},
    {annotation_level:'warning',message:'not a failure'}];
  const lines=annotationExcerpt(annotations);
  assert.deepEqual(lines,['Error annotation: Type string is not assignable to number','apps/runtime/main.ts:12']);
  assert.ok(annotationExcerpt(Array(100).fill(annotations[0])).length<=60);
  assert.deepEqual(annotationExcerpt([{annotation_level:'failure',message:'x'.repeat(8001)}]),[]);
});
test('source locations are scoped, bounded, traversal-safe and retain line mapping',()=>{
  const found=locations(['at apps\\runtime\\file.ts:3:4','tests/../outside.js:4','packages/a/test.mjs:12',
    'scripts/ci/test.cjs:9','apps/other.js:20','/etc/passwd:3']);
  assert.deepEqual(found,[{file:'apps/runtime/file.ts',line:3},{file:'packages/a/test.mjs',line:12},{file:'scripts/ci/test.cjs',line:9}]);
  assert.equal(sourceExcerpt('a\nb\nc',found[0]).startLine,1);
  assert.equal(sourceExcerpt('a',found[0]),null);
  assert.equal(sourceExcerpt('password=\nshort-value\nc',found[0]),null);
});
test('only three free models, in user requested order; no inherited credentials',()=>{
  assert.deepEqual(MODELS,['opencode/minimax-m3.1-flash-free','opencode/deepseek-v4.1-flash-free','opencode/glm-5.3-flash-free']);
  const env=isolatedEnv('/tmp/fresh',MODELS[1]), config=JSON.parse(env.OPENCODE_CONFIG_CONTENT);
  assert.equal(env.GITHUB_TOKEN,undefined);assert.equal(env.OPENAI_API_KEY,undefined);assert.equal(env.NODE_OPTIONS,undefined);
  assert.equal(config.model,MODELS[1]);assert.equal(config.small_model,MODELS[1]);assert.equal(config.share,'disabled');
  assert.deepEqual(config.permission,{'*':'deny'});assert.deepEqual(config.agent.locator.tools,{'*':false});
  assert.throws(()=>isolatedEnv('/tmp/fresh','paid/model'));
});
test('model tool requests, errors and malformed/oversized output fail closed',()=>{
  assert.equal(parseModel('{"type":"text","part":{"text":"location"}}'),'location');
  for(const text of ['bad','{}','{"type":"tool_use"}','{"type":"error"}',JSON.stringify({type:'text',part:{text:'x'.repeat(14001)}})])assert.throws(()=>parseModel(text));
});
test('free-only bounded fallback, no tool or credential access, explicit fixed title',async()=>{
  const calls=[];
  const result=await locate({errors:[{lines:['TypeError: synthetic']}]},'/trusted/cli',{execute:(cmd,args,options)=>{
    calls.push({cmd,args,options});return calls.length===1?{status:1}:{status:0,stdout:'{"type":"text","part":{"text":"suggestion"}}'};
  }});
  assert.equal(result.model,MODELS[1]);assert.equal(calls.length,2);
  assert.ok(calls[0].args.includes('--pure'));assert.ok(calls[0].args.includes('--title'));
  assert.equal(calls[0].options.env.GITHUB_TOKEN,undefined);assert.equal(calls[0].options.timeout,80000);
  assert.ok(calls[0].options.input.includes('不评审整个 PR'));assert.ok(calls[0].options.input.includes('UNTRUSTED_ERROR_DATA_JSON'));
});
test('all model failures stop; oversized input is not transmitted',async()=>{
  let count=0;
  const unavailable=await locate({errors:[]},'/trusted/cli',{execute:()=>{count++;return {status:1};}});
  assert.equal(count,3);assert.equal(unavailable.status,'unavailable');
  const oversized=await locate({text:'x'.repeat(70001)},'/trusted/cli',{execute:()=>{throw Error('must not run');}});
  assert.equal(oversized.status,'insufficient');
});
test('every output contains mandatory disclaimer, cannot escape inert block',()=>{
  for(const status of ['suggestion','unavailable','insufficient'])assert.ok(commentBody({...report,status},run,pr).includes(DISCLAIMER));
  const body=commentBody({...report,text:'```\n@all <img src="evil">\n```'},run,pr);
  assert.ok(body.startsWith(marker(run)));assert.ok(!body.includes('@all'));assert.ok(!body.includes('<img'));
  assert.equal((body.match(/```/g)||[]).length,2);
  assert.ok(reportBody({...report,number:null},{...run,event:'merge_group'}).includes(DISCLAIMER));
  assert.ok(commentBody(report,run,pr).includes('不补取 PR head 源码'));
});
test('publication rejects stale run attempts, SHA, PR numbers and paid model',()=>{
  for(const edit of [{number:472},{runId:124},{attempt:1},{head:'b'.repeat(40)},{model:'paid/model'},{status:'approved'}])assert.throws(()=>commentBody({...report,...edit},run,pr));
});
test('workflow has trusted checkout and separate no-model write job',async()=>{
  const yaml=await readFile(new URL('../../.github/workflows/opencode-error-locator.yml',import.meta.url),'utf8');
  assert.ok(yaml.includes('workflows: [Foundation]'));assert.ok(yaml.includes("event == 'merge_group'"));
  assert.ok(!yaml.includes('head_sha }}')&&!yaml.includes('secrets.')&&!yaml.includes('npm ci'));
  assert.equal((yaml.match(/ref: \$\{\{ github.sha \}\}/g)||[]).length,2);
  assert.ok(!yaml.split('  publish:')[0].includes('pull-requests: write'));
  assert.ok(yaml.includes('opencode-linux-x64-baseline@1.19.3'));
});

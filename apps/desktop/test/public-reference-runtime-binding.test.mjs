import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
import {createPublicReferenceQuestionConsent} from '../electron/public-reference-question.js';

// Actual Main source; the assembly order is asserted on the parsed program,
// never on a reformatted copy of it.
const source=readFileSync(new URL('../electron/main.js',import.meta.url),'utf8');
const ast=ts.createSourceFile('main.js',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.JS);

function statementLists(){
  const lists=[];
  const visit=node=>{if(ts.isBlock(node)||ts.isSourceFile(node))lists.push(node.statements);ts.forEachChild(node,visit);};
  visit(ast);
  return lists;
}
const statementText=statement=>statement.getText(ast).trim();
function locate(predicate,label){
  const lists=statementLists();
  const hits=[];
  for(const list of lists)for(const statement of list)if(predicate(statement))hits.push({statement,list});
  assert.equal(hits.length,1,`exactly one actual Main statement ${label}`);
  return hits[0];
}

test('Main binds the public-reference Runtime instance only after the Runtime application is created',()=>{
  // The premature capture was `const referenceApplication=runtimeApplication;`
  // placed before createAgentArtsRuntimeApplication; it froze `undefined` and
  // denied every native export preflight.
  assert.ok(!/const\s+referenceApplication\s*=/u.test(source),
    'the public-reference Runtime instance must never be captured before it exists');
  const declarations=ast.statements.filter(node=>ts.isVariableStatement(node))
    .flatMap(node=>node.declarationList.declarations)
    .filter(node=>node.name.getText(ast)==='referenceApplication');
  assert.equal(declarations.length,1,'exactly one module-scope referenceApplication declaration');
  assert.equal(declarations[0].parent.parent.parent,ast,'referenceApplication is declared at module scope');
  assert.ok(declarations[0].parent.parent.declarationList.flags&ts.NodeFlags.Let,
    'referenceApplication must stay reassignable at module scope');

  const created=locate(statement=>/^runtimeApplication\s*=\s*runtimeModule\.createAgentArtsRuntimeApplication\(/u.test(statementText(statement)),
    'that creates the Runtime application');
  const bound=locate(statement=>statementText(statement)==='referenceHost.bindApplication(runtimeApplication);',
    'that binds the reference host');
  const assigned=locate(statement=>statementText(statement)==='referenceApplication=runtimeApplication;',
    'that binds the public-reference Runtime instance');
  assert.equal(created.list,bound.list,'the Runtime creation and the reference binding share one statement list');
  assert.equal(created.list,assigned.list,'the Runtime creation and the public-reference binding share one statement list');
  assert.ok(created.list.indexOf(created.statement)<created.list.indexOf(bound.statement),
    'the Runtime application must exist before the reference host binds it');
  assert.ok(created.list.indexOf(bound.statement)<created.list.indexOf(assigned.statement),
    'the reference host must bind the Runtime application before the public-reference instance is bound');
  assert.ok(created.list.indexOf(created.statement)<created.list.indexOf(assigned.statement),
    'the public-reference Runtime instance must be bound after the Runtime application is created');

  // The consent host must compare the live Runtime against that binding.
  const consent=locate(statement=>statementText(statement).startsWith('const confirmPublicReference=createPublicReferenceQuestionConsent('),
    'that creates the public-reference consent host');
  assert.match(statementText(consent.statement),/isCurrent:\(\)=>runtimeApplication===referenceApplication/);
});

// Explicit Synthetic question host. It does not establish Runtime, model or
// native source acceptance; it only records the prepared requirements.
function syntheticQuestionHost(){
  const entries=new Map(),key=scope=>JSON.stringify([scope.taskId,scope.runId]);
  const host={entries,prepare(scope,{requirements,assertCurrent}){
    const entry=entries.get(key(scope))??{scope,requirements:[],guards:[]};
    entry.requirements.push(...requirements);
    if(assertCurrent)entry.guards.push(assertCurrent);
    entries.set(key(scope),entry);},
    prepareExport(scope,{requirementId,...requirement}){
    host.prepare(scope,{requirements:[{...requirement,requirementId,kind:'export'}]});},
    currentRequirement(scope,id){const entry=entries.get(key(scope));assert.ok(entry,'no exact Synthetic decision');
    assert.ok(entry.requirements.some(requirement=>requirement.requirementId===id));},
    authorizeExport(scope,value,id){host.currentRequirement(scope,id);},
    assertConsumedResult(){},authorizeConsumedExport(){},
    readResourceGeneration(){return 'synthetic-generation';},rotateResourceGeneration(){}};
  return host;
}
function publicReferenceFixture(){
  const deadline=new Date(Date.now()+60_000).toISOString();
  const original={taskId:'task',proposalId:'proposal',runId:'run',toolName:'workspace.read_text',toolVersion:'1.0.0',
    arguments:{path:'public.md'},deadline};
  const question=syntheticQuestionHost();
  const readOriginalScope=(taskId,runId)=>taskId===original.taskId&&runId===original.runId?structuredClone(original):undefined;
  const context={deadline,signal:new AbortController().signal,runId:'run'};
  const request={phase:'preflight',query:{taskId:'task',proposalId:'proposal',path:'public.md',configurationRef:'configuration'},
    toolName:'workspace.read_text',maxExportBytes:1024,purpose:'coding-reference',expiresAt:deadline};
  return {deadline,original,question,context,request,readOriginalScope};
}
function consentHost(f,{isCurrent}){
  return createPublicReferenceQuestionConsent({question:f.question,confirmApplicationAuthorization:async()=>true,
    readMcpDescriptor:()=>undefined,readSkillManifest:()=>undefined,readOriginalScope:f.readOriginalScope,isCurrent});
}

test('public-reference preflight passes on the bound Runtime instance and is denied once that instance is replaced',async()=>{
  const f=publicReferenceFixture();
  // Actual Main order: the consent host exists before the Runtime application,
  // and the instance is bound only after it has been created.
  let runtimeApplication,referenceApplication;
  const consent=consentHost(f,{isCurrent:()=>runtimeApplication===referenceApplication});
  runtimeApplication={id:'runtime'};referenceApplication=runtimeApplication;
  assert.equal(await consent(f.request,f.context),true);
  assert.deepEqual(f.question.entries.get(JSON.stringify(['task','run'])).requirements.map(item=>item.requirementId),
    ['public-reference-read','public-reference-export']);
  runtimeApplication={id:'replacement'};
  assert.equal(await consent(f.request,f.context),false,
    'a replaced Runtime instance must not keep the public-reference preflight');
});

test('the premature public-reference capture denies every preflight, so the binding order stays observable',async()=>{
  const f=publicReferenceFixture();
  // The reverted defect: the instance is captured before the Runtime exists.
  let runtimeApplication,referenceApplication;
  const consent=consentHost(f,{isCurrent:()=>runtimeApplication===referenceApplication});
  referenceApplication=runtimeApplication;
  runtimeApplication={id:'runtime'};
  assert.equal(await consent(f.request,f.context),false,
    'capturing the Runtime instance before it exists must never authorize a public-reference preflight');
  assert.equal(f.question.entries.size,0,'a denied preflight must not prepare any requirement');
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
import {errorDisplay,errorDisplayText} from '../src/shared/error-display.js';

const source=readFileSync(new URL('../electron/main.js',import.meta.url),'utf8');
const ast=ts.createSourceFile('main.js',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.JS);
const helper=ast.statements.find(node=>ts.isFunctionDeclaration(node)&&node.name?.text==='confirmApplicationAuthorization').getText(ast);
const cancelled={code:'CANCELLED',message:'synthetic-private-cancellation'};
const unknown={code:'RESULT_UNKNOWN',message:'synthetic-private-unknown'};
function fixture(){
  const requests=[],published=[],application={};
  const context={admin:{isDestroyed:()=>false},panel:undefined,workspace:undefined,runtimeApplication:application,
    runtimeError:'AgentArts 配置尚未就绪',applicationAuthorizationRevision:0,applicationAuthorizationDecisionNotice:undefined,
    errorDisplay,errorDisplayText,publish(){published.push(context.runtimeError);},
    authorizationIntentHost:{request(request){return new Promise(resolve=>requests.push({request,resolve}));}}};
  const confirm=new Function('context','with(context){return '+helper+';}')(context);
  return {context,requests,published,confirm,finish(index,{allowed=false,error}={}){
    if(error)requests[index].request.onError(error);
    requests[index].resolve(allowed);
  }};
}

test('a new authorization retires only its prior cancelled or denied decision and restores the underlying configuration error',async()=>{
  for(const error of [undefined,cancelled,{code:'UNAUTHORIZED',message:'synthetic-private-denial'}]){
    const f=fixture(),first=f.confirm('skill.install',{});f.finish(0,{error});assert.equal(await first,false);
    assert.equal(errorDisplay(f.context.runtimeError,'runtime').code,error?.code??'UNAUTHORIZED');
    assert.doesNotMatch(f.context.runtimeError,/synthetic-private/);
    const second=f.confirm('skill.install',{});
    assert.equal(f.context.runtimeError,'AgentArts 配置尚未就绪');
    f.finish(1,{allowed:true});assert.equal(await second,true);
    assert.equal(f.context.runtimeError,'AgentArts 配置尚未就绪');
    assert.equal(f.published.at(-1),'AgentArts 配置尚未就绪');
  }
});

test('a new authorization preserves an unrelated error that replaced its old cancellation',async()=>{
  const f=fixture(),first=f.confirm('skill.install',{});f.finish(0,{error:cancelled});await first;
  const current=errorDisplayText({code:'CONNECTION',message:'synthetic-private-connection'},'runtime');
  f.context.runtimeError=current;
  const second=f.confirm('skill.install',{});assert.equal(f.context.runtimeError,current);
  f.finish(1,{allowed:true});await second;assert.equal(f.context.runtimeError,current);
});

test('a new authorization keeps an unresolved result visible after a later successful decision',async()=>{
  const f=fixture(),first=f.confirm('skill.install',{});f.finish(0,{error:unknown});await first;
  const original=f.context.runtimeError;assert.match(original,/code=RESULT_UNKNOWN/);
  const second=f.confirm('skill.install',{});assert.equal(f.context.runtimeError,original);
  f.finish(1,{allowed:true});await second;assert.equal(f.context.runtimeError,original);
});

test('an older cancelled request cannot replace a newer authorization result',async()=>{
  const f=fixture(),first=f.confirm('skill.install',{}),second=f.confirm('skill.enable',{});
  f.finish(1,{allowed:true});assert.equal(await second,true);
  f.finish(0,{error:cancelled});assert.equal(await first,false);
  assert.equal(f.context.runtimeError,'AgentArts 配置尚未就绪');assert.deepEqual(f.published,[]);
});

test('an older unknown outcome remains visible even if a newer authorization succeeds',async()=>{
  const f=fixture(),first=f.confirm('skill.install',{}),second=f.confirm('skill.enable',{});
  f.finish(1,{allowed:true});assert.equal(await second,true);
  f.finish(0,{error:unknown});assert.equal(await first,false);
  assert.match(f.context.runtimeError,/code=RESULT_UNKNOWN/);
  const third=f.confirm('skill.enable',{});assert.match(f.context.runtimeError,/code=RESULT_UNKNOWN/);
  f.finish(2,{allowed:true});await third;assert.match(f.context.runtimeError,/code=RESULT_UNKNOWN/);
});

test('a completed request cannot publish an error into a replacement Runtime or a destroyed owner',async()=>{
  for(const invalidate of [f=>{f.context.runtimeApplication={};},f=>{f.context.admin.isDestroyed=()=>true;}]){
    const f=fixture(),first=f.confirm('skill.install',{});invalidate(f);
    f.finish(0,{error:cancelled});assert.equal(await first,false);
    assert.equal(f.context.runtimeError,'AgentArts 配置尚未就绪');assert.deepEqual(f.published,[]);
  }
});

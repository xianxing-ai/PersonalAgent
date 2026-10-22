import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';

const source=readFileSync(new URL('../electron/desktop-host.js',import.meta.url),'utf8');
const ast=ts.createSourceFile('desktop-host.js',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.JS);
let declaration;
function find(node){if(ts.isFunctionDeclaration(node)&&node.name?.text==='logAgentArtsFailure')declaration=node;ts.forEachChild(node,find);}find(ast);
function fixture(){const lines=[];return {lines,log:vm.runInNewContext('('+declaration.getText(ast)+')',{
  log:(event,mode,detail)=>lines.push({event,mode,detail:JSON.parse(detail)}),
})};}
const requestId='12345678-1234-4234-8234-123456789abc';
test('safe AgentArts projection retains rate limits and typed unknown/upgrade facts',()=>{
  const {log,lines}=fixture();
  log({stage:'transport',code:'RATE_LIMITED',requestId,resultUnknown:true,transportPhase:'wss_upgrade',httpStatus:429});
  assert.deepEqual(lines,[{event:'agentarts-failure',mode:'runtime',detail:{stage:'transport',code:'RATE_LIMITED',requestId,
    resultUnknown:true,transportPhase:'wss_upgrade',httpStatus:429}}]);
  log({stage:'transport',code:'EXTERNAL_FAILURE',resultUnknown:false});assert.equal(lines[1].detail.resultUnknown,false);
});
test('arbitrary content, URL, headers, credentials and prototype fields never enter diagnostics',()=>{
  const {log,lines}=fixture(),privateText='PRIVATE_BODY_https://private.invalid/?token=PRIVATE_TOKEN';
  log({stage:'application_schema',code:'EXTERNAL_FAILURE',requestId:privateText,httpStatus:privateText,
    resultUnknown:privateText,transportPhase:privateText,contentType:privateText,
    schemaCategory:'provider_failure',providerErrorCode:privateText,providerFailureField:privateText,providerFailureToken:privateText,
    terminalEvents:{taskEnd:true,end:false,body:privateText},body:privateText,text:privateText,url:privateText,
    headers:{Authorization:privateText},token:privateText,__proto__:{toJSON(){return privateText;}}});
  assert.deepEqual(lines[0].detail,{stage:'application_schema',code:'EXTERNAL_FAILURE',
    terminalEvents:{taskEnd:true,end:false},schemaCategory:'provider_failure'});
  assert.equal(JSON.stringify(lines).includes(privateText),false);
  for(const value of [undefined,null,privateText,{stage:privateText,code:'TIMEOUT'},{stage:'transport',code:privateText}])log(value);
  assert.equal(lines.length,1);
});
test('diagnostic projection never invokes accessors or leaks thrown proxy messages',()=>{
  const {log,lines}=fixture();let reads=0;
  const receipt={stage:'transport',code:'TIMEOUT',get requestId(){reads++;throw Error('PRIVATE_MESSAGE');},
    terminalEvents:{get taskEnd(){reads++;throw Error('PRIVATE_MESSAGE');}}};
  assert.doesNotThrow(()=>log(receipt));assert.equal(reads,0);
  assert.deepEqual(lines[0].detail,{stage:'transport',code:'TIMEOUT'});
  assert.doesNotThrow(()=>log(new Proxy({},{getOwnPropertyDescriptor(){throw Error('PRIVATE_MESSAGE');}})));
  assert.equal(lines.length,1);
});

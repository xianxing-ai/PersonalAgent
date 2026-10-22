import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdirSync,mkdtempSync} from 'node:fs';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {Client} from '@personal-agent/client';
import {createRuntimeApplication,createCalendarEventReadTool} from '@personal-agent/runtime/application';
import {createCalendarConfig} from '../electron/calendar-config.js';
import {createDesktopCalendarMeetingHost,calendarConfigurationId} from '../electron/calendar-meeting-host.js';

const cache=new URL('../../../.cache/calendar-question-consumer/',import.meta.url);mkdirSync(cache,{recursive:true});
const safeStorage={isEncryptionAvailable:()=>true,encryptString:value=>Buffer.from(value).reverse(),decryptString:value=>Buffer.from(value).reverse().toString()};
const until=async predicate=>{for(let index=0;index<100;index++){if(predicate())return;await new Promise(resolve=>setTimeout(resolve,5));}throw Error('Synthetic read did not settle');};

for(const revokeWhileCredentialsWait of [false,true])test('Synthetic calendar original Runtime read '+(revokeWhileCredentialsWait?'blocks revoked receipt at the real fetch boundary':'reaches guarded fetch and keeps configuration separate'),async t=>{
  const userData=mkdtempSync(new URL('run-',cache)),resources=new Map();let prepared,allowed=false,resolveCredentials,credentialStarted=false,fetches=0,host;
  const question={
    readResourceGeneration(resource){if(!resources.has(resource))resources.set(resource,randomUUID());return resources.get(resource);},
    rotateResourceGeneration(resource,expected){assert.equal(this.readResourceGeneration(resource),expected);resources.set(resource,randomUUID());},
    prepare(scope,options){prepared={scope,...options};},
    currentRequirement(scope,id){assert.equal(scope.taskId,prepared.scope.taskId);assert.equal(scope.runId,prepared.scope.runId);assert.equal(id,'calendar-local-read');
      if(!allowed||scope.signal.aborted||prepared.assertCurrent()!==true)throw Error('Synthetic original receipt revoked');return true;}};
  const config=createCalendarConfig({userData,safeStorage,question});config.configure({providerKind:'caldav',calendarUrl:'https://synthetic.invalid/calendar/',
    calendarName:'Synthetic calendar',username:'Synthetic account',password:'Synthetic password'});
  assert.equal(config.snapshot().sessionAllowed,false);
  const tool=createCalendarEventReadTool({getBinding:()=>{const binding=config.binding();return binding?{configurationId:calendarConfigurationId(binding),
    accountRef:binding.accountRef,calendarUrl:binding.calendarUrl}:undefined;},
    readAuthorization:()=>{credentialStarted=true;return new Promise(resolve=>{resolveCredentials=resolve;});},
    fetchImpl:()=>{host.assertCurrentRead();fetches++;return Promise.resolve({ok:true,status:207,text:async()=>
      '<multistatus><response><href>/calendar/one.ics</href><propstat><prop><calendar-data>BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\nUID:synthetic-uid\r\nDTSTART:20301021T080000Z\r\nDTEND:20301021T090000Z\r\nSUMMARY:Synthetic meeting\r\nSEQUENCE:1\r\nEND:VEVENT\r\nEND:VCALENDAR</calendar-data></prop></propstat></response></multistatus>'});}});
  host=createDesktopCalendarMeetingHost({config,namespace:'Synthetic-calendar',question,readTool:tool,
    readArguments:(binding,externalId)=>({configurationId:calendarConfigurationId(binding),externalId})});
  const app=createRuntimeApplication({path:path.join(userData,'runtime.sqlite'),profile:'huawei_ict_agentarts',hostUserNamespace:'Synthetic-calendar',tools:host.tools});
  app.runtime.provisionCoordinationStore('Synthetic-calendar');host.bindApplication(app);
  t.after(async()=>{host.close();await until(()=>app.activeTaskCount===0);app.close();});
  const result=host.read({externalId:'synthetic-uid'});await until(()=>app.readHostToolTask(result.taskId).approval?.state==='pending');
  assert.equal(fetches,0);const original=app.readHostToolTask(result.taskId),scope={taskId:result.taskId,runId:'host-tool-'+result.taskId,
    toolName:tool.descriptor.name,toolVersion:tool.descriptor.version,deadline:app.runtime.loadCheckpoint(result.taskId,'host-tool-intent').deadline,
    signal:new AbortController().signal};
  host.prepareAuthorization(scope);assert.equal(prepared.requirements[0].kind,'connector_session');allowed=true;
  const client=new Client(app);await client.connect();await client.call('authorization.respond',{approvalId:original.approval.approvalId,
    expectedRevision:original.approval.revision,decision:'allow_once'});
  await until(()=>credentialStarted);if(revokeWhileCredentialsWait)allowed=false;resolveCredentials('Basic U3ludGhldGljOlN5bnRoZXRpYw==');
  await until(()=>['succeeded','failed'].includes(app.runtime.getTask(result.taskId).state));
  assert.equal(fetches,revokeWhileCredentialsWait?0:1);
  assert.equal(app.runtime.getTask(result.taskId).state,revokeWhileCredentialsWait?'failed':'succeeded');
  assert.equal(config.snapshot().sessionAllowed,false,'the exact receipt cannot toggle settings consent');
  assert.throws(()=>host.assertCurrentRead(),/原执行上下文/);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync} from 'node:fs';
import path from 'node:path';
import {AuthorizationQuestions,createRuntimeApplication} from '@personal-agent/runtime/application';
import {createDesktopAuthorizationQuestionHost} from '../electron/authorization-question-host.js';
import {createDesktopMailReviewHost} from '../electron/mail-review-host.js';
const root=new URL('../../../.cache/mail-review-integration/',import.meta.url);mkdirSync(root,{recursive:true});
const ref={workKey:'public',sourceRevision:'r1',projectionDigest:'a'.repeat(64),receiptId:'public-receipt'};
const result={version:1,label:'work',impact:'routine',notificationRecommendation:'none',reasonCode:'work'};
async function settle(check){for(let i=0;i<200;i++){if(check())return;await new Promise(r=>setTimeout(r,5));}assert.fail('Real mail review composition did not settle');}
for(const invalid of [false,true])test(`real Runtime and full-access question compose mail review (${invalid?'extra field rejected':'exact result'})`,async t=>{
  let app,host,sends=0,applied=0,accepted=0,authorizationFailure,taskId;
  const item={...ref,receipt:{id:ref.receiptId},state:'pending',observedAt:new Date(Date.now()-10000).toISOString(),
    projection:{headersOnly:true,sensitivity:'private',text:'PUBLIC test work meeting'}};
  const question=createDesktopAuthorizationQuestionHost({createQuestions:options=>new AuthorizationQuestions(options),getApplication:()=>app,
    namespace:'integration',resolveConversation:()=> 'host-review',available:()=>true,
    profiles:[{ref:'full',label:'Full access',mode:'full-access',revision:1,available:true}],defaultProfileRef:'full'});
  host=createDesktopMailReviewHost({getApplication:()=>app,question,namespace:'integration',readConfigurationRef:()=> 'deployment1',confirmConsent:async()=>true,
    mail:{pendingReviewAnalyses:()=>[...Array.from({length:6006},(_,i)=>({...item,workKey:'historical-'+i})),item],readReviewAnalysis:key=>key===ref.workKey?structuredClone(item):undefined,
      confirmCachedAnalysisAccepted(input){taskId=input.taskId;accepted++;item.state='accepted';},applyCachedAnalysisReview(input){assert.equal(app.runtime.getTask(input.taskId).state,'succeeded');assert.deepEqual(input.review,result);applied++;}}});
  app=createRuntimeApplication({path:path.join(mkdtempSync(new URL('run-',root)),'runtime.sqlite'),profile:'huawei_ict_agentarts',hostUserNamespace:'integration',
    coordination:{execute:async request=>{sends++;assert.equal(request.textOnly,true);assert.equal(request.availableTools,undefined);assert.equal(request.continuation,undefined);
      app.assertCompetitionExportAllowed({...request});return {kind:'text',text:JSON.stringify(invalid?{...result,PRIVATE_EXTRA:'rejected'}:result),verification:'unverified'};}},
    mailReview:{readEnvelope:(...args)=>host.readEnvelope(...args),assertExport:(...args)=>host.assertExport(...args)},
    requiresToolAuthorization:scope=>scope.toolName==='mail.review'||question.requiresAuthorization(scope),requestToolAuthorization:scope=>{try{host.prepareAuthorization(scope);return question.requestToolAuthorization(scope);}catch(error){authorizationFailure=error.message;throw error;}}});
  t.after(async()=>{await host.close();await settle(()=>app.activeTaskCount===0);question.close();app.close();});
  await host.configure({enabled:true,selectedBindings:[ref]});await host.tick();
  await settle(()=>app.activeTaskCount===0);await host.tick();
  assert.equal(accepted,1);assert.equal(sends,1,'only explicit public fixture is exported, not historical 6006: '+authorizationFailure+JSON.stringify(app.readHostToolTask(taskId)));
  assert.equal(applied,invalid?0:1);assert.equal(host.snapshot().reviewed,invalid?0:1);
});

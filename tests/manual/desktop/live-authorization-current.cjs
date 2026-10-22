/* Explicit real-device acceptance against the current production Desktop.
 * Uses its existing safe preload, never a fabricated grant or microphone.
 * Outputs metadata only; the user's conversation and audio are not exported.
 */
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const {chromium}=require('playwright');
const {DatabaseSync}=require('node:sqlite');
const root=path.resolve(__dirname,'../../..');
const action=process.argv[2],directory=process.env.PA_LIVE_ACCEPTANCE_OUTPUT,userData=process.env.PA_LIVE_ACCEPTANCE_USER_DATA;
assert.equal(process.env.PA_MANUAL_LIVE_AUTHORIZATION_CURRENT,'1');
assert.ok(directory&&path.isAbsolute(directory)&&userData&&path.isAbsolute(userData));
fs.mkdirSync(directory,{recursive:true});
const file=path.join(directory,'live-authorization-receipt.json');
const report=fs.existsSync(file)?JSON.parse(fs.readFileSync(file,'utf8')):{startedAt:new Date().toISOString(),profile:'huawei_ict_agentarts',fake:false,physicalClick:false,observations:[],approvals:[]};
const save=()=>fs.writeFileSync(file,JSON.stringify(report,null,2)+'\n');
const pause=ms=>new Promise(r=>setTimeout(r,ms));
async function snap(page){const r=await page.evaluate(()=>window.desktop.invoke('snapshot'));assert.equal(r.ok,true);return r.value;}
function project(s){return {at:new Date().toISOString(),live:{configured:s.live?.configured,active:s.live?.active,status:s.live?.status,diagnostic:s.live?.diagnostic,reason:s.live?.reason},calendar:{configured:s.calendar?.configured,status:s.calendar?.status},capture:s.voice?.capture,questions:(s.authorizationQuestions??[]).filter(q=>q.toolName==='desktop.authorization.intent').map(q=>({questionId:q.questionId,taskId:q.taskId,state:q.state,revision:q.revision,toolName:q.toolName,conversationId:q.conversationId,expiresAt:q.expiresAt}))};}
function voiceInvocation(q){const db=new DatabaseSync(path.join(userData,'runtime.sqlite'),{readOnly:true});try{db.exec('PRAGMA query_only=ON');const row=db.prepare('SELECT value_json FROM task_checkpoints WHERE task_id=? AND checkpoint_key=?').get(q.taskId,'application-tool-invocation:'+q.sourceApprovalId);assert.ok(row);const v=JSON.parse(row.value_json);assert.equal(v.toolName,'desktop.authorization.intent');assert.equal(v.arguments.action,'voice.capture');assert.equal(v.arguments.payload.purpose,'live');assert.ok(Date.parse(v.deadline)>=Date.parse(q.expiresAt));return true;}finally{db.close();}}
async function main(){
 const port=fs.readFileSync(path.join(userData,'DevToolsActivePort'),'utf8').split(/\r?\n/)[0];assert.match(port,/^\d+$/);
 const browser=await chromium.connectOverCDP('http://127.0.0.1:'+port),context=browser.contexts()[0];
 let panel=context.pages().find(p=>p.url().includes('mode=panel'));
 if(!panel){const orb=context.pages().find(p=>p.url().includes('mode=orb'));assert.ok(orb);assert.equal((await orb.evaluate(()=>window.desktop.invoke('orb.open'))).ok,true);for(let n=0;n<100&&!panel;n++){await pause(100);panel=context.pages().find(p=>p.url().includes('mode=panel'));}}
 assert.ok(panel);if(action!=='inspect')await panel.bringToFront();await panel.waitForSelector('#send');
 let s=await snap(panel);assert.equal(s.fake,false);assert.equal(s.fakeModel,false);
 if(action==='start'){
   assert.equal(s.live?.active,false,'do not toggle a user-owned active call');
   report.startedQuestionIds=(s.authorizationQuestions??[]).map(q=>q.questionId);report.liveStartedAt=new Date().toISOString();save();
   assert.equal(await panel.locator('textarea[aria-label="任务内容"]').inputValue(),'','do not replace a user draft');
   assert.equal(await panel.locator('#send').getAttribute('data-mode'),'live','do not cancel or submit a different user operation');
   await panel.locator('#send').click();
 }else if(action==='approve'){
   assert.ok(report.liveStartedAt);const q=(s.authorizationQuestions??[]).find(q=>q.state==='pending'&&!report.startedQuestionIds.includes(q.questionId)&&q.toolName==='desktop.authorization.intent');assert.ok(q,'the fresh original Live card must exist');voiceInvocation(q);
   const decision=q.canReuseTask===true&&q.suggestedDecision==='allow_task'?'allow_task':'allow_once';
   const button=panel.locator(`[data-question-id="${q.questionId}"] [data-authorization-decision="${decision}"]`);await button.waitFor({state:'visible'});assert.equal(await button.isEnabled(),true);await button.scrollIntoViewIfNeeded();
   await panel.screenshot({path:path.join(directory,'live-original-card.png')});
   const current=(await snap(panel)).authorizationQuestions.find(item=>item.questionId===q.questionId);assert.equal(current.state,'pending');assert.equal(current.revision,q.revision);voiceInvocation(current);
   await button.click();report.approvals.push({questionId:q.questionId,taskId:q.taskId,revision:q.revision,decision,visible:true,at:new Date().toISOString()});
 }else if(action==='shutdown-for-restart'){
   if(s.live?.active){await panel.evaluate(()=>{void window.desktop.invoke('live.toggle');});for(let n=0;n<100;n++){s=await snap(panel);if(!s.live?.active&&!s.voice?.capture?.busy)break;await pause(100);}assert.equal(s.live?.active,false,'normal stop must complete before restart');}
   report.observations.push(project(s));report.normalQuitRequestedAt=new Date().toISOString();save();
   await panel.evaluate(()=>{void window.desktop.invoke('app.quit');});
   console.log(JSON.stringify({normalQuitRequested:true,file}));process.exit(0);
 }else if(action==='stop'){
   assert.ok(report.liveStartedAt,'only stop the acceptance call started here');
   if(s.live?.active)await panel.locator('#send').click();
 }else assert.equal(action,'inspect');
 for(let n=0;n<(action==='approve'?120:action==='start'?120:action==='stop'?60:1);n++){
   s=await snap(panel);const view=project(s);if(JSON.stringify(report.observations.at(-1)?.live)!==JSON.stringify(view.live)||(n===0))report.observations.push(view);save();
   if(action==='start'&&((s.authorizationQuestions??[]).some(q=>q.state==='pending'&&!report.startedQuestionIds.includes(q.questionId))||s.live?.status==='error'||s.live?.status==='listening'))break;
   if(action==='approve'&&['error','listening','speaking'].includes(s.live?.status))break;
   if(action==='stop'&&!s.live?.active)break;
   await pause(250);
 }
 if(action==='start'&&s.live?.status==='listening'&&s.voice?.capture?.active===true){
   report.directLiveStart={passed:true,applicationCards:(s.authorizationQuestions??[]).filter(q=>!report.startedQuestionIds.includes(q.questionId)).length,
     physicalMicrophoneReady:true,cloudConnected:s.live?.diagnostic?.stage==='microphone'&&s.live?.diagnostic?.status==='ready',at:new Date().toISOString()};
 }
 save();console.log(JSON.stringify({file,...project(s)}));
 // Disconnect by ending this short-lived driver; keep the formal Desktop open.
 process.exit(0);
}
main().catch(e=>{report.driverError={at:new Date().toISOString(),action,message:e.message};save();console.error(e.message);process.exit(1);});

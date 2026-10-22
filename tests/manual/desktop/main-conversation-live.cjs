/* Real production Desktop conversation probe. Only public fixture text is sent. */
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {DatabaseSync}=require('node:sqlite');
const {_electron}=require('playwright');
const root=path.resolve(__dirname,'../../..');
const terminal=state=>['succeeded','failed','cancelled','waiting_reconciliation'].includes(state);
async function until(read,deadline,label){while(Date.now()<deadline){const value=await read();if(value)return value;await new Promise(r=>setTimeout(r,150));}throw Error(label+' deadline');}
async function snapshot(page){const result=await page.evaluate(()=>window.desktop.invoke('snapshot'));assert.equal(result.ok,true);return result.value;}
function readback(file,taskId){const db=new DatabaseSync(file,{readOnly:true});try{
  const checkpoints=db.prepare('SELECT checkpoint_key,value_json FROM task_checkpoints WHERE task_id=?').all(taskId);
  const allowed=new Set(['competition-cloud-inflight','competition-cloud-accepted','competition-cloud-received','competition-cloud-terminal-error','competition-cloud-unknown','competition-export-withheld','competition-loop','application-deadline']);
  const task=db.prepare('SELECT state,result_summary,error_json FROM tasks WHERE task_id=?').get(taskId);
  return {task,checkpointKeys:checkpoints.map(row=>row.checkpoint_key),checkpoints:Object.fromEntries(checkpoints.filter(row=>allowed.has(row.checkpoint_key)).map(row=>[row.checkpoint_key,JSON.parse(row.value_json)]))};
}finally{db.close();}}
async function main(){
  assert.equal(process.env.PA_MANUAL_MAIN_CONVERSATION_LIVE,'1','explicit real cloud public-text opt-in required');
  const saved=process.env.PA_MAIN_SAVED_CONFIG_DIR;assert.ok(saved&&path.isAbsolute(saved));
  const output=fs.mkdtempSync(path.join(root,'.cache/main-conversation-live-')),userData=path.join(output,'user-data');fs.mkdirSync(userData);
  for(const name of ['agentarts-config.json','Local State'])fs.copyFileSync(path.join(saved,name),path.join(userData,name));
  const report={startedAt:new Date().toISOString(),profile:'huawei_ict_agentarts',status:'running',publicTextOnly:true,historyCopied:false,cases:[],physicalApproval:'not_run'};
  const persist=()=>fs.writeFileSync(path.join(output,'receipt.json'),JSON.stringify(report,null,2)+'\n');persist();console.log(JSON.stringify({output,status:'started'}));
  let app;
  try{
    const env=Object.fromEntries(Object.entries(process.env).filter(([key])=>!/^PA_/i.test(key)));
    Object.assign(env,{ELECTRON_RUN_AS_NODE:undefined,PA_RUNTIME_PROFILE:'huawei_ict_agentarts',PA_DESKTOP_TEST_USER_DATA:userData});
    app=await _electron.launch({executablePath:process.env.PA_MAIN_ELECTRON??path.join(root,'node_modules/electron/dist/electron.exe'),args:[path.join(root,'apps/desktop'),'--pa-public-main-probe='+path.basename(output)],env});
    await app.firstWindow();const orb=await until(()=>app.windows().find(page=>page.url().includes('mode=orb')),Date.now()+30000,'orb');
    await orb.evaluate(()=>window.desktop.invoke('orb.open'));
    const panel=await until(()=>app.windows().find(page=>page.url().includes('mode=panel')),Date.now()+30000,'panel');await panel.waitForSelector('#send');
    const initial=await snapshot(panel);assert.equal(initial.fakeModel,false);assert.equal(initial.fake,false);
    report.configuration={configured:initial.agentarts?.configured,runtimeError:initial.runtimeError??'',fake:false};persist();
    for(const [index,goal]of ['公开连通性验收：请只回复“链路正常”，不要调用工具。','继续这次公开连通性验收：请只回复“第二轮正常”，不要调用工具。'].entries()){
      const row={index,goal,submittedAt:new Date().toISOString()};report.cases.push(row);persist();
      await panel.locator('textarea[aria-label="任务内容"]').fill(goal);await panel.locator('#send').click();
      const task=await until(async()=>{const value=await snapshot(panel);return value.tasks.find(task=>task.userMessage===goal||task.goal===goal);},Date.now()+30000,'task acceptance');row.taskId=task.taskId;
      const file=path.join(userData,'runtime.sqlite');
      const deadline=readback(file,task.taskId).checkpoints['application-deadline'];assert.ok(Number.isFinite(Date.parse(deadline)));
      row.deadline=deadline;persist();
      const final=await until(async()=>{const value=await snapshot(panel),current=value.tasks.find(item=>item.taskId===task.taskId);if(row.lastState!==current?.state){row.lastState=current?.state;persist();}return terminal(current?.state)?current:undefined;},Date.parse(deadline)+10000,'original task');
      row.state=final.state;row.errorCode=final.error?.code;row.persistence=readback(file,task.taskId);persist();
      assert.equal(final.state,'succeeded','original public main conversation must complete');
      assert.match(row.persistence.task.result_summary,index===0?/^链路正常(?:\s|$)/u:/^第二轮正常(?:\s|$)/u,'persisted answer must address the original public request');
      row.passed=true;
    }
    report.status='passed';
  }catch(error){report.status='failed';report.error={name:error.name,code:error.code??null,message:error.message};process.exitCode=1;}
  finally{report.finishedAt=new Date().toISOString();persist();if(app){try{await app.evaluate(({app})=>app.exit(0));}catch{}try{await app.close();}catch{}}console.log(JSON.stringify({output,status:report.status,cases:report.cases.map(({taskId,state,passed})=>({taskId,state,passed}))}));}
}
main().catch(error=>{console.error(error.message);process.exitCode=1;});

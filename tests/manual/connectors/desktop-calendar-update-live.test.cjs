const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),{DatabaseSync}=require('node:sqlite');
const {testCollection,publicIcs,strongEtag,verifyCalendarGet,verifyCards,readback,calendarUpdateArgs,failureDiagnostic}=require('./desktop-calendar-update-live.cjs');
const {weatherLaunchOptions}=require('./desktop-weather-watch-live.cjs');
const before={uid:'pa-public-synthetic-uid',summary:'Public original',startUtc:'2026-10-23T10:00:00.000Z',endUtc:'2026-10-23T11:00:00.000Z'};
test('calendar tool args use externalId while independent GET retains the original UID',()=>{
  assert.deepEqual(calendarUpdateArgs(before),{externalId:before.uid,summary:before.summary,startUtc:before.startUtc,endUtc:before.endUtc});
  assert.equal(Object.hasOwn(calendarUpdateArgs(before),'uid'),false);assert.equal(before.uid,'pa-public-synthetic-uid');
});
test('weather/calendar explicit Electron launch reuses the pinned official readiness loader and bounded helpers',()=>{
  const userData=path.resolve(__dirname,'../../../.cache/synthetic-calendar-loader/user-data');
  const options=weatherLaunchOptions('D:\\synthetic-electron.exe',userData,{PA_DESKTOP_SYNTHETIC_MVP:'1',ELECTRON_RUN_AS_NODE:'1'});
  assert.equal(options.args[0],'-r');assert.equal(options.args[1],fs.realpathSync.native(path.join(path.dirname(require.resolve('playwright-core/package.json')),'lib/server/electron/loader.js')));
  assert.equal(options.args[2],path.resolve(__dirname,'../../../apps/desktop'));
  assert.match(options.args[3],/^--pa-public-weather-watch-acceptance=/);
  assert.equal(options.env.PA_DESKTOP_TEST_USER_DATA,userData);assert.equal(options.env.PA_DESKTOP_SYNTHETIC_MVP,undefined);
  assert.equal(options.env.ELECTRON_RUN_AS_NODE,undefined);assert.equal(options.env.PA_RUNTIME_PROFILE,'huawei_ict_agentarts');
});
test('live calendar runner accepts only fresh explicit public principal loopback collections',()=>{
  assert.equal(testCollection('http://127.0.0.1:5232/pa-public-calendar-test/calendar-1234/'),
    'http://127.0.0.1:5232/pa-public-calendar-test/calendar-1234/');
  for(const url of ['https://calendar.example/private/','http://192.168.1.2:5232/pa-public-calendar-test/calendar-1234/',
    'http://127.0.0.1:5232/private/calendar-1234/','http://u:p@127.0.0.1:5232/pa-public-calendar-test/calendar-1234/',
    'http://127.0.0.1:5232/pa-public-calendar-test/calendar-1234/?token=secret'])assert.throws(()=>testCollection(url));
});
test('independent public ICS GET verifies exact fields, strong ETag change and single sequence advancement',async()=>{
  const initial=await verifyCalendarGet({status:200,etag:'"original"',text:publicIcs(before)},before);
  assert.equal(initial.sequence,0);strongEtag(initial.etag);
  const expected={...before,summary:'Public updated',startUtc:'2026-10-23T12:00:00.000Z',endUtc:'2026-10-23T13:00:00.000Z'};
  const changed={status:200,etag:'"updated"',text:publicIcs(expected).replace('SEQUENCE:0','SEQUENCE:1')};
  assert.equal((await verifyCalendarGet(changed,expected,initial)).sequence,1);
  for(const bad of [{...changed,status:404},{...changed,etag:'W/"weak"'},{...changed,etag:initial.etag},
    {...changed,text:publicIcs(before)},{...changed,text:changed.text.replace('SEQUENCE:1','SEQUENCE:2')},
    {...changed,text:changed.text.replace(expected.uid,'another-uid')}])await assert.rejects(verifyCalendarGet(bad,expected,initial));
});
test('restricted cards require one merged update with optional dispatch, removed DOM and allowed history',()=>{
  const questions=[{questionId:'synthetic-dispatch',toolName:'subagent.dispatch',requirements:[]},
    {questionId:'synthetic-update',toolName:'calendar.update',requirements:['tool','connector_session','export'].map(kind=>({kind}))}];
  const history=questions.map(item=>({...item,state:'allowed'})),observed={ids:questions.map(item=>item.questionId),remaining:0};
  verifyCards('restricted',questions,history,observed);
  verifyCards('restricted',[questions[1]],[history[1]],{ids:[questions[1].questionId],remaining:0});
  assert.throws(()=>verifyCards('restricted',questions,history,{...observed,remaining:1}));
  assert.throws(()=>verifyCards('restricted',questions,[{...history[0],state:'pending'},history[1]],observed));
  assert.throws(()=>verifyCards('restricted',questions,[],observed));
  assert.throws(()=>verifyCards('restricted',[questions[0],{...questions[1],requirements:[{kind:'tool'}]}],history,observed));
  for(const invalid of [[],[questions[0]],[questions[1],{...questions[1],questionId:'duplicate-update'}],
    [questions[1],{...questions[0],toolName:'calendar.create'}],
    [questions[1],questions[0],{...questions[0],questionId:'duplicate-dispatch'}],
    [questions[1],{...questions[0],questionId:questions[1].questionId}]])
    assert.throws(()=>verifyCards('restricted',invalid,invalid.map(item=>({...item,state:'allowed'})),
      {ids:invalid.map(item=>item.questionId),remaining:0}));
  assert.throws(()=>verifyCards('restricted',[questions[1]],[history[1]],{ids:['wrong-original-id'],remaining:0}));
});
test('calendar failure diagnostics expose only fixed safe assertion reasons and messages',()=>{
  let error;
  try{verifyCards('restricted',[],[],{ids:[],remaining:0});}catch(value){error=value;}
  assert.deepEqual(failureDiagnostic(error,'verify_authorization_cards'),{stage:'verify_authorization_cards',code:'ERR_ASSERTION',
    reason:'restricted_card_count',message:'restricted mode requires one or two original cards'});
  for(const value of [{code:'ERR_ASSERTION',message:'PRIVATE_CONFIG credentials=PRIVATE_TOKEN'},
    {code:'PRIVATE_TOKEN',message:'PRIVATE_CONFIG'},
    {code:'ERR_ASSERTION',message:'restricted mode requires one or two original cards\nPRIVATE_TOKEN'}]){
    const diagnostic=failureDiagnostic(value,'verify_authorization_cards');
    assert.doesNotMatch(JSON.stringify(diagnostic),/PRIVATE_|credentials/u);
  }
});
test('Full access passes only when no manual question and no rendered card were observed',()=>{
  verifyCards('full-access',[],[],{ids:[],remaining:0});
  assert.throws(()=>verifyCards('full-access',[{questionId:'unexpected'}],[],{ids:[],remaining:0}));
  assert.throws(()=>verifyCards('full-access',[],[],{ids:['briefly-rendered'],remaining:0}));
});
test('persisted source readback requires succeeded parent/child and one confirmed actual update plus cloud continuation',t=>{
  const directory=path.resolve(__dirname,'../../../.cache');fs.mkdirSync(directory,{recursive:true});
  const file=path.join(fs.mkdtempSync(path.join(directory,'calendar-runner-synthetic-')),'runtime.sqlite'),db=new DatabaseSync(file);t.after(()=>db.close());
  db.exec('CREATE TABLE tasks(task_id TEXT,state TEXT,evidence_refs_json TEXT);CREATE TABLE tool_execution_records(record_json TEXT);'
    +'CREATE TABLE task_checkpoints(task_id TEXT,checkpoint_key TEXT,value_json TEXT,PRIMARY KEY(task_id,checkpoint_key))');
  const save=(task,key,value)=>db.prepare('INSERT OR REPLACE INTO task_checkpoints VALUES(?,?,?)').run(task,key,JSON.stringify(value));
  db.prepare('INSERT INTO tasks VALUES(?,?,?)').run('synthetic-parent','succeeded','["synthetic-run"]');
  db.prepare('INSERT INTO tasks VALUES(?,?,?)').run('synthetic-child','succeeded','[]');
  save('synthetic-child','subtask-parent',{parentTaskId:'synthetic-parent'});
  const record={taskId:'synthetic-child',evidenceId:'synthetic-run',toolName:'calendar.update',state:'confirmed',policyDecision:'allow',executionStarted:true};
  db.prepare('INSERT INTO tool_execution_records VALUES(?)').run(JSON.stringify(record));
  save(record.taskId,'tool-result-'+record.evidenceId,{result:{state:'updated',item:{source:'calendar',accountRef:'desktop-calendar',
    externalId:before.uid,validFor:before.startUtc+'/'+before.endUtc}}});
  save(record.taskId,'competition-cloud-request-identity',{requests:[{requestId:'synthetic-initial'},{requestId:'synthetic-continuation'}]});
  assert.equal(readback(file,'synthetic-parent',before).update.state,'confirmed');
  for(const id of ['synthetic-parent','synthetic-child']){
    db.prepare('UPDATE tasks SET state=? WHERE task_id=?').run('waiting_reconciliation',id);
    assert.throws(()=>readback(file,'synthetic-parent',before));db.prepare('UPDATE tasks SET state=? WHERE task_id=?').run('succeeded',id);
  }
  db.prepare('UPDATE tool_execution_records SET record_json=?').run(JSON.stringify({...record,state:'unknown'}));
  assert.throws(()=>readback(file,'synthetic-parent',before));
  db.prepare('UPDATE tool_execution_records SET record_json=?').run(JSON.stringify(record));
  save(record.taskId,'competition-cloud-request-identity',{requests:[{requestId:'synthetic-initial'}]});
  assert.throws(()=>readback(file,'synthetic-parent',before),/continuation/);
});

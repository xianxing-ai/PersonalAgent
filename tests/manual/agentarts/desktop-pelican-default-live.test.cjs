const test=require('node:test');
const assert=require('node:assert/strict');
const {mkdtempSync,rmSync}=require('node:fs');
const {tmpdir}=require('node:os');
const path=require('node:path');
const {DatabaseSync}=require('node:sqlite');
const {originalQuestionBinding}=require('./desktop-pelican-default-live.cjs');

test('public Pelican question automation verifies the original descendant and exact pending invocation read-only',async t=>{
  const {toolArgumentsDigest}=await import('@personal-agent/tool-gateway');
  const directory=mkdtempSync(path.join(tmpdir(),'pa-pelican-question-')),file=path.join(directory,'runtime.sqlite');
  t.after(()=>rmSync(directory,{recursive:true,force:true}));
  const db=new DatabaseSync(file);
  db.exec('CREATE TABLE task_checkpoints(task_id TEXT, checkpoint_key TEXT, value_json TEXT, PRIMARY KEY(task_id,checkpoint_key))');
  const save=(task,key,value)=>db.prepare('INSERT OR REPLACE INTO task_checkpoints VALUES(?,?,?)').run(task,key,JSON.stringify(value));
  const args={sessionId:'Synthetic-original-session',path:'pelican.svg'},deadline=new Date(Date.now()+60_000).toISOString();
  const question={questionId:'Synthetic-question',taskId:'Synthetic-host',sourceApprovalId:'host-tool-Synthetic-host',
    toolName:'coding.repair.read',expiresAt:deadline};
  save('Synthetic-host','coding-repair:parent',{taskId:'Synthetic-worker',operationId:'Synthetic-original-operation'});
  save('Synthetic-worker','subtask-parent',{parentTaskId:'Synthetic-original-main'});
  const invocation={toolName:question.toolName,arguments:args,argumentsDigest:toolArgumentsDigest(args),deadline};
  save(question.taskId,'application-tool-invocation:'+question.sourceApprovalId,invocation);
  const before=db.prepare('SELECT * FROM task_checkpoints ORDER BY task_id,checkpoint_key').all();
  assert.deepEqual(await originalQuestionBinding(file,'Synthetic-original-main',question),{argumentsDigest:invocation.argumentsDigest,deadline});
  assert.deepEqual(db.prepare('SELECT * FROM task_checkpoints ORDER BY task_id,checkpoint_key').all(),before,'the verifier must not update original checkpoints');
  await assert.rejects(originalQuestionBinding(file,'Synthetic-sibling-main',question),/descendants/);
  await assert.rejects(originalQuestionBinding(file,'Synthetic-original-main',{...question,toolName:'mail.inbox'}),/original pending/);
  save(question.taskId,'application-tool-invocation:'+question.sourceApprovalId,{...invocation,arguments:{...args,path:'other.svg'}});
  await assert.rejects(originalQuestionBinding(file,'Synthetic-original-main',question),/exact arguments/);
  save(question.taskId,'application-tool-invocation:'+question.sourceApprovalId,{...invocation,arguments:{...args,path:'other.svg'},
    argumentsDigest:toolArgumentsDigest({...args,path:'other.svg'})});
  await assert.rejects(originalQuestionBinding(file,'Synthetic-original-main',question),/public SVG/);
  db.close();
});

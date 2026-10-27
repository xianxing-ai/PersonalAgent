import {mkdirSync,existsSync} from 'node:fs';
import path from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {TaskRuntime} from '../../runtime/dist/index.js';

/** Explicit synthetic-only database. Never opens or modifies an existing file. The first
 * task uses the real Runtime; subsequent copies are fixture records, not execution evidence. */
export async function seedPerformanceDatabase(file,count) {
  if(existsSync(file))throw Error('Performance fixture refuses an existing database');
  mkdirSync(path.dirname(file),{recursive:true});
  const runtime=new TaskRuntime(file,{now:()=>new Date('2026-01-01T00:00:00.000Z')});
  const task=runtime.submitTask({goal:'Synthetic public performance input',conversationId:'desktop-panel',idempotencyKey:'performance-template'});
  const completed=await runtime.runTask(task.taskId,async()=>({resultSummary:'Synthetic performance response. '.repeat(40)}),
    {deadline:'2026-01-01T00:01:00.000Z'});
  if(completed.state!=='succeeded')throw Error('Synthetic template did not complete');
  runtime.close();
  const db=new DatabaseSync(file);
  try {
    const original=db.prepare('SELECT * FROM tasks WHERE task_id=?').get(task.taskId);
    const events=db.prepare('SELECT * FROM task_events WHERE task_id=? ORDER BY sequence').all(task.taskId);
    const taskColumns=Object.keys(original);
    const insertTask=db.prepare(`INSERT INTO tasks (${taskColumns.join(',')}) VALUES (${taskColumns.map(()=>'?').join(',')})`);
    const insertEvent=db.prepare('INSERT INTO task_events (event_id,stream_id,task_id,type,occurred_at,payload_json) VALUES (?,?,?,?,?,?)');
    db.exec('BEGIN IMMEDIATE');
    for(let index=1;index<count;index++) {
      const id=`synthetic-task-${String(index).padStart(6,'0')}`,createdAt=new Date(Date.UTC(2026,0,1)+index*1000).toISOString();
      const values={...original,task_id:id,conversation_id:index%4===0?'desktop-workspace':'desktop-panel',updated_at:createdAt};
      insertTask.run(...taskColumns.map(key=>values[key]));
      for(let eventIndex=0;eventIndex<events.length;eventIndex++) {
        const event=events[eventIndex];
        const payload=event.payload_json.replaceAll(task.taskId,id).replaceAll(original.updated_at,createdAt)
          .replaceAll('desktop-panel',values.conversation_id);
        insertEvent.run(`${id}-event-${eventIndex}`,event.stream_id,id,event.type,createdAt,payload);
      }
    }
    db.exec('COMMIT');
    return {tasks:count,events:db.prepare('SELECT count(*) AS count FROM task_events').get().count,
      bodyBytes:original.result_summary.length,synthetic:true};
  } finally {db.close();}
}

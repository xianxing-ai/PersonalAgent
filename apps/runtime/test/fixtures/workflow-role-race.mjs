import {TaskRuntime} from '../../dist/index.js';

// The parent sends one synthetic request after both independent SQLite connections open.
const runtime=new TaskRuntime(process.argv[2]);
process.send?.({state:'ready'});
process.on('message',message=>{
  try {
    if(message.kind==='bind')runtime.beginWorkflowRolePlanAttempt(message.plan,message.parentRevision,message.intent);
    else runtime.submitTaskWithSubagentBinding(message.input,message.binding);
    process.send?.({state:'completed'});
  } catch(error) {process.send?.({state:'rejected',code:error?.code??'UNKNOWN'});}
  finally {runtime.close();process.disconnect?.();}
});

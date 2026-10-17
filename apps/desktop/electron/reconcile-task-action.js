/** Trusted Desktop action: original-task verification only; Runtime owns terminal state. */
export async function reconcileTaskFromSurface({taskId,sender,panel,workspace,tasks,taskSurface,application,refresh,publish}){
 if(sender!==panel&&sender!==workspace)throw Error('请从当前对话核实任务');
 if(typeof taskId!=='string'||!tasks.has(taskId))throw Error('未知任务');
 const task=tasks.get(taskId);if(taskSurface(task)!==(sender===workspace?'workspace':'panel'))throw Error('无法核实其他工作区的任务');
 if(task.state!=='waiting_reconciliation')throw Error('当前任务不在待核实状态');
 if(typeof application?.reconcileConfirmedSubagentTermination!=='function')throw Error('原任务核实入口尚不可用');
 await application.reconcileConfirmedSubagentTermination(taskId);
 const result=await refresh(taskId);publish();return result;
}

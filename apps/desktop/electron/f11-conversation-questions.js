/** Read only original, host-validated questions in the visible user conversation. */
export function readF11ConversationQuestions({application,hosts,tasks,conversationId}) {
  if(!application||!conversationId)return [];
  const readers=hosts.filter(host=>typeof host?.readQuestion==='function');
  if(!readers.length)return [];
  const found=new Map(),ids=new Set();
  for(const task of tasks){
    if(task.bodyWithheld||['succeeded','failed','cancelled'].includes(task.state))continue;
    ids.add(task.taskId);
    for(const child of application.readSubagentTasks(task.taskId))ids.add(child.taskId);
  }
  for(const taskId of ids)for(const host of readers){
    const question=host.readQuestion({taskId,conversationId});
    if(question?.conversationId===conversationId)found.set(question.questionId,question);
  }
  return [...found.values()];
}

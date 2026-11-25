import path from 'node:path';
import {mkdirSync} from 'node:fs';
import {CrewKernel, CREW_PARENT_AGENT_ID} from '@personal-agent/crew';

const REPAIR_AGENT_ID = 'coder-repair';

/**
 * Desktop host: mirror a failed TaskRuntime repair onto CrewKernel, then
 * replanChildTask. Does not return followUpTaskId so failure-repair-host still
 * enqueues the visible TaskRuntime follow-up.
 */
export function createCrewReplanDispatcher({dbPath, workspaceRoot, now} = {}) {
  if (typeof dbPath !== 'string' || !dbPath.trim()) throw Error('crew replan database path required');
  mkdirSync(path.dirname(dbPath), {recursive: true});
  if (workspaceRoot) mkdirSync(workspaceRoot, {recursive: true});
  const kernel = CrewKernel.open(dbPath, {
    ...(workspaceRoot ? {workspaceRoot} : {}),
    ...(now ? {now} : {}),
  });
  let closed = false;

  function ensureRepairAgent() {
    if (kernel.getAgent(REPAIR_AGENT_ID)) return;
    const agentWorkspace = workspaceRoot
      ? path.join(workspaceRoot, 'agents', REPAIR_AGENT_ID)
      : path.join(path.dirname(dbPath), 'coder-repair');
    mkdirSync(agentWorkspace, {recursive: true});
    kernel.registerAgent({
      agentId: REPAIR_AGENT_ID,
      displayName: '失败自愈编码者',
      driver: 'codex',
      instructions: '按父 agent 重新规划执行下一步；不要重放未知写入。',
      workspacePath: agentWorkspace,
    });
  }

  function ensureFailedChild(sourceTaskId, goal) {
    ensureRepairAgent();
    const existing = kernel.getTask({actorId: CREW_PARENT_AGENT_ID, taskId: sourceTaskId});
    if (existing?.status === 'failed') return existing;
    if (existing) {
      throw Error(`crew 任务 ${sourceTaskId} 处于 ${existing.status}，无法重新规划`);
    }
    kernel.dispatchTask({
      actorId: CREW_PARENT_AGENT_ID,
      taskId: sourceTaskId,
      assignedAgentId: REPAIR_AGENT_ID,
      goal: typeof goal === 'string' && goal.trim() ? goal.slice(0, 2000) : '失败任务等待父重新规划',
    });
    kernel.claimNextTask(REPAIR_AGENT_ID);
    return kernel.submitReceipt({
      actorId: REPAIR_AGENT_ID,
      taskId: sourceTaskId,
      receipt: {
        status: 'failed',
        result: '操作者交给父 agent 重新规划',
        evidenceRefs: [`repair:${sourceTaskId}`],
        unblock: '',
      },
    });
  }

  return {
    dispatch({sourceTaskId, decision, intent, conversationId: _conversationId}) {
      if (closed) throw Error('crew replan dispatcher closed');
      if (!sourceTaskId || typeof sourceTaskId !== 'string') throw Error('sourceTaskId required');
      if (!decision || decision.strategy !== 'request_parent_replan') {
        return {accepted: false, reason: 'not a parent replan decision'};
      }
      if (!intent || intent.action !== 'dispatch') {
        return {accepted: false, reason: intent?.reason ?? 'replan intent is not dispatch'};
      }
      ensureFailedChild(sourceTaskId, intent.goal);
      const replanTaskId = `replan-${sourceTaskId}-${Date.now().toString(36)}`;
      const result = kernel.replanChildTask({
        actorId: CREW_PARENT_AGENT_ID,
        childTaskId: sourceTaskId,
        taskId: replanTaskId,
        assignedAgentId: REPAIR_AGENT_ID,
        decision: {...decision, childTaskId: sourceTaskId},
      });
      return {
        accepted: result.intent.action === 'dispatch',
        crewTaskId: result.task?.taskId,
        crewChildTaskId: sourceTaskId,
        intent: result.intent,
      };
    },
    listTasks() {
      return kernel.listTasks({actorId: CREW_PARENT_AGENT_ID});
    },
    close() {
      if (closed) return;
      closed = true;
      kernel.close();
    },
  };
}

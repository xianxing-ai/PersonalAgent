import {readCanonicalUserWorkParent} from '@personal-agent/runtime/application';

/** Model-visible bindings for additive tools. Registration alone is not authorization. */
export const ADDITIVE_CONVERSATION_TOOL_NAMES = [
  'subagent.spawn', 'subagent.instruct', 'subagent.stop', 'subagent.pause', 'subagent.resume', 'subagent.redirect', 'subagent.handoff',
  'subagent.type.list', 'subagent.type.create', 'subagent.type.update', 'subagent.type.enable',
  'subagent.type.disable', 'subagent.type.delete', 'subagent.type.confirm', 'subagent.type.import',
  'runner.host.add', 'runner.host.update', 'runner.host.remove', 'runner.host.enable', 'runner.host.disable',
  'runner.host.confirm', 'runner.host.list', 'runner.host.test', 'runner.host.jobs',
  'duty.watch', 'duty.unwatch', 'duty.policy.set', 'duty.personal.list', 'duty.status', 'duty.ci.triage', 'duty.comment.publish',
];

export function additiveConversationBindings(tools, getRuntime) {
  const selected = (tools ?? []).filter(tool => ADDITIVE_CONVERSATION_TOOL_NAMES.includes(tool.descriptor?.name));
  const mainConversation = async ({taskId}) => {
    if (!getRuntime || !taskId) return true;
    try {const runtime=getRuntime();return !String(runtime.getTask(taskId).conversationId??'').startsWith('desktop-subtask:')
      ||readCanonicalUserWorkParent(runtime,taskId)!==undefined;}
    catch {return false;}
  };
  return {
    availability: selected.map(tool => ({
      toolName: tool.descriptor.name,
      toolVersion: tool.descriptor.version,
      publicDescription: `Additive main-conversation tool ${tool.descriptor.name}`,
      available: scope => mainConversation(scope),
    })),
    exports: selected.map(tool => ({
      toolName: tool.descriptor.name,
      toolVersion: tool.descriptor.version,
      exportPolicyVersion: 'additive-1.0.0',
      accepts: () => true,
      project: async ({result}) => {
        const summary = JSON.stringify(result ?? null);
        return {summary: summary.length > 4000 ? summary.slice(0, 4000) : summary, evidenceLevel: 'fixture'};
      },
    })),
  };
}

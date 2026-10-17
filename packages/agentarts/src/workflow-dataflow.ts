import {validateToolValue} from '@personal-agent/contracts';
import type {WorkflowNodeContext,WorkflowCandidate} from './owned-workflows.js';

/** Bind an explicit source path to its already-published schema; no semantic inference or tool execution. */
export function boundSourceReadCandidates(context:WorkflowNodeContext):readonly WorkflowCandidate[]|undefined {
  if(!['F15_N01','F20_N01'].includes(context.node.id)||!context.input||typeof context.input!=='object'||Array.isArray(context.input))return;
  const input=context.input as Record<string,unknown>,path=context.node.id==='F15_N01'?input.targetFile:input.schemaFile;
  if(typeof path!=='string'||!path)return;
  const tool=context.availableTools.find(item=>item.name==='workspace.read_text');if(!tool)return;
  const argumentsValue={path};validateToolValue(tool.inputSchema,argumentsValue);
  return [{id:'bound-source-read',description:'Read exactly the source path explicitly supplied by this task, using the published reader schema. This is an unexecuted request; no source content, permission or future result is claimed.',
    value:{toolName:tool.name,toolVersion:tool.version,arguments:argumentsValue}}];
}

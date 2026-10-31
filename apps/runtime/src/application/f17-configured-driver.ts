import {createHash} from 'node:crypto';
import type {F16SourceApplication} from './f16-source-receipts.js';
import {sourceObject,sourceFailure} from './f16-source-receipts.js';
import type {OwnedWorkflowHostScope} from './workflow-owned-host-scope.js';

const digest=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');

/** Resolve the configured worker's existing checkpoint; never create a second driver. */
export function createF17ConfiguredDriverResolver(application:F16SourceApplication,tool:{name:string;version:string}) {
  return (scope:OwnedWorkflowHostScope):string=>{
    const loop=application.runtime.loadCheckpoint(scope.parentTaskId,'competition-loop');
    if(!sourceObject(loop)||!sourceObject(loop.pending)||loop.pending.toolName!==tool.name||loop.pending.toolVersion!==tool.version
      ||typeof loop.pending.proposalId!=='string')sourceFailure('Original configured F17 proposal unavailable');
    const namespace='owned-workflow:configured:'+digest([tool.name,loop.pending.proposalId]);
    const binding=application.runtime.loadCheckpoint(scope.parentTaskId,namespace+':binding');
    const graph=application.runtime.loadCheckpoint(scope.parentTaskId,namespace+':graph');
    if(!sourceObject(binding)||binding.taskId!==scope.parentTaskId||binding.deadline!==scope.deadline
      ||binding.revision!==loop.pendingRevision||binding.proposalDigest!==digest(loop.pending)
      ||!sourceObject(graph)||graph.sessionId!==scope.sessionId)sourceFailure('Original configured F17 driver changed');
    return namespace+':graph';
  };
}

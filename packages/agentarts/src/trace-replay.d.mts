/** JSON-only historical evidence. Callers must authenticate the original source. */
export interface FrozenWorkflowTrace {
  asOf:string;sourceVersions:Record<string,string>;records:Record<string,unknown>[];
}
export interface FrozenWorkflowReplay {
  snapshotAsOf:string;sourceVersions:Record<string,string>;snapshotDigest:string;
  timeline:Record<string,unknown>[];actions:Record<string,unknown>[];
  actualToolCalls:0;actualModelCalls:0;authority:'data_only_no_tool_grant';
  currentResultValidity:'not_independently_verified';counterfactualComparison:'unknown';comparisonScope:'single_step';
  provenance:'host_signed_frozen_export_not_new_execution';trainingPerformed:false;
}
export function workflowTraceDigest(value:unknown):string;
export function replayFrozenWorkflowTrace(input:{snapshot:FrozenWorkflowTrace;requestedActions:Record<string,unknown>[];repairTrace?:unknown},
  control:{signal:AbortSignal;deadline:string}):FrozenWorkflowReplay;

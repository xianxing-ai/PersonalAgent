import {createHash} from 'node:crypto';
import {ProtocolError} from '@personal-agent/contracts';
import {OWNED_WORKFLOW_SOURCE} from './owned-workflow-data.js';

export const OWNED_WORKFLOW_VERSION = '1.0.0' as const;
export const OWNED_TEMPLATE_VERSION = '2026.10.15.2' as const;
export type WorkflowStepKind = 'input' | 'assemble' | 'decision' | 'executor' | 'tool' | 'host';
export interface WorkflowCapability {
  /** Tool names are existing published names; host ports are explicit missing composition contracts. */
  kind: 'tool' | 'host'; name: string; boundary: 'local' | 'platform';
}
export interface OwnedWorkflowNode {
  id: string; label: string; designKind: string; kind: WorkflowStepKind;
  dependencies: readonly {nodeId: string; required: boolean}[];
  required: boolean; condition?: string; hostGuard?: true; resourceKeys: readonly string[];
  effect: 'none' | 'read' | 'write'; capabilities: readonly WorkflowCapability[];
  inputFields: readonly string[]; outputFields: readonly string[]; evidenceRequirement?: string;
  /** Design intent only; the trusted ModelGateway catalog determines actual availability. */
  modelAssignment?: Readonly<{vendor:string;model:string;role:string}>;
  joinMode?: 'selected'|'all'|'any';
}
export interface OwnedWorkflowTemplate {
  workflowId: string; bindingId: string; name: string; version: typeof OWNED_TEMPLATE_VERSION;
  templateDigest: string; nodes: readonly OwnedWorkflowNode[];
  transitions: readonly {source: string; target: string; required: boolean; condition?: string; feedback: boolean}[];
  recovery: readonly string[];
  category:string;summary:string;decisionPoints:readonly string[];designNotes:readonly string[];acceptance:readonly string[];
}

type SourceNode = {id: string; label: string; kind: string; dependencies: string[]; required: boolean;
  resourceKeys: string[]; effectType: string; condition?: string; inputFields: string[]; outputFields: string[]; evidenceRequirement?: string;
  modelAssignment?:{vendor:string;model:string;role:string};joinMode?:'selected'|'all'|'any'};
type SourceFeature = {id: string; name: string; nodes: SourceNode[];
  category:string;summary:string;decisionPoints:string[];designNotes:string[];acceptance:string[];
  edges: {source: string; target: string; required: boolean; condition?: string}[]; recovery: string[]};
const host = (name: string, boundary: 'local' | 'platform' = 'local'): WorkflowCapability => ({kind:'host',name,boundary});
const tool = (name: string): WorkflowCapability => ({kind:'tool',name,boundary:'local'});
/** Every host name below needs an actual injected provider; declaring it does not publish capability. */
const capabilities: Record<string, WorkflowCapability[]> = {
  F01_N02:[host('memory.query'),host('responsibility.snapshot'),host('model.capabilities')],
  F01_N04:[host('policy.scope_check')],F01_N05:[host('model.native_config_check')],F01_N06:[host('runtime.commit_task_graph')],
  F01_N07:[tool('knowledge.search')],F01_N08:[host('voice.ask_question')],F01_N09:[host('runtime.commit_responsibility')],
  F02_N01:[host('policy.pending_question')],F02_N02:[host('voice.speak_question')],F02_N03:[host('voice.final_transcript')],
  F02_N05:[host('policy.confirmation_check')],F02_N06:[host('policy.resume_original_operation')],
  F02_N07:[host('runtime.invalidate_question')],F02_N08:[host('runtime.reject_operation')],F02_N09:[host('runtime.local_stop_observation')],
  F02_N10:[host('voice.local_fallback')],F02_N11:[host('runtime.read_original_effect')],
  F03_N05:[host('memory.query')],F03_N03:[host('runtime.invalidate_affected_subgraph')],F03_N06:[host('runtime.original_effect_binding')],
  F03_N07:[host('runtime.reconcile_original_effect')],F03_N08:[host('policy.compensation_check')],
  F03_N09:[host('runtime.submit_bound_compensation')],F03_N10:[host('voice.ask_question')],F03_N04:[host('runtime.schedule_graph')],
  F04_N05:[host('memory.query')],F04_N06:[host('knowledge.source_and_write_check')],F04_N03:[tool('knowledge.apply_note_patch')],
  F04_N07:[host('memory.quarantine_candidate')],F04_N04:[host('memory.invalidate_projection')],
  F05_N02:[tool('knowledge.search'),host('memory.query')],F05_N06:[tool('knowledge.search')],
  F05_N05:[host('knowledge.citation_revision_check')],F05_N07:[host('runtime.publish_sourced_answer')],
  F06_N03:[host('todo.registered_write')],F06_N04:[host('reminder.current_clock_and_revision')],F06_N05:[host('notification.deliver')],
  F07_N02:[tool('calendar.events')],F07_N04:[host('calendar.freshness_check')],F07_N05:[host('calendar.registered_write')],
  F08_N01:[tool('mail.inbox')],F08_N09:[tool('knowledge.search')],F08_N03:[host('mail.registered_archive')],
  F08_N10:[host('policy.operation_scope_check')],F08_N06:[host('voice.ask_question')],F08_N07:[host('mail.registered_send')],
  F08_N11:[tool('mail.reconcile_send')],F08_N12:[host('runtime.wait_reconciliation')],F08_N13:[host('runtime.versioned_replan')],
  F09_N01:[tool('feeds.collect')],F09_N02:[host('feeds.validate_and_deduplicate')],F09_N04:[host('runtime.enqueue_research')],
  F10_N02:[tool('research.search')],F10_N03:[tool('research.search')],F10_N04:[tool('knowledge.search')],
  F10_N05:[host('knowledge.check_supported_claims')],F11_N02:[tool('calendar.events')],F11_N04:[host('voice.ask_question')],
  F11_N05:[host('calendar.update_and_invalidate_reminder')],F12_N02:[host('policy.quiet_hours')],
  F12_N04:[host('notification.deliver')],F12_N05:[host('notification.deliver_when_due')],
  F13_N02:[host('system.registered_probe')],F13_N04:[host('runtime.confirmed_recovery')],
  F14_N01:[host('desktop.current_observation')],F14_N02:[host('runtime.desktop_input_lock')],
  F14_N03:[host('desktop.registered_input')],F14_N05:[host('voice.ask_question')],F14_N06:[host('desktop.registered_submit')],
  F15_N01:[tool('workspace.read_text')],F15_N04:[host('workspace.patch_scope_check')],
  F15_N05:[host('runtime.patch_and_required_checks')],F15_N06:[host('runtime.deliver_patch_evidence')],
  F16_N01:[host('github.bound_ci_failure')],F16_N03:[tool('workspace.apply_text_patch')],F16_N04:[host('workspace.test_intent_check')],
  F16_N05:[tool('workspace.run_allowed_command')],F17_N03:[tool('workspace.run_allowed_command')],F17_N04:[host('runtime.deliver_failure_report')],
  F18_N01:[host('github.bound_pr_diff')],F18_N04:[host('github.current_head_merge_gate')],F18_N05:[host('github.registered_merge')],
  F19_N01:[host('github.issue_snapshot')],F19_N03:[host('runtime.enqueue_issue_repair')],F19_N04:[host('github.merged_repair_readback')],
  F19_N05:[host('github.registered_close_issue')],F20_N01:[tool('workspace.read_text')],F20_N03:[tool('workspace.run_allowed_command')],
  F21_N01:[host('mcp_skill.source_manifest')],F21_N02:[host('mcp_skill.install_registry')],
  F21_N03:[host('mcp_skill.protocol_health')],F21_N04:[host('mcp_skill.isolated_probe')],F21_N05:[host('mcp_skill.enable_authorized')],
  F22_N09:[host('shadow.trigger_snapshot')],F22_N01:[host('shadow.versioned_snapshot')],
  F22_N03:[host('shadow.decision_snapshot')],F22_N04:[host('shadow.historical_trace')],F22_N05:[host('shadow.isolated_capabilities')],
  F22_N06:[host('shadow.counterfactual_evidence')],F23_N01:[host('evaluation.dataset_snapshot','platform')],
  F23_N02:[host('evaluation.temporal_leakage_check')],F23_N03:[host('evaluation.actual_result_dataset','platform')],
  F23_N05:[host('configuration.promote_with_rollback')],F24_N01:[host('runtime.persist_graph')],F24_N03:[host('policy.operation_scope_check')],
  F24_N04:[host('runtime.execute_published_operation')],F24_N05:[host('runtime.selected_branch_evidence')],F24_N06:[host('runtime.local_stop_observation')],
  F24_N07:[host('runtime.stop_not_started')],F24_N08:[host('runtime.stop_in_flight')],F24_N09:[host('runtime.reconcile_original_effect')],
  F24_N10:[host('runtime.keep_confirmed_effect')],F24_N11:[host('runtime.recover_checkpoint')],F24_N12:[host('runtime.publish_actual_status')],
  F25_N03:[host('policy.outbound_context_check')],F25_N04:[host('configuration.save_credential_reference')],
  F26_N02:[host('deployment.build_arm64_image','platform')],F26_N03:[host('deployment.runtime_readback','platform')],
  F26_N04:[host('deployment.real_tool_evidence','platform')],F26_N05:[host('deployment.publish_verified_coverage','platform')],
  F27_N01:[host('model.capabilities')],F27_N05:[host('memory.query')],F27_N06:[tool('knowledge.search')],
  F27_N04:[host('model.context_source_map_check')],F27_N07:[host('runtime.invalidate_context_mapping')],
  F28_N03:[host('model.native_config_check')],F28_N10:[host('workspace.source_and_test_check')],
  F28_N11:[host('runtime.completion_check')],F28_N12:[host('executor.scoped_tool_loop')],
};

function compile(feature: SourceFeature): OwnedWorkflowTemplate {
  const sourceIds = new Set(feature.nodes.map(node=>node.id));
  if (!/^F(?:0[1-9]|1[0-9]|2[0-8])$/.test(feature.id) || sourceIds.size!==feature.nodes.length) {
    throw new ProtocolError('INVALID_ARGUMENT','Invalid owned workflow template');
  }
  const predecessors = new Map(feature.nodes.map(node=>[node.id,node.dependencies]));
  const reaches = (from: string, target: string, seen = new Set<string>()): boolean => {
    if (from===target) return true;
    if (seen.has(from)) return false; seen.add(from);
    return (predecessors.get(from)??[]).some(id=>reaches(id,target,seen));
  };
  const nodes: OwnedWorkflowNode[] = feature.nodes.map(node=>{
    if (node.dependencies.some(id=>!sourceIds.has(id)||id===node.id)
      || node.dependencies.some(id=>reaches(id,node.id))) throw new ProtocolError('INVALID_ARGUMENT','Cyclic execution dependencies');
    const mapped = capabilities[node.id]??[];
    const semantic = node.kind==='semantic_decision' || node.id==='F10_N06' || node.id==='F22_N08';
    const kind: WorkflowStepKind = semantic ? 'decision' : mapped.length ? (mapped.every(item=>item.kind==='tool') ? 'tool':'host')
      : node.kind==='execution_model' || node.kind==='verification' ? 'executor'
      : node.kind==='input' ? 'input' : ['parallel_split','join','complete'].includes(node.kind) ? 'assemble':'host';
    if (kind==='host'&&!mapped.length) mapped.push(host(`unavailable.${node.id}`));
    const condition = ['F02_N09','F24_N06'].includes(node.id)
      ? '本地可信停止事件已触发；云端不会自行触发急停' : node.condition;
    return {id:node.id,label:node.label,designKind:node.kind,kind,
      dependencies:node.dependencies.map(nodeId=>({nodeId,
        required:feature.edges.find(edge=>edge.source===nodeId&&edge.target===node.id)?.required??true})),
      required:node.required,...(condition?{condition}:{}),
      ...(['F02_N09','F24_N06'].includes(node.id)?{hostGuard:true as const}:{}),resourceKeys:[...node.resourceKeys],
      effect: semantic || kind==='executor' || kind==='assemble' || kind==='input' ? 'none'
        : /写入|缓存/.test(node.effectType)
          || ['F02_N02','F02_N06','F02_N07','F02_N08','F06_N05','F12_N04','F12_N05',
            'F24_N07','F24_N08','F24_N10','F24_N11','F25_N04'].includes(node.id) ? 'write':'read',
      capabilities:mapped.map(item=>({...item})),
      inputFields:[...node.inputFields],outputFields:[...node.outputFields],
      ...(node.evidenceRequirement?{evidenceRequirement:node.evidenceRequirement}:{}),
      ...(node.modelAssignment?{modelAssignment:{...node.modelAssignment}}:{}),...(node.joinMode?{joinMode:node.joinMode}:{})};
  });
  const transitions = feature.edges.map(edge=>({source:edge.source,target:edge.target,required:edge.required,
    ...(edge.condition?{condition:edge.condition}:{}),feedback:reaches(edge.source,edge.target)}));
  const value = {workflowId:feature.id,bindingId:`owned-${feature.id}`,name:feature.name,version:OWNED_TEMPLATE_VERSION,
    nodes,transitions,recovery:[...feature.recovery],category:feature.category,summary:feature.summary,
    decisionPoints:[...feature.decisionPoints],designNotes:[...feature.designNotes],acceptance:[...feature.acceptance]};
  return {...value,templateDigest:createHash('sha256').update(JSON.stringify(value)).digest('hex')};
}
const templates = (OWNED_WORKFLOW_SOURCE as SourceFeature[]).map(compile);
if (templates.length!==28 || templates.reduce((sum,item)=>sum+item.nodes.length,0)!==185) {
  throw new ProtocolError('INVALID_ARGUMENT','Incomplete owned workflow catalog');
}
/** Detached public data. It contains no endpoints, secrets, mutable task state, or execution authority. */
export function getOwnedWorkflowTemplates(): OwnedWorkflowTemplate[] { return structuredClone(templates); }
/** Generated-design provenance, not a claim that external business services passed acceptance. */
export function getOwnedWorkflowDesignCoverage() {
  return {source:'docs/design/workflow-architecture-20261013/source/src/data/architecture.json',
    projectionSha256:createHash('sha256').update(JSON.stringify(OWNED_WORKFLOW_SOURCE)).digest('hex'),
    templateVersion:OWNED_TEMPLATE_VERSION,workflowCount:templates.length,nodeCount:templates.reduce((sum,item)=>sum+item.nodes.length,0),
    workflows:templates.map(({workflowId,templateDigest,nodes})=>({workflowId,templateDigest,nodeCount:nodes.length})),
    meaning:'Design coverage only; actual provider wiring and business verification are separate'};
}
export function getOwnedWorkflowTemplate(id: string): OwnedWorkflowTemplate | undefined {
  const template=templates.find(item=>item.workflowId===id||item.bindingId===id);
  return template&&structuredClone(template);
}
export function getOwnedWorkflowBindings() {
  return templates.map(({workflowId,bindingId,name,version,templateDigest,nodes})=>({id:bindingId,workflowId,name,
    workflowVersion:OWNED_WORKFLOW_VERSION,templateVersion:version,templateDigest,nodeCount:nodes.length,
    requirements:[...new Set(nodes.flatMap(node=>node.capabilities.map(item=>`${item.kind}:${item.name}`)))]}));
}

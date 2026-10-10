import {ProtocolError, validateToolValue} from '@personal-agent/contracts';
import {parseCoordinationResult} from '@personal-agent/coordination';
import type {CoordinationResult} from '@personal-agent/coordination';
import {ModelGateway} from '@personal-agent/models';
import type {ModelPort} from '@personal-agent/models';
import {parseAgentInput, repairInput, record} from './input.js';
import type {AgentInput, RepairContext, RepairRef, RepairSource} from './input.js';
import {FAST_PROMPT, DISPATCH_PROMPT, WORLD_PROMPT, PLAN_PROMPT, REVIEW_PROMPT, PROMPT_VERSION} from './prompts.js';
export {parseAgentInput, PROMPT_VERSION};
export type {AgentInput};

export type AgentRole = 'fast' | 'world' | 'plan' | 'review';
export interface AgentInvocation {query: string; deadline: string; signal: AbortSignal; sessionId: string; requestId: string}
export interface RoleReceipt {role: AgentRole; requestId: string; promptVersion: string; status: 'started' | 'completed' | 'failed'; totalTokens?: number}
export type AgentOutput = Omit<Extract<CoordinationResult, {kind: 'text'}>, 'verification'>
  | Omit<Extract<CoordinationResult, {kind: 'tool_proposal'}>, 'verification'>
  | Omit<Extract<CoordinationResult, {kind: 'repair_candidate'}>, 'verification'>;
type RepairChange = Extract<CoordinationResult, {kind: 'repair_candidate'}>['candidate']['changes'][number];
interface WorldReport {disposition: string; affected: string[]; complete: boolean}
interface PlanReport {disposition: string; changes: RepairChange[]; unsupported: boolean}

/** Cloud-only orchestration. There is deliberately no ToolHost, TaskRuntime or persistence. */
export class OwnedAgentOrchestrator {
  private readonly models: Record<AgentRole, ModelGateway>;
  constructor(models: Record<AgentRole, ModelPort>, private readonly maxOutputTokens: number,
    private readonly onReceipt?: (receipt: RoleReceipt) => void) {
    if (!Number.isSafeInteger(maxOutputTokens) || maxOutputTokens < 1) throw new ProtocolError('INVALID_ARGUMENT', 'Invalid model budget');
    this.models = {fast: new ModelGateway(models.fast), world: new ModelGateway(models.world),
      plan: new ModelGateway(models.plan), review: new ModelGateway(models.review)};
  }
  async invoke(request: AgentInvocation): Promise<AgentOutput> {
    if (!(request.signal instanceof AbortSignal) || !Number.isFinite(Date.parse(request.deadline))) {
      throw new ProtocolError('INVALID_ARGUMENT', 'Invalid invocation control');
    }
    this.check(request);
    const input = parseAgentInput(request.query);
    const repair = repairInput(input);
    let raw: unknown;
    let reviewedChanges: unknown;
    if (repair) {
      const world = await this.call('world', WORLD_PROMPT, repair.data, request);
      const worldReport = this.validateWorld(world, repair.context, repair.sources);
      if (worldReport.disposition === 'KEEP') return {kind: 'text', text: 'KEEP：世界状态分析无需修复。'};
      if (worldReport.disposition !== 'REVISE') return {kind: 'text', text: 'RECHECK：世界状态分析缺少确定的修复依据。'};
      const plan = await this.call('plan', PLAN_PROMPT, {input: repair.data, world}, request);
      const planReport = this.validatePlan(plan, repair.context, worldReport);
      if (planReport.disposition === 'KEEP') return {kind: 'text', text: 'KEEP：现有计划无需修复。'};
      if (planReport.disposition !== 'REVISE') return {kind: 'text', text: 'RECHECK：计划修复缺少确定依据。'};
      if (planReport.unsupported) throw new ProtocolError('UNSUPPORTED_CAPABILITY', 'Plan requests operations outside the repair candidate contract');
      if (planReport.changes.some(change => !worldReport.affected.includes(change.node.id))) {
        throw new ProtocolError('EXTERNAL_FAILURE', 'Plan exceeds world impact scope');
      }
      reviewedChanges = planReport.changes;
      raw = await this.call('review', REVIEW_PROMPT, {input: repair.data, world, plan}, request);
    } else {
      const deterministic = this.commandReceipt(input);
      if (deterministic) return deterministic;
      raw = await this.call('fast', input.kind === 'goal_analysis'
        ? FAST_PROMPT + '\n仅分析宿主 RECHECK 数据；只返回 text，不提出工具或修复候选。没有执行授权，尚未执行或修改计划。'
        : FAST_PROMPT + DISPATCH_PROMPT, input, request);
    }
    this.check(request);
    const object = record(raw);
    if (Object.hasOwn(object, 'verification')) throw new ProtocolError('EXTERNAL_FAILURE', 'Agent output includes a trust claim');
    let result: CoordinationResult;
    try { result = parseCoordinationResult({...object, verification: 'unverified'}); }
    catch { throw new ProtocolError('EXTERNAL_FAILURE', 'Agent output does not match the application contract'); }
    if (input.kind === 'goal_analysis') {
      if (result.kind !== 'text') throw new ProtocolError('EXTERNAL_FAILURE', 'Non-text output on an analysis-only route');
      try { result = parseCoordinationResult({...result, text: result.text + '\n仅分析；尚未执行或修改计划。'}); }
      catch { throw new ProtocolError('EXTERNAL_FAILURE', 'Analysis output exceeds the application contract'); }
    }
    if (result.kind === 'tool_proposal') {
      if (input.kind !== 'initial' || repair) throw new ProtocolError('EXTERNAL_FAILURE', 'Tool proposal on a result-only route');
      const tool = input.availableTools.find(item => item.name === result.toolName && item.version === result.toolVersion);
      if (!tool) throw new ProtocolError('UNSUPPORTED_CAPABILITY', 'Proposed tool is absent from the host catalog');
      validateToolValue(tool.inputSchema, result.arguments);
    }
    if (result.kind === 'repair_candidate') {
      if (!repair) throw new ProtocolError('EXTERNAL_FAILURE', 'Repair candidate on an ordinary route');
      this.validateChanges(result.candidate, repair.context);
      // Review may reject with text, but cannot silently replace the reviewed plan.
      const normalize = (changes: unknown) => (changes as typeof result.candidate.changes).map(change => ({
        node: {id: change.node.id, revision: change.node.revision}, summary: change.summary, reason: change.reason,
        dependencies: change.dependencies.map(dep => ({id: dep.id, revision: dep.revision})),
      }));
      if (JSON.stringify(normalize(result.candidate.changes)) !== JSON.stringify(normalize(reviewedChanges))) {
        throw new ProtocolError('EXTERNAL_FAILURE', 'Review substituted the proposed plan');
      }
    }
    const {verification: _verification, ...output} = result;
    return output;
  }
  private check(request: AgentInvocation): void {
    if (request.signal.aborted) throw new ProtocolError('CANCELLED', 'Agent invocation cancelled');
    if (Date.parse(request.deadline) <= Date.now()) throw new ProtocolError('TIMEOUT', 'Agent invocation deadline exceeded');
  }
  private emit(role: AgentRole, request: AgentInvocation, status: RoleReceipt['status'], totalTokens?: number): void {
    try { this.onReceipt?.({role, requestId: request.requestId, promptVersion: PROMPT_VERSION, status,
      ...(totalTokens === undefined ? {} : {totalTokens})}); } catch { /* Observability cannot change a result. */ }
  }
  private async call(role: AgentRole, prompt: string, data: unknown, request: AgentInvocation): Promise<unknown> {
    this.check(request); this.emit(role, request, 'started');
    try {
      const result = await this.models[role].complete({messages: [{role: 'system', content: prompt},
        {role: 'user', content: JSON.stringify(data)}], tools: [], requiredCapabilities: ['text'],
        maxOutputTokens: this.maxOutputTokens, reasoningEffort: 'none', deadline: request.deadline, signal: request.signal});
      this.check(request);
      if (result.response.kind !== 'final' || result.response.text.length > 16_000) throw new Error();
      const parsed: unknown = JSON.parse(result.response.text);
      record(parsed);
      this.emit(role, request, 'completed', result.usage?.totalTokens);
      return parsed;
    } catch (error) {
      this.emit(role, request, 'failed');
      if (error instanceof ProtocolError) throw error;
      throw new ProtocolError('EXTERNAL_FAILURE', 'Agent role returned an invalid response');
    }
  }
  private validateReport(value: unknown, plan: boolean, context: RepairContext): void {
    const report = record(value);
    const fields = plan ? ['disposition','changes','missing_information'] : ['disposition','affected','reason','missing_information'];
    if (Object.keys(report).length !== fields.length || fields.some(field => !Object.hasOwn(report, field))
      || !['KEEP','RECHECK','REVISE'].includes(report.disposition as string)
      || !Array.isArray(report.missing_information) || report.missing_information.some(item => typeof item !== 'string')) {
      throw new ProtocolError('EXTERNAL_FAILURE', 'Invalid role report');
    }
    if (report.disposition === 'REVISE' && report.missing_information.length) {
      throw new ProtocolError('EXTERNAL_FAILURE', 'Repair has unresolved missing information');
    }
    if (report.disposition === 'KEEP' && report.missing_information.length) {
      throw new ProtocolError('EXTERNAL_FAILURE', 'KEEP has unresolved missing information');
    }
    if (plan) {
      if (!Array.isArray(report.changes)) throw new ProtocolError('EXTERNAL_FAILURE', 'Invalid plan report');
      if (report.disposition === 'REVISE') this.validateChanges({expectedGraphRevision: context.expectedGraphRevision, changes: report.changes}, context);
      else if (report.changes.length) throw new ProtocolError('EXTERNAL_FAILURE', 'Uncertain plan includes changes');
    } else if (!Array.isArray(report.affected) || typeof report.reason !== 'string'
      || report.affected.some(id => !context.targets.some(target => target.node.id === id))) {
      throw new ProtocolError('EXTERNAL_FAILURE', 'World report exceeds repair scope');
    }
  }
  private reportObject(value: unknown, keys: readonly string[]): Record<string, unknown> {
    if (!value || typeof value !== 'object' || Array.isArray(value)) this.reportFailure();
    const item = value as Record<string, unknown>;
    if (Object.keys(item).length !== keys.length || keys.some(key => !Object.hasOwn(item, key))) this.reportFailure();
    return item;
  }
  private reportFailure(): never { throw new ProtocolError('EXTERNAL_FAILURE', 'Invalid versioned role report'); }
  private reportText(value: unknown): asserts value is string {
    if (typeof value !== 'string' || !value.trim() || value.length > 1024 || /[\u0000-\u001f\u007f]/.test(value)) this.reportFailure();
  }
  private reportArray(value: unknown, max = 16): unknown[] {
    if (!Array.isArray(value) || value.length > max) this.reportFailure();
    return value;
  }
  private reportTexts(value: unknown): string[] {
    const values = this.reportArray(value);
    values.forEach(item => this.reportText(item));
    if (new Set(values).size !== values.length) this.reportFailure();
    return values as string[];
  }
  private reportRef(value: unknown): RepairRef {
    const item = this.reportObject(value, ['id', 'revision']);
    this.reportText(item.id);
    if (!Number.isSafeInteger(item.revision) || (item.revision as number) < 1) this.reportFailure();
    return {id: item.id, revision: item.revision as number};
  }
  private validateWorld(value: unknown, context: RepairContext, sources: RepairSource[]): WorldReport {
    const report = record(value);
    if (!Object.hasOwn(report, 'reportVersion')) {
      this.validateReport(value, false, context);
      const affected = report.affected as string[];
      if (new Set(affected).size !== affected.length || (report.disposition === 'REVISE' && !affected.length)) this.reportFailure();
      if (report.disposition === 'KEEP' && affected.length) this.reportFailure();
      return {disposition: report.disposition as string, affected, complete: false};
    }
    this.reportObject(report, ['reportVersion','revision','observed_facts','changed_facts','affected_items',
      'missing_information','recommended_disposition','summary']);
    if (report.reportVersion !== '1.1' || report.revision !== context.expectedGraphRevision
      || !['KEEP','RECHECK','REVISE'].includes(report.recommended_disposition as string)) this.reportFailure();
    this.reportText(report.summary);
    const missing = this.reportTexts(report.missing_information);
    const observed = new Set<string>();
    let inferred = false;
    const sourceFor = (node: RepairRef) => sources.find(item => item.node.id === node.id && item.node.revision === node.revision);
    for (const raw of this.reportArray(report.observed_facts, 128)) {
      const item = this.reportObject(raw, ['node','fact','confidence']);
      const node = this.reportRef(item.node), source = sourceFor(node), key = JSON.stringify(node);
      if (!source || !['fact','goal'].includes(source.kind) || item.fact !== source.summary || !['explicit','inferred'].includes(item.confidence as string)
        || observed.has(key)) this.reportFailure();
      observed.add(key); inferred ||= item.confidence === 'inferred';
    }
    const changed = new Set<string>();
    for (const raw of this.reportArray(report.changed_facts, 128)) {
      const item = this.reportObject(raw, ['previous','current','change']);
      const previous = this.reportRef(item.previous), current = this.reportRef(item.current);
      const before = sourceFor(previous), after = sourceFor(current);
      this.reportText(item.change);
      if (!before || !after || before.kind !== after.kind || previous.id !== current.id
        || current.revision !== previous.revision + 1 || (before.summary === after.summary && before.state === after.state)
        || sources.some(other => other.node.id === current.id && other.node.revision > current.revision)
        || !observed.has(JSON.stringify(previous)) || !observed.has(JSON.stringify(current)) || changed.has(current.id)) this.reportFailure();
      changed.add(current.id);
    }
    const affected: string[] = [];
    for (const raw of this.reportArray(report.affected_items)) {
      const item = this.reportObject(raw, ['kind','node','impact','reason']);
      const node = this.reportRef(item.node);
      this.reportText(item.reason);
      if (!['decision','plan_step'].includes(item.kind as string) || !['direct','transitive'].includes(item.impact as string)
        || !context.targets.some(target => target.node.id === node.id && target.node.revision === node.revision)
        || (sources.length && !sources.some(source => source.node.id === node.id && source.node.revision === node.revision
          && source.kind === (item.kind === 'plan_step' ? 'plan' : 'decision')))
        || affected.includes(node.id)) this.reportFailure();
      affected.push(node.id);
    }
    if (report.recommended_disposition === 'REVISE' && (missing.length || inferred || !changed.size || !affected.length)) this.reportFailure();
    if (report.recommended_disposition === 'KEEP' && (missing.length || affected.length)) this.reportFailure();
    if (!sources.some(source => ['fact','goal'].includes(source.kind))
      && (report.recommended_disposition !== 'RECHECK' || !missing.length)) this.reportFailure();
    return {disposition: report.recommended_disposition as string, affected, complete: true};
  }
  private validatePlan(value: unknown, context: RepairContext, world: WorldReport): PlanReport {
    const report = record(value);
    if (!Object.hasOwn(report, 'reportVersion')) {
      if (world.complete) this.reportFailure();
      this.validateReport(value, true, context);
      return {disposition: report.disposition as string, changes: report.changes as RepairChange[], unsupported: false};
    }
    this.reportObject(report, ['reportVersion','base_revision','disposition','preserved_steps','rechecked_steps','revised_steps',
      'removed_steps','dependency_updates','evidence_required','missing_information','local_next_actions']);
    if (!world.complete || report.reportVersion !== '1.1' || report.base_revision !== context.expectedGraphRevision
      || !['KEEP','RECHECK','REVISE'].includes(report.disposition as string)) this.reportFailure();
    const missing = this.reportTexts(report.missing_information), evidence = this.reportTexts(report.evidence_required);
    const actions = this.reportTexts(report.local_next_actions), seen = new Set<string>();
    const classifications = new Map<string, string>();
    const changes: RepairChange[] = [];
    let removed = false, rechecked = false;
    for (const [field, text] of [['preserved_steps','reason'],['rechecked_steps','condition'],['revised_steps','replacement'],['removed_steps','reason']] as const) {
      for (const raw of this.reportArray(report[field])) {
        const item = this.reportObject(raw, field === 'revised_steps' ? ['node','replacement','reason'] : ['node',text]);
        const node = this.reportRef(item.node), target = context.targets.find(target => target.node.id === node.id && target.node.revision === node.revision);
        this.reportText(item[text]);
        if (!target || seen.has(node.id) || (field !== 'preserved_steps' && !world.affected.includes(node.id))) this.reportFailure();
        seen.add(node.id); classifications.set(node.id, field);
        if (field === 'revised_steps') {
          this.reportText(item.reason);
          changes.push({node, summary: item.replacement as string, reason: item.reason, dependencies: target.requestedDependencies});
        }
        removed ||= field === 'removed_steps'; rechecked ||= field === 'rechecked_steps';
      }
    }
    const updated = new Set<string>();
    for (const raw of this.reportArray(report.dependency_updates)) {
      const item = this.reportObject(raw, ['node','dependencies','reason']);
      const node = this.reportRef(item.node), change = changes.find(change => change.node.id === node.id && change.node.revision === node.revision);
      this.reportText(item.reason);
      const dependencies = this.reportArray(item.dependencies).map(item => this.reportRef(item));
      const refs = (values: RepairRef[]) => JSON.stringify(values.map(ref => [ref.id, ref.revision]));
      if (!change || updated.has(node.id) || refs(dependencies) !== refs(change.dependencies)) this.reportFailure();
      updated.add(node.id);
    }
    if (report.disposition === 'REVISE') {
      if (missing.length || !evidence.length || rechecked || world.affected.some(id => !classifications.has(id))) this.reportFailure();
      if (changes.some(change => !updated.has(change.node.id))) this.reportFailure();
      if (changes.length) this.validateChanges({expectedGraphRevision: context.expectedGraphRevision, changes}, context);
      else if (!removed && !actions.length) this.reportFailure();
    } else if (changes.length || removed || updated.size || actions.length) this.reportFailure();
    if (report.disposition === 'KEEP' && (missing.length || rechecked
      || world.affected.some(id => classifications.get(id) !== 'preserved_steps'))) this.reportFailure();
    return {disposition: report.disposition as string, changes, unsupported: removed || actions.length > 0};
  }
  private validateChanges(value: unknown, context: RepairContext): void {
    let parsed: Extract<CoordinationResult, {kind: 'repair_candidate'}>;
    try { parsed = parseCoordinationResult({kind:'repair_candidate',candidateVersion:'1.0',candidate:value,verification:'unverified'}) as typeof parsed; }
    catch { throw new ProtocolError('EXTERNAL_FAILURE', 'Invalid repair report'); }
    if (parsed.candidate.expectedGraphRevision !== context.expectedGraphRevision) throw new ProtocolError('EXTERNAL_FAILURE', 'Repair revision changed');
    for (const change of parsed.candidate.changes) {
      const target = context.targets.find(item => item.node.id === change.node.id && item.node.revision === change.node.revision);
      const refs = (dependencies: typeof change.dependencies) => JSON.stringify(dependencies.map(dep => [dep.id, dep.revision]));
      if (!target || refs(change.dependencies) !== refs(target.requestedDependencies)
        || (target.requestedSummary !== undefined && change.summary !== target.requestedSummary)) {
        throw new ProtocolError('EXTERNAL_FAILURE', 'Repair changed host constraints');
      }
    }
  }
  private commandReceipt(input: AgentInput): AgentOutput | undefined {
    if (input.kind !== 'continuation') return undefined;
    const value = input.continuation.result;
    if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
    const result = record(value);
    if (Object.keys(result).sort().join(',') !== 'exitCode,passed,recipeId') return undefined;
    const names: Record<string, string> = {'node-check':'语法检查','npm-build':'构建','npm-test':'测试'};
    if (typeof result.recipeId !== 'string' || !Object.hasOwn(names, result.recipeId)
      || !Number.isSafeInteger(result.exitCode) || typeof result.passed !== 'boolean'
      || result.passed !== (result.exitCode === 0)) throw new ProtocolError('INVALID_ARGUMENT', 'Inconsistent confirmed command result');
    return {kind:'text', text:`传入的已确认检查回执显示：${names[result.recipeId]}${result.passed ? '通过' : '未通过'}，退出码 ${result.exitCode}。`};
  }
}

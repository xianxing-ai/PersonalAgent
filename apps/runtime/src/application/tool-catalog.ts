import {ProtocolError, validateToolValue} from '@personal-agent/contracts';
import type {ToolDescriptor} from '@personal-agent/contracts';
import type {AgentToolPort} from '@personal-agent/agents';
import {Buffer} from 'node:buffer';
import {createHash} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import {MAX_AVAILABLE_TOOLS, MAX_AVAILABLE_TOOLS_JSON_BYTES} from '@personal-agent/coordination';
import type {TaskRuntime} from '../index.js';
import type {CompetitionToolExport} from './coordination.js';
import {TOOL_DISCOVERY_NAME,TOOL_DISCOVERY_VERSION} from './tool-discovery.js';

const CHECKPOINT = 'competition-tool-catalog';
const DISCOVERY_POOL = 'competition-tool-discovery-pool:v1';
const DISCOVERY_SELECTION = 'competition-tool-discovery-selection:';
const fingerprint = (value:unknown):string => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const NAME = /^[A-Za-z][A-Za-z0-9_.:-]{0,127}$/;
const VERSION = /^[0-9A-Za-z][0-9A-Za-z_.-]{0,63}$/;

export interface CompetitionToolAvailability {
  toolName: string;
  toolVersion: string;
  /** Trusted composition visibility only; internal ToolPort/readiness remain unchanged. */
  modelExposure?: 'internal';
  /** Explicit host-approved input paths whose scalar enum values are public, e.g. /units. */
  publicEnumPaths?: readonly string[];
  /** Fixed host-authored help. Arbitrary descriptor root metadata stays private. */
  publicDescription?: string;
  /** Trusted host health and scope check; registration alone never means ready. */
  available(input: {taskId: string; revision: number; deadline: string; signal: AbortSignal}): boolean | Promise<boolean>;
}

export interface CompetitionAvailableTool {
  name: string;
  version: string;
  inputSchema: Record<string, unknown>;
}

export interface CompetitionWorkerCapability {
  toolName:string;toolVersion:string;publicEnumPaths:readonly string[];
  requiredTool:{name:string;version:string};
  describe(input:{taskId:string;revision:number;deadline:string;signal:AbortSignal}):Promise<CompetitionAvailableTool|undefined>;
  /** Public shape only; does not call a provider or claim task readiness. */
  describeRegistered?:()=>CompetitionAvailableTool|undefined;
  sideEffect?:ToolDescriptor['sideEffect'];
}
export interface ConversationToolCapability extends CompetitionAvailableTool {
  requiresPresence:boolean;sideEffect:ToolDescriptor['sideEffect'];state:'registered_requires_task_authorization';
}

interface CatalogCheckpoint {
  revision: number;
  deadline: string;
  entries: CompetitionAvailableTool[];
  discoveryRunId?:string;
}

interface DiscoveryPool {version:'1.0';revision:number;deadline:string;digest:string;entries:CompetitionAvailableTool[];}
interface DiscoverySelection {version:'1.0';poolDigest:string;arguments:{query:string;cursor?:string};
  entries:CompetitionAvailableTool[];result:Record<string,unknown>;}

function safeSchema(value: unknown, depth = 0, publicEnums: ReadonlySet<string> = new Set(), parameterPath = ''): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value) || depth > 8) {
    throw new ProtocolError('INVALID_ARGUMENT', 'Tool input Schema cannot be projected');
  }
  const schema = value as Record<string, unknown>;
  // Public connector schemas may express scalar types using enum alone.
  // Infer the shape without publishing values unless the host approves their path.
  const scalarValues=Array.isArray(schema.enum)&&schema.enum.length?schema.enum:Object.hasOwn(schema,'const')?[schema.const]:undefined;
  const enumTypes = scalarValues?.length
    ? new Set(scalarValues.map(item => item === null ? 'null' : typeof item)) : undefined;
  const inferredType = enumTypes?.size === 1 ? [...enumTypes][0] : undefined;
  const type = schema.type ?? inferredType;
  if (!['object', 'array', 'string', 'integer', 'number', 'boolean'].includes(type as string)) {
    throw new ProtocolError('INVALID_ARGUMENT', 'Tool input Schema type is unavailable');
  }
  const result: Record<string, unknown> = {type};
  // Parameter help is untrusted data, never an instruction or authority source.
  // Root metadata remains private; only bounded public parameter help is exported.
  if (parameterPath && typeof schema.description === 'string') {
    const description = [...schema.description.replace(/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/g, ' ')].slice(0, 160).join('').trim();
    if (description) result.description = description;
  }
  if (publicEnums.has(parameterPath) && scalarValues) {
    if (scalarValues.some(item => !['string','number','boolean'].includes(typeof item)
      || (typeof item === 'number' && !Number.isFinite(item)))) {
      throw new ProtocolError('INVALID_ARGUMENT', 'Public tool enums must be scalar values');
    }
    result.enum = structuredClone(scalarValues);
  }
  if (type === 'object') {
    const properties = schema.properties??{};
    if (!properties || typeof properties !== 'object' || Array.isArray(properties)) {
      throw new ProtocolError('INVALID_ARGUMENT', 'Tool object Schema requires properties');
    }
    const projected: Record<string, unknown> = {};
    for (const [name, child] of Object.entries(properties)) {
      if (!NAME.test(name)) throw new ProtocolError('INVALID_ARGUMENT', 'Unsafe tool parameter name');
      projected[name] = safeSchema(child, depth + 1, publicEnums, `${parameterPath}/${name}`);
    }
    result.properties = projected;
    const required = schema.required ?? [];
    if (!Array.isArray(required) || required.some(item => typeof item !== 'string' || !(item in projected))) {
      throw new ProtocolError('INVALID_ARGUMENT', 'Invalid required tool parameters');
    }
    result.required = [...required];
    // Generic public object contracts (e.g. a separately parsed coding patch)
    // contain no property metadata to expose. Preserve their open JSON shape.
    result.additionalProperties = schema.properties===undefined&&schema.additionalProperties!==false;
  } else if (type === 'array') {
    result.items = safeSchema(schema.items, depth + 1, publicEnums, `${parameterPath}/*`);
  }
  for (const key of ['minLength', 'maxLength', 'minimum', 'maximum', 'minItems', 'maxItems']) {
    const number = schema[key];
    const signed = key === 'minimum' || key === 'maximum';
    if (typeof number === 'number' && Number.isFinite(number) && (signed || number >= 0)) result[key] = number;
  }
  return result;
}

function projectedSchema(descriptor: ToolDescriptor, binding: CompetitionToolAvailability): Record<string, unknown> {
  const schema=safeSchema(descriptor.inputSchema, 0, new Set(binding.publicEnumPaths ?? []));
  if(binding.publicDescription) schema.description=binding.publicDescription;
  return schema;
}

function withoutDescriptions(schema: Record<string, unknown>): Record<string, unknown> {
  const {description: _description, ...result} = schema;
  if (result.properties) result.properties = Object.fromEntries(Object.entries(result.properties as Record<string, Record<string, unknown>>)
    .map(([name, child]) => [name, withoutDescriptions(child)]));
  if (result.items) result.items = withoutDescriptions(result.items as Record<string, unknown>);
  return result;
}

function sameSchema(fresh: Record<string, unknown>, saved: Record<string, unknown>): boolean {
  return isDeepStrictEqual(fresh, saved) || isDeepStrictEqual(withoutDescriptions(fresh), saved)
    || isDeepStrictEqual(withoutParameterDescriptions(fresh),saved);
}

function withoutParameterDescriptions(schema:Record<string,unknown>):Record<string,unknown> {
  return {...withoutDescriptions(schema),...(typeof schema.description==='string'?{description:schema.description}:{})};
}
const fitsCatalog=(entries:readonly CompetitionAvailableTool[]):boolean => entries.length<=MAX_AVAILABLE_TOOLS
  &&Buffer.byteLength(JSON.stringify(entries),'utf8')<=MAX_AVAILABLE_TOOLS_JSON_BYTES;

export class RuntimeCompetitionToolCatalog {
  readonly sideEffect: ToolDescriptor['sideEffect'];
  /** Child worker sees only the same bounded ToolPort used for execution. */
  restrict(tools:AgentToolPort):RuntimeCompetitionToolCatalog {
    const descriptors=tools.list();
    const allowed=(name:string,version:string)=>descriptors.some(tool=>tool.name===name&&tool.version===version);
    return new RuntimeCompetitionToolCatalog(this.runtime,tools,
      this.exports.filter(item=>allowed(item.toolName,item.toolVersion)),
      this.availability.filter(item=>allowed(item.toolName,item.toolVersion)),
      this.workers.filter(item=>allowed(item.requiredTool.name,item.requiredTool.version)),this.isUserPresent,this.discoveryEnabled);
  }

  constructor(
    private readonly runtime: TaskRuntime,
    private readonly tools: AgentToolPort,
    private readonly exports: readonly CompetitionToolExport[],
    private readonly availability: readonly CompetitionToolAvailability[],
    private readonly workers:readonly CompetitionWorkerCapability[] = [],
    private readonly isUserPresent:((taskId:string)=>boolean)|undefined = undefined,
    private readonly discoveryEnabled=false,
  ) {
    const names = new Set<string>();
    for (const entry of availability) {
      const key = JSON.stringify([entry.toolName, entry.toolVersion]);
      if (!NAME.test(entry.toolName) || !VERSION.test(entry.toolVersion)
        || typeof entry.available !== 'function' || names.has(key)
        || (entry.modelExposure!==undefined&&entry.modelExposure!=='internal')
        || (entry.publicDescription!==undefined&&(typeof entry.publicDescription!=='string'||!entry.publicDescription.trim()
          ||entry.publicDescription.length>512||/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/u.test(entry.publicDescription)))
        || (entry.publicEnumPaths !== undefined && (!Array.isArray(entry.publicEnumPaths)
          || entry.publicEnumPaths.some(value => typeof value !== 'string'
            || !/^\/(?:[A-Za-z][A-Za-z0-9_.:-]*|\*)(?:\/(?:[A-Za-z][A-Za-z0-9_.:-]*|\*))*$/.test(value))))) {
        throw new ProtocolError('INVALID_ARGUMENT', 'Invalid Competition tool availability binding');
      }
      names.add(key);
    }
    for(const worker of workers) {
      const key=JSON.stringify([worker.toolName,worker.toolVersion]);
      if(names.has(key) || !NAME.test(worker.toolName) || !VERSION.test(worker.toolVersion))throw new ProtocolError('INVALID_ARGUMENT','Duplicate worker capability');
      names.add(key);
    }
    const selectable = this.tools.list().filter(descriptor => availability.some(entry => entry.toolName === descriptor.name && entry.toolVersion === descriptor.version)
      && exports.some(entry => entry.toolName === descriptor.name && entry.toolVersion === descriptor.version));
    this.sideEffect = selectable.some(descriptor => descriptor.sideEffect === 'external_write') ? 'external_write'
      : selectable.some(descriptor => descriptor.sideEffect === 'local_write') ? 'local_write' : 'read';
  }

  private present(taskId:string):boolean {try{return this.isUserPresent?.(taskId)===true;}catch{return false;}}

  /** Registration/shape metadata only. This cannot authorize or execute a tool. */
  describe():ConversationToolCapability[] {
    const result:ConversationToolCapability[]=[];
    for(const binding of this.availability) {
      if(binding.modelExposure==='internal')continue;
      const descriptor=this.tools.list().find(tool=>tool.name===binding.toolName&&tool.version===binding.toolVersion);
      if(!descriptor||!this.exports.some(item=>item.toolName===descriptor.name&&item.toolVersion===descriptor.version))continue;
      result.push({name:descriptor.name,version:descriptor.version,inputSchema:projectedSchema(descriptor,binding),
        requiresPresence:descriptor.requiresPresence,sideEffect:descriptor.sideEffect,state:'registered_requires_task_authorization'});
    }
    for(const worker of this.workers) {
      if(!this.tools.list().some(tool=>tool.name===worker.requiredTool.name&&tool.version===worker.requiredTool.version))continue;
      const descriptor=worker.describeRegistered?.();if(!descriptor)continue;
      result.push({...descriptor,inputSchema:safeSchema(descriptor.inputSchema,0,new Set(worker.publicEnumPaths)),
        requiresPresence:false,sideEffect:worker.sideEffect??'read',state:'registered_requires_task_authorization'});
    }
    return structuredClone(result);
  }

  private async readProvider<T>(input: {taskId: string; revision: number; deadline: string; signal: AbortSignal},
    read: (view: {taskId: string; revision: number; deadline: string; signal: AbortSignal}) => T | Promise<T>): Promise<T | undefined> {
    const signal = input.signal;
    const deadline = input.deadline;
    const expiresAt = Date.parse(deadline);
    const view = {taskId: input.taskId, revision: input.revision, deadline, signal};
    if (signal.aborted) throw new ProtocolError('CANCELLED', 'Tool catalog selection cancelled');
    const remaining = expiresAt - Date.now();
    if (!Number.isFinite(remaining) || remaining <= 0) throw new ProtocolError('TIMEOUT', 'Tool catalog selection expired');
    let timer: ReturnType<typeof setTimeout> | undefined;
    let onAbort = (): void => {};
    const interrupted = new Promise<never>((_, reject) => {
      onAbort = () => reject(new ProtocolError('CANCELLED', 'Tool catalog selection cancelled'));
      signal.addEventListener('abort', onAbort, {once: true});
      const scheduleDeadline = (): void => {
        const delay = expiresAt - Date.now();
        if (delay <= 0) {
          reject(new ProtocolError('TIMEOUT', 'Tool catalog selection expired'));
          return;
        }
        timer = setTimeout(scheduleDeadline, Math.min(delay, 2_147_483_647));
      };
      scheduleDeadline();
      if (signal.aborted) onAbort();
    });
    try {
      const result = await Promise.race([Promise.resolve().then(() => read(view)), interrupted]);
      if (signal.aborted) throw new ProtocolError('CANCELLED', 'Tool catalog selection cancelled');
      if (Date.now() >= expiresAt) throw new ProtocolError('TIMEOUT', 'Tool catalog selection expired');
      return result;
    } catch {
      // Catalog providers do not own this task's cancellation or deadline.
      // Their errors can contain private host details, including ProtocolErrors.
      if (signal.aborted) throw new ProtocolError('CANCELLED', 'Tool catalog selection cancelled');
      if (Date.now() >= expiresAt) throw new ProtocolError('TIMEOUT', 'Tool catalog selection expired');
      return undefined;
    } finally {
      if (timer) clearTimeout(timer);
      signal.removeEventListener('abort', onAbort);
    }
  }

  private async ready(binding: CompetitionToolAvailability, input: {taskId: string; revision: number; deadline: string; signal: AbortSignal}): Promise<boolean> {
    return await this.readProvider(input, view => binding.available(view)) === true;
  }

  private assertCurrent(input: {taskId: string; revision: number; deadline: string; signal: AbortSignal}): void {
    if (input.signal.aborted) throw new ProtocolError('CANCELLED', 'Competition catalog selection cancelled');
    if (Date.now() >= Date.parse(input.deadline)) throw new ProtocolError('TIMEOUT', 'Competition catalog selection expired');
    const task = this.runtime.getTask(input.taskId);
    if (task.state !== 'running' || task.cancelRequested || task.revision !== input.revision
      || this.runtime.loadCheckpoint(input.taskId, 'application-profile') !== 'huawei_ict_agentarts'
      || this.runtime.loadCheckpoint(input.taskId, 'application-deadline') !== input.deadline) {
      throw new ProtocolError('UNAUTHORIZED', 'Competition catalog is not bound to the current task revision');
    }
  }

  async prepare(input: {taskId: string; deadline: string; signal: AbortSignal}): Promise<CompetitionAvailableTool[]> {
    const revision = this.runtime.getTask(input.taskId).revision;
    this.assertCurrent({...input, revision});
    const saved = this.runtime.loadCheckpoint(input.taskId, CHECKPOINT) as CatalogCheckpoint | undefined;
    if (saved) {
      if (saved.deadline !== input.deadline || saved.revision !== revision) {
        throw new ProtocolError('UNAUTHORIZED', 'Competition tool catalog revision changed');
      }
      return structuredClone(saved.entries);
    }
    const descriptors = this.tools.list();
    const selected: CompetitionAvailableTool[] = [];
    for (const binding of this.availability) {
      if(binding.modelExposure==='internal')continue;
      const descriptor = descriptors.find(item => item.name === binding.toolName && item.version === binding.toolVersion);
      if (!descriptor || (descriptor.requiresPresence&&this.isUserPresent===undefined)
        || !this.exports.some(item => item.toolName === binding.toolName && item.toolVersion === binding.toolVersion)) continue;
      if (!await this.ready(binding, {...input, revision})) continue;
      selected.push({name: descriptor.name, version: descriptor.version, inputSchema: projectedSchema(descriptor, binding)});
      if (selected.length > MAX_AVAILABLE_TOOLS && !this.discoveryEnabled) {
        throw new ProtocolError('INVALID_ARGUMENT', 'Competition tool catalog exceeds its limit');
      }
    }
    for(const worker of this.workers) {
      if(!descriptors.some(tool=>tool.name===worker.requiredTool.name&&tool.version===worker.requiredTool.version))continue;
      const descriptor=await this.readProvider({...input,revision},view=>worker.describe(view));
      if(!descriptor)continue;
      if(descriptor.name!==worker.toolName || descriptor.version!==worker.toolVersion)throw new ProtocolError('UNAUTHORIZED','Worker descriptor identity changed');
      selected.push({...descriptor,inputSchema:safeSchema(descriptor.inputSchema,0,new Set(worker.publicEnumPaths))});
    }
    const originalEntries=structuredClone(selected);
    if (Buffer.byteLength(JSON.stringify(selected), 'utf8') > MAX_AVAILABLE_TOOLS_JSON_BYTES) {
      for (const item of selected) item.inputSchema = withoutParameterDescriptions(item.inputSchema);
    }
    if(!fitsCatalog(selected)) {
      const discovery=originalEntries.find(item=>item.name===TOOL_DISCOVERY_NAME&&item.version===TOOL_DISCOVERY_VERSION);
      if(!this.discoveryEnabled||!discovery||!fitsCatalog([discovery]))
        throw new ProtocolError('INVALID_ARGUMENT','Competition tool catalog structure exceeds its limit');
      selected.splice(0,selected.length,discovery);
    }
    this.assertCurrent({...input, revision});
    if(this.discoveryEnabled) {
      const pool:DiscoveryPool={version:'1.0',revision,deadline:input.deadline,digest:fingerprint(originalEntries),entries:originalEntries};
      if(!this.runtime.saveCheckpointOnce(input.taskId,DISCOVERY_POOL,pool)
        &&!isDeepStrictEqual(this.runtime.loadCheckpoint(input.taskId,DISCOVERY_POOL),pool))
        throw new ProtocolError('REVISION_CONFLICT','Original discovery tool set changed');
    }
    this.runtime.saveCheckpoint(input.taskId, CHECKPOINT, {revision, deadline: input.deadline, entries: selected});
    return structuredClone(selected);
  }

  private discoveryPool(input:{taskId:string;revision:number;deadline:string;signal:AbortSignal}):DiscoveryPool {
    this.assertCurrent(input);
    const pool=this.runtime.loadCheckpoint(input.taskId,DISCOVERY_POOL) as DiscoveryPool|undefined;
    if(!this.discoveryEnabled||pool?.version!=='1.0'||pool.deadline!==input.deadline||pool.revision>input.revision
      ||!Array.isArray(pool.entries)||pool.digest!==fingerprint(pool.entries)
      ||!pool.entries.some(entry=>entry.name===TOOL_DISCOVERY_NAME&&entry.version===TOOL_DISCOVERY_VERSION))
      throw new ProtocolError('UNAUTHORIZED','Original task tool discovery binding is unavailable');
    return pool;
  }

  private async entryCurrent(entry:CompetitionAvailableTool,input:{taskId:string;revision:number;deadline:string;signal:AbortSignal}):Promise<boolean> {
    const worker=this.workers.find(value=>value.toolName===entry.name&&value.toolVersion===entry.version);
    if(worker) {
      const current=await this.readProvider(input,view=>worker.describe(view));
      return current!==undefined&&current.name===entry.name&&current.version===entry.version
        &&sameSchema(safeSchema(current.inputSchema,0,new Set(worker.publicEnumPaths)),entry.inputSchema);
    }
    const binding=this.availability.find(value=>value.toolName===entry.name&&value.toolVersion===entry.version);
    const descriptor=this.tools.list().find(value=>value.name===entry.name&&value.version===entry.version);
    return !!binding&&binding.modelExposure!=='internal'&&!!descriptor
      &&(!descriptor.requiresPresence||this.isUserPresent!==undefined)
      &&this.exports.some(value=>value.toolName===entry.name&&value.toolVersion===entry.version)
      &&sameSchema(projectedSchema(descriptor,binding),entry.inputSchema)&&await this.ready(binding,input);
  }

  /** Read-only discovery over this task's original frozen candidates, never a general invoker. */
  async search(input:{taskId:string;runId:string;deadline:string;signal:AbortSignal;arguments:{query:string;cursor?:string}}):Promise<Record<string,unknown>> {
    const view={...input,revision:this.runtime.getTask(input.taskId).revision},pool=this.discoveryPool(view);
    const previous=this.runtime.loadCheckpoint(input.taskId,DISCOVERY_SELECTION+input.runId) as DiscoverySelection|undefined;
    if(previous) {
      if(previous.poolDigest!==pool.digest||!isDeepStrictEqual(previous.arguments,input.arguments))
        throw new ProtocolError('REVISION_CONFLICT','Discovery run identity is bound to another query');
      return structuredClone(previous.result);
    }
    const query=input.arguments.query.trim().toLowerCase(),terms=query.split(/\s+/u).filter(Boolean);
    const candidates=pool.entries.filter(entry=>entry.name!==TOOL_DISCOVERY_NAME
      &&terms.every(term=>`${entry.name} ${String(entry.inputSchema.description??'')}`.toLowerCase().includes(term)));
    let offset=0;
    if(input.arguments.cursor!==undefined) {
      try {
        const cursor=JSON.parse(Buffer.from(input.arguments.cursor,'base64url').toString('utf8')) as Record<string,unknown>;
        if(Object.keys(cursor).length!==4||cursor.task!==input.taskId||cursor.pool!==pool.digest||cursor.query!==fingerprint(query)
          ||!Number.isSafeInteger(cursor.offset)||(cursor.offset as number)<0||(cursor.offset as number)>candidates.length)throw Error();
        offset=cursor.offset as number;
      }catch{throw new ProtocolError('INVALID_ARGUMENT','Discovery cursor does not match the original task and query');}
    }
    const discovery=pool.entries.find(entry=>entry.name===TOOL_DISCOVERY_NAME&&entry.version===TOOL_DISCOVERY_VERSION)!;
    if(!await this.entryCurrent(discovery,view))throw new ProtocolError('UNAUTHORIZED','Original discovery tool became unavailable');
    let entries:CompetitionAvailableTool[]=[discovery];
    const matches:{name:string;version:string;state:'selected'|'unavailable'|'schema_too_large'}[]=[];
    let next=offset;
    for(;next<candidates.length&&matches.length<MAX_AVAILABLE_TOOLS-1;next++) {
      const entry=candidates[next]!;
      if(!await this.entryCurrent(entry,view)){matches.push({name:entry.name,version:entry.version,state:'unavailable'});continue;}
      const proposed=[...entries,entry];
      const compact=proposed.map(item=>({...item,inputSchema:withoutParameterDescriptions(item.inputSchema)}));
      if(fitsCatalog(proposed))entries=proposed;
      else if(fitsCatalog(compact))entries=compact;
      else if(entries.length===1){matches.push({name:entry.name,version:entry.version,state:'schema_too_large'});continue;}
      else break;
      matches.push({name:entry.name,version:entry.version,state:'selected'});
    }
    const counts=new Map<string,number>();
    for(const entry of pool.entries)if(entry.name!==TOOL_DISCOVERY_NAME){const namespace=entry.name.split('.')[0]!;counts.set(namespace,(counts.get(namespace)??0)+1);}
    const groups=[...counts].sort(([a],[b])=>a.localeCompare(b)).map(([namespace,count])=>({namespace,count}));
    const result:Record<string,unknown>={catalogRef:pool.digest,query:input.arguments.query,totalMatches:candidates.length,offset,hasMore:next<candidates.length,
      ...(next<candidates.length?{nextCursor:Buffer.from(JSON.stringify({task:input.taskId,pool:pool.digest,query:fingerprint(query),offset:next})).toString('base64url')}:{}),
      groups:groups.slice(0,64),groupsTruncated:groups.length>64,matches,
      selectedTools:entries.slice(1).map(({name,version})=>({name,version})),authorization:'checked_on_invocation'};
    const selection:DiscoverySelection={version:'1.0',poolDigest:pool.digest,arguments:structuredClone(input.arguments),entries:structuredClone(entries),result};
    this.assertCurrent(view);
    if(!this.runtime.saveCheckpointOnce(input.taskId,DISCOVERY_SELECTION+input.runId,selection))
      throw new ProtocolError('REVISION_CONFLICT','Discovery selection already exists');
    return structuredClone(result);
  }

  /** Activate only a result independently recorded as confirmed by the original Runtime. */
  async confirmDiscovery(input:{taskId:string;runId:string;toolName:string;toolVersion:string;arguments:Record<string,unknown>;
    result:unknown;deadline:string;signal:AbortSignal}):Promise<void> {
    if(input.toolName!==TOOL_DISCOVERY_NAME||input.toolVersion!==TOOL_DISCOVERY_VERSION)return;
    const view={...input,revision:this.runtime.getTask(input.taskId).revision},pool=this.discoveryPool(view);
    const selection=this.runtime.loadCheckpoint(input.taskId,DISCOVERY_SELECTION+input.runId) as DiscoverySelection|undefined;
    const record=this.runtime.readToolExecutions(input.taskId).find(value=>value.evidenceId===input.runId);
    const cache=this.runtime.loadCheckpoint(input.taskId,'tool-result-'+input.runId) as {result:unknown}|undefined;
    if(!selection||selection.poolDigest!==pool.digest||!isDeepStrictEqual(selection.arguments,input.arguments)
      ||!isDeepStrictEqual(selection.result,input.result)||!isDeepStrictEqual(cache?.result,input.result)
      ||!record||record.state!=='confirmed'||record.policyDecision!=='allow'||record.executionStarted!==true
      ||record.toolName!==TOOL_DISCOVERY_NAME||record.toolVersion!==TOOL_DISCOVERY_VERSION
      ||!this.runtime.matchesToolExecutionInput(record,{arguments:input.arguments,scopeRef:input.runId})
      ||!fitsCatalog(selection.entries))throw new ProtocolError('UNAUTHORIZED','Discovery selection has no matching confirmed Runtime receipt');
    for(const entry of selection.entries) {
      const original=pool.entries.find(value=>value.name===entry.name&&value.version===entry.version);
      if(!original||!sameSchema(original.inputSchema,entry.inputSchema)||!await this.entryCurrent(entry,view))
        throw new ProtocolError('UNAUTHORIZED','Discovered capability changed before selection');
    }
    this.assertCurrent(view);
    const saved=this.runtime.loadCheckpoint(input.taskId,CHECKPOINT) as CatalogCheckpoint|undefined;
    if(saved?.discoveryRunId===input.runId){if(!isDeepStrictEqual(saved.entries,selection.entries))throw new ProtocolError('REVISION_CONFLICT','Confirmed discovery selection changed');return;}
    this.runtime.saveCheckpoint(input.taskId,CHECKPOINT,{revision:view.revision,deadline:input.deadline,entries:selection.entries,discoveryRunId:input.runId});
  }

  /** A continuation reuses only the original selection. Approval may advance the
   * task revision; new registrations or newly ready capabilities never expand it. */
  async prepareContinuation(input: {taskId: string; deadline: string; signal: AbortSignal}): Promise<CompetitionAvailableTool[]> {
    const revision=this.runtime.getTask(input.taskId).revision;
    const saved=this.runtime.loadCheckpoint(input.taskId,CHECKPOINT) as CatalogCheckpoint|undefined;
    if(!saved)throw new ProtocolError('UNAUTHORIZED','Original Competition tool catalog is missing');
    await this.assertSelectionCurrent({...input,revision,availableTools:saved.entries,continuation:true});
    return structuredClone(saved.entries);
  }

  /** A cloud proposal must match the persisted selection and the original local Schema. */
  async assertProposal(input: {taskId: string; toolName: string; toolVersion: string;
    arguments: Record<string, unknown>; deadline: string; signal: AbortSignal;
    revision: number; firstCloudRequest: boolean}): Promise<void> {
    const revision = input.revision;
    this.assertCurrent(input);
    const saved = this.runtime.loadCheckpoint(input.taskId, CHECKPOINT) as CatalogCheckpoint | undefined;
    const entry = saved?.entries.find(item => item.name === input.toolName && item.version === input.toolVersion);
    const worker=this.workers.find(item=>item.toolName===input.toolName && item.toolVersion===input.toolVersion);
    if(worker) {
      const fresh=await this.readProvider(input,view=>worker.describe(view));
      if(!entry || !fresh || fresh.name!==worker.toolName || fresh.version!==worker.toolVersion || saved?.deadline!==input.deadline
        || (input.firstCloudRequest && saved.revision!==revision)
        || !sameSchema(safeSchema(fresh.inputSchema,0,new Set(worker.publicEnumPaths)),entry.inputSchema)) {
        throw new ProtocolError('UNAUTHORIZED','Worker selection is no longer available');
      }
      validateToolValue(fresh.inputSchema,input.arguments);this.assertCurrent(input);return;
    }
    const binding = this.availability.find(item => item.toolName === input.toolName && item.toolVersion === input.toolVersion);
    const descriptor: ToolDescriptor | undefined = this.tools.list().find(item => item.name === input.toolName && item.version === input.toolVersion);
    if (!entry || !binding || binding.modelExposure==='internal' || !descriptor || (descriptor.requiresPresence&&!this.present(input.taskId))
      || (input.firstCloudRequest && saved?.revision !== revision)
      || (saved !== undefined && saved.revision > revision) || saved?.deadline !== input.deadline
      || !sameSchema(projectedSchema(descriptor, binding), entry.inputSchema)
      || !await this.ready(binding, {...input, revision})) {
      throw new ProtocolError('UNSUPPORTED_CAPABILITY', 'Competition tool is unavailable for this task');
    }
    this.assertCurrent({...input, revision});
    validateToolValue(descriptor.inputSchema, input.arguments);
  }

  /** Final check immediately before sending the selected directory to a cloud adapter. */
  async assertSelectionCurrent(input: {taskId: string; revision: number; deadline: string; signal: AbortSignal;
    availableTools: readonly CompetitionAvailableTool[];continuation?:true}): Promise<void> {
    this.assertCurrent(input);
    const saved = this.runtime.loadCheckpoint(input.taskId, CHECKPOINT) as CatalogCheckpoint | undefined;
    if (!saved || (input.continuation?saved.revision>input.revision:saved.revision!==input.revision) || saved.deadline !== input.deadline
      || !isDeepStrictEqual(saved.entries, input.availableTools)) {
      throw new ProtocolError('UNAUTHORIZED', 'Competition tool catalog changed before export');
    }
    for (const item of saved.entries) {
      const worker=this.workers.find(worker=>worker.toolName===item.name && worker.toolVersion===item.version);
      if(worker) {
        const fresh=await this.readProvider(input,view=>worker.describe(view));
        if(!fresh || fresh.name!==worker.toolName || fresh.version!==worker.toolVersion
          || !sameSchema(safeSchema(fresh.inputSchema,0,new Set(worker.publicEnumPaths)),item.inputSchema))throw new ProtocolError('UNAUTHORIZED','Worker became unavailable before send');
        continue;
      }
      const binding = this.availability.find(entry => entry.toolName === item.name && entry.toolVersion === item.version);
      const descriptor = this.tools.list().find(entry => entry.name === item.name && entry.version === item.version);
      if (!binding || binding.modelExposure==='internal' || !descriptor || (descriptor.requiresPresence&&this.isUserPresent===undefined)
        || !sameSchema(projectedSchema(descriptor, binding), item.inputSchema)
        || !await this.ready(binding, input)) {
        throw new ProtocolError('UNAUTHORIZED', 'Competition tool became unavailable before export');
      }
    }
    this.assertCurrent(input);
  }
}

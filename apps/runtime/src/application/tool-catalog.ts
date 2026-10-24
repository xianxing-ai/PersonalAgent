import {ProtocolError, validateToolValue} from '@personal-agent/contracts';
import type {ToolDescriptor} from '@personal-agent/contracts';
import type {AgentToolPort} from '@personal-agent/agents';
import {Buffer} from 'node:buffer';
import {isDeepStrictEqual} from 'node:util';
import {MAX_AVAILABLE_TOOLS, MAX_AVAILABLE_TOOLS_JSON_BYTES} from '@personal-agent/coordination';
import type {TaskRuntime} from '../index.js';
import type {CompetitionToolExport} from './coordination.js';

const CHECKPOINT = 'competition-tool-catalog';
const NAME = /^[A-Za-z][A-Za-z0-9_.:-]{0,127}$/;
const VERSION = /^[0-9A-Za-z][0-9A-Za-z_.-]{0,63}$/;

export interface CompetitionToolAvailability {
  toolName: string;
  toolVersion: string;
  /** Trusted composition visibility only; internal ToolPort/readiness remain unchanged. */
  modelExposure?: 'internal';
  /** Explicit host-approved input paths whose scalar enum values are public, e.g. /units. */
  publicEnumPaths?: readonly string[];
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
}

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
  return safeSchema(descriptor.inputSchema, 0, new Set(binding.publicEnumPaths ?? []));
}

function withoutDescriptions(schema: Record<string, unknown>): Record<string, unknown> {
  const {description: _description, ...result} = schema;
  if (result.properties) result.properties = Object.fromEntries(Object.entries(result.properties as Record<string, Record<string, unknown>>)
    .map(([name, child]) => [name, withoutDescriptions(child)]));
  if (result.items) result.items = withoutDescriptions(result.items as Record<string, unknown>);
  return result;
}

function sameSchema(fresh: Record<string, unknown>, saved: Record<string, unknown>): boolean {
  return isDeepStrictEqual(fresh, saved) || isDeepStrictEqual(withoutDescriptions(fresh), saved);
}

export class RuntimeCompetitionToolCatalog {
  readonly sideEffect: ToolDescriptor['sideEffect'];
  /** Child worker sees only the same bounded ToolPort used for execution. */
  restrict(tools:AgentToolPort):RuntimeCompetitionToolCatalog {
    const descriptors=tools.list();
    const allowed=(name:string,version:string)=>descriptors.some(tool=>tool.name===name&&tool.version===version);
    return new RuntimeCompetitionToolCatalog(this.runtime,tools,
      this.exports.filter(item=>allowed(item.toolName,item.toolVersion)),
      this.availability.filter(item=>allowed(item.toolName,item.toolVersion)),
      this.workers.filter(item=>allowed(item.requiredTool.name,item.requiredTool.version)),this.isUserPresent);
  }

  constructor(
    private readonly runtime: TaskRuntime,
    private readonly tools: AgentToolPort,
    private readonly exports: readonly CompetitionToolExport[],
    private readonly availability: readonly CompetitionToolAvailability[],
    private readonly workers:readonly CompetitionWorkerCapability[] = [],
    private readonly isUserPresent:((taskId:string)=>boolean)|undefined = undefined,
  ) {
    const names = new Set<string>();
    for (const entry of availability) {
      const key = JSON.stringify([entry.toolName, entry.toolVersion]);
      if (!NAME.test(entry.toolName) || !VERSION.test(entry.toolVersion)
        || typeof entry.available !== 'function' || names.has(key)
        || (entry.modelExposure!==undefined&&entry.modelExposure!=='internal')
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
      if (selected.length > MAX_AVAILABLE_TOOLS) {
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
    if (Buffer.byteLength(JSON.stringify(selected), 'utf8') > MAX_AVAILABLE_TOOLS_JSON_BYTES) {
      for (const item of selected) item.inputSchema = withoutDescriptions(item.inputSchema);
    }
    if(selected.length>MAX_AVAILABLE_TOOLS || Buffer.byteLength(JSON.stringify(selected),'utf8')>MAX_AVAILABLE_TOOLS_JSON_BYTES)throw new ProtocolError('INVALID_ARGUMENT','Competition tool catalog structure exceeds its limit');
    this.assertCurrent({...input, revision});
    this.runtime.saveCheckpoint(input.taskId, CHECKPOINT, {revision, deadline: input.deadline, entries: selected});
    return structuredClone(selected);
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

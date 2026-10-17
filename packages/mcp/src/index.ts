import {createHash} from 'node:crypto';
import {realpathSync, statSync} from 'node:fs';
import {lstat, realpath, stat} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {isAbsolute, relative, resolve, sep} from 'node:path';
import {execFile} from 'node:child_process';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StdioClientTransport, DEFAULT_INHERITED_ENV_VARS} from '@modelcontextprotocol/sdk/client/stdio.js';
import {CallToolResultSchema} from '@modelcontextprotocol/sdk/types.js';
import {ProtocolError, validateToolValue} from '@personal-agent/contracts';
import type {RegisteredTool, ToolContext, ToolHost} from '@personal-agent/contracts';
export {createPublicReferenceExport} from './public-export.js';
export {createRemoteReadonlyMcpHost,remoteMcpDirectoryDigest,remoteMcpArgumentsDigest} from './remote.js';
export type {RemoteReadonlyMcpOptions,RemoteMcpRunQuery,RemoteMcpRunReceipt} from './remote.js';
export {createBoundRemoteReadonlyMcpHost} from './bound-remote.js';
export type {RemoteMcpConfigurationBinding,BoundRemoteReadonlyMcpOptions} from './bound-remote.js';
export type {PublicReferenceExportQuery, PublicReferenceReadQuery, PublicReferenceExportPreflight, PublicReferenceContentQuery, PublicReferenceTextProjection, PublicReferenceExportAuthorization, PublicReferenceExportOptions} from './public-export.js';
export {createWorkspaceReferenceExport} from './workspace-export.js';
export type {WorkspaceReferenceExportOptions} from './workspace-export.js';

export const MCP_READ_TOOL_NAME = 'mcp.workspace.read_text';
export const MCP_READ_TOOL_VERSION = '1.0.0';
export const MCP_READ_SCOPE = 'mcp:workspace:read';
export const MCP_FILESYSTEM_PACKAGE_VERSION = '2026.8.31';
const MAX_BYTES = 256 * 1024;
const require = createRequire(import.meta.url);
const inputSchema = {type:'object', properties:{path:{type:'string', minLength:1, maxLength:1024}}, required:['path'], additionalProperties:false};
export const MCP_READ_RESULT_SCHEMA = {type:'object', properties:{path:{type:'string'}, text:{type:'string'}, contentDigest:{type:'string',pattern:'^[a-f0-9]{64}$'}, source:{const:'mcp'}, serverVersion:{const:MCP_FILESYSTEM_PACKAGE_VERSION}}, required:['path','text','contentDigest','source','serverVersion'], additionalProperties:false};
const blocked = /^(?:\.env(?:\..*)?|\.git|\.codex|\.agents|\.ssh|\.aws|\.azure|\.kube|\.npmrc|credentials(?:\..*)?|secrets?(?:\..*)?|id_(?:rsa|ed25519|ecdsa))$/i;
const privateKey = /-----BEGIN (?:[A-Z ]+ )?PRIVATE KEY(?: BLOCK)?-----/;
function fail(code: string, message: string): never {throw new ProtocolError(code,message);}
const digest = (value: string) => createHash('sha256').update(value).digest('hex');
const canonical = (value: unknown): string => value !== null && typeof value === 'object'
  ? Array.isArray(value) ? `[${value.map(canonical).join(',')}]` : `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical((value as Record<string,unknown>)[key])}`).join(',')}}`
  : JSON.stringify(value);
const inside = (root: string, target: string) => {const part=relative(root,target); return part !== '' && part !== '..' && !part.startsWith(`..${sep}`) && !isAbsolute(part);};

export interface ReadonlyMcpOptions {
  /** Trusted host configuration only. Missing configuration is unavailable. */
  nodeExecutable: string;
  rootPath: string;
  enabled?: boolean;
}
export interface McpHealth {
  configured: boolean;
  enabled: boolean;
  connected: boolean;
  state: 'unavailable'|'disabled'|'disconnected'|'connecting'|'connected'|'error'|'disposed';
  errorCode?: string;
  discoveredTools: number;
  protocolVersion?: string;
  exposedTools: readonly string[];
}
export interface McpReadResult {path:string; text:string; contentDigest:string; source:'mcp'; serverVersion:typeof MCP_FILESYSTEM_PACKAGE_VERSION}
class NegotiatedStdioTransport extends StdioClientTransport {
  protocolVersion:string|undefined;
  setProtocolVersion(version:string){this.protocolVersion=version;}
}

/** One pinned trusted filesystem service; annotations never decide permissions. */
export function createReadonlyMcpHost(options?: ReadonlyMcpOptions) {
  options=options ? {...options} : undefined;
  let enabled=options?.enabled ?? false;
  let disposed=false;
  let state:McpHealth['state']=options ? enabled ? 'disconnected' : 'disabled' : 'unavailable';
  let errorCode:string|undefined;
  let client:Client|undefined;
  let transport:NegotiatedStdioTransport|undefined;
  let generation=0;
  let discoveredTools=0;
  let remoteSchema:object|undefined;
  let approvedRoot:string|undefined;
  let sessionAbort=new AbortController();
  let starting:Promise<void>|undefined;
  const registrations=new Set<() => void>();
  // Session-local binding complements Runtime's persistent run/execution record.
  const runs=new Map<string,{binding:string; result?:McpReadResult; unknown:boolean}>();
  const health=():McpHealth => ({configured:!!options,enabled,connected:state==='connected',state,
    ...(errorCode ? {errorCode} : {}),...(transport?.protocolVersion ? {protocolVersion:transport.protocolVersion} : {}),discoveredTools,exposedTools:state==='connected'?[MCP_READ_TOOL_NAME]:[]});
  function check(signal:AbortSignal, deadline:string) {
    if(signal.aborted) fail('CANCELLED','MCP request was cancelled');
    if(!Number.isFinite(Date.parse(deadline)) || Date.parse(deadline)<=Date.now()) fail('TIMEOUT','MCP request deadline expired');
  }
  function ready() {
    if(disposed || !enabled || state!=='connected' || !client || !options || !remoteSchema) fail('UNSUPPORTED_CAPABILITY','MCP read service is unavailable');
    return client!;
  }
  async function stop() {
    generation++;
    sessionAbort.abort();
    const previous=client; const previousTransport=transport;
    client=undefined; transport=undefined; remoteSchema=undefined; approvedRoot=undefined;
    state=disposed?'disposed':!options?'unavailable':enabled?'disconnected':'disabled';
    // This fixed reference service has no child workers. Kill the active tree on
    // Windows before SDK close loses the owned child identity; never use shell.
    const pid=previousTransport?.pid;
    if(process.platform==='win32' && pid) {
      await new Promise<void>(done => execFile(resolve(process.env.SystemRoot ?? 'C:/Windows','System32/taskkill.exe'),['/PID',String(pid),'/T','/F'],{windowsHide:true,timeout:3000},()=>done()));
    }
    try {await previous?.close();} catch {/* Sanitized status only. */}
  }
  async function connect(input:{signal:AbortSignal;deadline:string}) {
    check(input.signal,input.deadline);
    if(disposed || !options || !enabled) fail('UNSUPPORTED_CAPABILITY','MCP read service is disabled or unconfigured');
    const epoch=++generation;
    state='connecting'; errorCode=undefined; sessionAbort=new AbortController();
    try {
      const root=realpathSync(options!.rootPath);
      if(!statSync(root).isDirectory() || !isAbsolute(options!.nodeExecutable)) fail('INVALID_ARGUMENT','Invalid trusted MCP configuration');
      const entry=require.resolve('@modelcontextprotocol/server-filesystem/dist/index.js');
      const packageFile=resolve(entry,'../../package.json');
      const metadata=require(packageFile) as {version:string};
      if(metadata.version!==MCP_FILESYSTEM_PACKAGE_VERSION) fail('PROTOCOL_MISMATCH','MCP service package version mismatch');
      const environment=Object.fromEntries(DEFAULT_INHERITED_ENV_VARS.map(key=>[key,'']));
      // Absolute node executable and arguments need no inherited PATH/user state.
      if(process.platform==='win32') environment.SYSTEMROOT=process.env.SystemRoot ?? 'C:/Windows';
      const nextTransport=new NegotiatedStdioTransport({command:realpathSync(options!.nodeExecutable),args:[entry,root],cwd:root,env:environment,stderr:'pipe',maxBufferSize:1024*1024});
      // Consume and discard protocol diagnostics; no server stderr reaches UI/logs.
      nextTransport.stderr?.on('data',()=>{});
      const next=new Client({name:'personal-agent-readonly-host',version:'1.0.0'},{capabilities:{}});
      client=next; transport=nextTransport;
      next.onclose=()=> {if(epoch===generation){state='error';errorCode='EXTERNAL_FAILURE';sessionAbort.abort();remoteSchema=undefined;}};
      next.onerror=()=> {if(epoch===generation){state='error';errorCode='EXTERNAL_FAILURE';sessionAbort.abort();remoteSchema=undefined;}};
      const signal=AbortSignal.any([input.signal,sessionAbort.signal]);
      await next.connect(nextTransport,{signal,timeout:Math.min(Date.parse(input.deadline)-Date.now(),30000)});
      if(next.getServerVersion()?.name!=='secure-filesystem-server' || next.getServerVersion()?.version!=='0.2.0') fail('PROTOCOL_MISMATCH','MCP service identity is incompatible');
      if(!next.getServerCapabilities()?.tools) fail('PROTOCOL_MISMATCH','MCP server has no tools capability');
      const listed=await next.listTools(undefined,{signal,timeout:Math.max(1,Date.parse(input.deadline)-Date.now())});
      if(listed.nextCursor) fail('PROTOCOL_MISMATCH','Unexpected paginated fixed service directory');
      discoveredTools=listed.tools.length;
      const read=listed.tools.filter(tool=>tool.name==='read_text_file');
      if(read.length!==1) fail('PROTOCOL_MISMATCH','Required MCP read tool was not uniquely discovered');
      const schema=read[0]!.inputSchema;
      validateToolValue(schema,{path:resolve(root,'reference.md')});
      // Reject schema drift rather than silently dropping required fields.
      if(schema.type!=='object' || !schema.properties?.path || (schema.required ?? []).some(key=>key!=='path')) fail('PROTOCOL_MISMATCH','Unsupported MCP read input schema');
      check(signal,input.deadline);
      if(epoch!==generation) fail('CANCELLED','MCP startup was superseded');
      remoteSchema=structuredClone(schema); approvedRoot=root; state='connected';
    } catch(error) {
      const code=error instanceof ProtocolError ? error.code : input.signal.aborted ? 'CANCELLED' : Date.parse(input.deadline)<=Date.now() ? 'TIMEOUT' : 'EXTERNAL_FAILURE';
      if(epoch===generation){await stop(); state=enabled&&!disposed?'error':state;errorCode=code;}
      throw new ProtocolError(code,'MCP connection could not be established');
    }
  }
  async function start(input:{signal:AbortSignal;deadline:string}) {
    if(state==='connected'){check(input.signal,input.deadline);return;}
    if(starting) fail('REVISION_CONFLICT','MCP startup is already in progress');
    starting=(async()=>{if(client || transport) await stop();await connect(input);})();
    try {await starting;} finally {starting=undefined;}
  }
  async function execute(input:unknown,context:ToolContext):Promise<McpReadResult> {
    validateToolValue(inputSchema,input); check(context.signal,context.deadline);
    const active=ready(); const epoch=generation;const activeSessionSignal=sessionAbort.signal;
    if(!context.scopes.includes(MCP_READ_SCOPE)) fail('UNAUTHORIZED','MCP read scope is missing');
    const path=(input as {path:string}).path;
    if(isAbsolute(path) || path.includes('\\') || path.includes(':') || path.split('/').some(part=>!part || part==='.' || part==='..' || blocked.test(part)) || !/\.(?:txt|md)$/i.test(path)) fail('INVALID_ARGUMENT','MCP path is outside the approved text surface');
    const root=approvedRoot!;
    if(await realpath(options!.rootPath)!==root) fail('REVISION_CONFLICT','MCP approved root changed');
    const target=resolve(root,path);
    if(!inside(root,target)) fail('INVALID_ARGUMENT','MCP path is outside the approved root');
    let cursor=root;
    for(const part of path.split('/')) {cursor=resolve(cursor,part);if((await lstat(cursor)).isSymbolicLink()) fail('INVALID_ARGUMENT','MCP symbolic paths are not supported');}
    const actual=await realpath(target);
    const before=await stat(actual);
    if(!inside(root,actual) || !before.isFile() || before.size>MAX_BYTES) fail('INVALID_ARGUMENT','MCP source is not an approved bounded file');
    const args={path:actual}; validateToolValue(remoteSchema!,args);
    const binding=canonical({taskId:context.taskId,input,version:MCP_READ_TOOL_VERSION});
    const key=canonical([context.taskId,context.runId]); const saved=runs.get(key);
    if(saved) {
      if(saved.binding!==binding) fail('REVISION_CONFLICT','MCP run identifier is bound to different input');
      if(saved.result) return structuredClone(saved.result);
      fail('RESULT_UNKNOWN','MCP request has no confirmed result; reconcile before retrying');
    }
    const run={binding,unknown:true} as {binding:string;result?:McpReadResult;unknown:boolean}; runs.set(key,run);
    const signal=AbortSignal.any([context.signal,activeSessionSignal]);
    try {
      check(signal,context.deadline);if(epoch!==generation) fail('CANCELLED','MCP session was stopped');
      const result=CallToolResultSchema.parse(await active.callTool({name:'read_text_file',arguments:args},CallToolResultSchema,{signal,timeout:Math.max(1,Date.parse(context.deadline)-Date.now())}));
      check(signal,context.deadline); if(epoch!==generation) fail('CANCELLED','MCP session was stopped');
      if(result.isError || result.content.length!==1 || result.content[0]?.type!=='text') fail('EXTERNAL_FAILURE','MCP did not return one text result');
      const text=result.content[0].text;
      const after=await stat(target);
      if(await realpath(target)!==actual || after.ino!==before.ino || after.size!==before.size || after.mtimeMs!==before.mtimeMs || Buffer.byteLength(text)>MAX_BYTES || privateKey.test(text) || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f\ufffd]/.test(text)) fail('EXTERNAL_FAILURE','MCP source changed or returned unsupported text');
      ready(); check(signal,context.deadline);
      const output:McpReadResult={path,text,contentDigest:digest(text),source:'mcp',serverVersion:MCP_FILESYSTEM_PACKAGE_VERSION};
      run.result=output;run.unknown=false; return structuredClone(output);
    } catch(error) {
      const code=error instanceof ProtocolError ? error.code : signal.aborted ? 'CANCELLED' : Date.parse(context.deadline)<=Date.now() ? 'TIMEOUT' : 'EXTERNAL_FAILURE';
      throw new ProtocolError(code,'MCP read request did not return a confirmed result');
    }
  }
  const tool:RegisteredTool={descriptor:{name:MCP_READ_TOOL_NAME,version:MCP_READ_TOOL_VERSION,inputSchema,outputSchema:MCP_READ_RESULT_SCHEMA,sideEffect:'read',requiredScopes:[MCP_READ_SCOPE],idempotencySupport:true,recoverySupport:false,requiresPresence:false},execute:async(input,context)=>{
    try {return await execute(input,context);}
    catch(error) {throw new ProtocolError(error instanceof ProtocolError?error.code:'EXTERNAL_FAILURE','MCP read request was rejected or did not return a confirmed result');}
  }};
  return {
    tools:[tool] as readonly RegisteredTool[],health,start,stop,
    async setEnabled(value:boolean){if(disposed) fail('UNSUPPORTED_CAPABILITY','MCP host is disposed');if(enabled===value)return health();enabled=value;if(!value) await stop();else state=options?'disconnected':'unavailable';return health();},
    register(host:ToolHost){const release=host.register(tool);registrations.add(release);return ()=>{registrations.delete(release);release();};},
    async dispose(){if(disposed)return;disposed=true;enabled=false;for(const release of registrations)release();registrations.clear();await stop();runs.clear();},
  };
}

import {randomUUID} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';

const PURPOSES=new Map([['workspace.read_text','coding-reference'],['coding.repair.read','coding-reference'],['mcp.workspace.read_text','reference-summary']]);
const key=query=>JSON.stringify([query.taskId,query.proposalId,query.path,query.configurationRef]);
const sha=value=>typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);

/** Native PUBLIC permission only. The original Gateway remains the execution and Evidence source. */
export function createNativePublicReferenceConsent({readPreflightCandidate,readConfirmedCandidate,
  isTaskCurrent,isCatalogCurrent=()=>false,confirmNative,now=Date.now}) {
  const permissions=new Map(),catalogs=new Map();let closed=false;
  function candidate(query,confirmed=false) {
    if (closed || !query || !isTaskCurrent(query.taskId)) return undefined;
    const reference={taskId:query.taskId,proposalId:query.proposalId,path:query.path,configurationRef:query.configurationRef};
    const value=(confirmed ? readConfirmedCandidate : readPreflightCandidate)(reference);
    if (!value || !isDeepStrictEqual(value.query,reference)
      || !PURPOSES.has(value.toolName) || value.toolVersion !== '1.0.0'
      || !value.arguments || value.arguments.path !== query.path
      || !Number.isFinite(Date.parse(value.deadline)) || Date.parse(value.deadline) <= now()
      || query.arguments !== undefined && !isDeepStrictEqual(query.arguments,value.arguments)) return undefined;
    if (confirmed && (!sha(value.contentDigest) || !Number.isSafeInteger(value.byteLength)
      || value.byteLength < 0 || typeof value.runId !== 'string' || !value.runId)) return undefined;
    return structuredClone(value);
  }
  function current(query,confirmed=false) {
    const value=candidate(query,confirmed),saved=permissions.get(key(query));
    if (!value || !saved || saved.scope.expiresAt !== value.deadline
      || saved.scope.purpose !== PURPOSES.get(value.toolName)
      || !isDeepStrictEqual(saved.arguments,value.arguments) || saved.toolName !== value.toolName
      || saved.toolVersion !== value.toolVersion) return undefined;
    return {value,saved};
  }
  function contextCurrent(context) {
    if (!(context?.signal instanceof AbortSignal) || context.signal.aborted
      || !Number.isFinite(Date.parse(context.deadline)) || Date.parse(context.deadline) <= now()) throw Error('公开资料许可请求已停止或到期');
  }
  return {
    async requestCatalog(input,kind,publicParameters) {
      contextCurrent(input);
      if (closed || !['mcp','skill'].includes(kind) || !isTaskCurrent(input.taskId) || !isCatalogCurrent(input)) return false;
      const id=JSON.stringify([input.taskId,input.configurationRef,kind]),previous=catalogs.get(id);
      if (previous && previous.expiresAt === input.deadline) return previous.allowed;
      const allowed=await confirmNative({phase:'catalog',query:{taskId:input.taskId,configurationRef:input.configurationRef},
        catalogKind:kind,publicParameters,expiresAt:input.deadline},input);
      contextCurrent(input);
      if (closed || !isTaskCurrent(input.taskId) || !isCatalogCurrent(input)) return false;
      catalogs.set(id,{allowed:allowed === true,expiresAt:input.deadline});return allowed === true;
    },
    async requestPreflight(query,context) {
      contextCurrent(context);
      const value=candidate(query);
      if (!value) throw Error('原公开读取提案不可用');
      const saved=current(query);
      if (saved) return {...saved.saved.scope};
      const maxExportBytes=value.arguments.maxBytes ?? 262144;
      if (!Number.isSafeInteger(maxExportBytes) || maxExportBytes < 1 || maxExportBytes > 262144) throw Error('公开内容范围无效');
      const scope={authorizationId:randomUUID(),expiresAt:value.deadline,sensitivity:'PUBLIC',
        purpose:PURPOSES.get(value.toolName),maxExportBytes};
      const accepted=await confirmNative({phase:'preflight',query:value.query,toolName:value.toolName,
        purpose:scope.purpose,maxExportBytes,expiresAt:scope.expiresAt},context);
      contextCurrent(context);
      if (accepted !== true || !isTaskCurrent(query.taskId) || !isDeepStrictEqual(value,candidate(query))) {
        throw Error('公开来源预许可未确认或原提案已改变');
      }
      // A changed existing permission cannot be silently replaced by a second dialog.
      if (permissions.has(key(query))) throw Error('原公开资料许可已改变');
      permissions.set(key(query),{scope,arguments:value.arguments,toolName:value.toolName,toolVersion:value.toolVersion});
      return {...scope};
    },
    async requestExact(query,context) {
      contextCurrent(context);
      const bound=current(query,true);
      if (!bound || bound.value.byteLength > bound.saved.scope.maxExportBytes) throw Error('原已确认读取超出公开范围或不可用');
      const {value,saved}=bound;
      if (saved.contentDigest) {
        if (saved.contentDigest !== value.contentDigest || saved.byteLength !== value.byteLength || saved.runId !== value.runId) {
          throw Error('原公开内容许可不匹配');
        }
        return {...saved.scope,contentDigest:saved.contentDigest};
      }
      const accepted=await confirmNative({phase:'confirmed',query:value.query,toolName:value.toolName,
        purpose:saved.scope.purpose,contentDigest:value.contentDigest,byteLength:value.byteLength,
        maxExportBytes:saved.scope.maxExportBytes,expiresAt:saved.scope.expiresAt},context);
      contextCurrent(context);
      const fresh=current(query,true);
      if (accepted !== true || !fresh || fresh.saved !== saved || !isDeepStrictEqual(value,fresh.value)) {
        throw Error('精确公开内容许可未确认或原执行已改变');
      }
      saved.contentDigest=value.contentDigest;saved.byteLength=value.byteLength;saved.runId=value.runId;
      return {...saved.scope,contentDigest:saved.contentDigest};
    },
    readPreflight(query) {
      const bound=current(query);
      return bound ? {...bound.saved.scope} : undefined;
    },
    readAuthorization(query) {
      const bound=current(query,true);
      if (!bound || !bound.saved.contentDigest || query.contentDigest !== bound.saved.contentDigest
        || query.byteLength !== bound.saved.byteLength || bound.value.contentDigest !== bound.saved.contentDigest
        || bound.value.byteLength !== bound.saved.byteLength || bound.value.runId !== bound.saved.runId) return undefined;
      return {...bound.saved.scope,contentDigest:bound.saved.contentDigest};
    },
    revokeTask(taskId) {for (const [id,value] of permissions) if (JSON.parse(id)[0] === taskId) permissions.delete(id);},
    close() {closed=true;permissions.clear();catalogs.clear();},
  };
}

import {createHash} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';

const digest=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const readRequirement='public-reference-read',exportRequirement='public-reference-export';
// Exact existing public descriptor. Private roots, account metadata and dynamic enum paths cannot match.
const publicMcp={name:'mcp.workspace.read_text',version:'1.0.0',
  inputSchema:{type:'object',properties:{path:{type:'string',minLength:1,maxLength:1024}},required:['path'],additionalProperties:false},
  outputSchema:{type:'object',properties:{path:{type:'string'},text:{type:'string'},contentDigest:{type:'string',pattern:'^[a-f0-9]{64}$'},
    source:{const:'mcp'},serverVersion:{const:'2026.8.31'}},required:['path','text','contentDigest','source','serverVersion'],additionalProperties:false},
  sideEffect:'read',requiredScopes:['mcp:workspace:read'],idempotencySupport:true,recoverySupport:false,requiresPresence:false};

/** Register PUBLIC read+bounded export on the original run, consume the same card after the exact native receipt. */
export function createPublicReferenceQuestionConsent({question,confirmApplicationAuthorization,readMcpDescriptor,readSkillManifest,
  readOriginalScope=()=>undefined,bindOriginalReference=()=>false,isCurrent=()=>false,now=Date.now}) {
  return async (request,context)=>{
    const current=()=>isCurrent()&&!context.signal?.aborted&&Date.parse(context.deadline)>now()
      &&request.expiresAt===context.deadline;
    if(!current())return false;
    if(request.phase==='catalog') {
      if(request.catalogKind==='mcp'&&request.publicParameters===undefined&&isDeepStrictEqual(readMcpDescriptor(),publicMcp))return true;
      if(request.catalogKind==='skill') {
        const manifest=readSkillManifest();
        if(manifest?.id==='workspace-reference-summary'&&manifest.version==='1.0.0'
          &&/^[a-f0-9]{64}$/u.test(manifest.digest)
          &&isDeepStrictEqual(request.publicParameters,{skillId:manifest.id,version:manifest.version,digest:manifest.digest}))return true;
      }
      return confirmApplicationAuthorization('reference.catalog',request,{scope:{taskId:request.query.taskId,
        configurationRef:request.query.configurationRef,catalogKind:request.catalogKind},
        summary:'向本任务模型公布当前参考能力目录；仅此原任务、版本与配置，不授权文件读取或正文出机。',
        deadline:context.deadline,signal:context.signal,isCurrent:current});
    }
    const coding=request.toolName==='coding.repair.read';
    const authority=coding?context.authorization:undefined;
    if(coding&&(!authority||authority.taskId!==request.readTaskId||authority.runId!==request.readRunId))return false;
    if(request.phase==='preflight'&&context.proposal?.toolName==='skill.workspace_reference_summary'
      &&bindOriginalReference(request)!==true)return false;
    const original=readOriginalScope(authority?.taskId??request.query.taskId,authority?.runId??context.runId,coding);
    if(!['preflight','confirmed'].includes(request.phase)||!original||!original.runId
      ||(!coding&&(original.taskId!==request.query.taskId||original.proposalId!==request.query.proposalId))||original.deadline!==context.deadline
      ||!['workspace.read_text','mcp.workspace.read_text','skill.workspace_reference_summary','coding.repair.read'].includes(original.toolName)
      ||original.toolName!==request.toolName
      ||original.arguments?.path!==request.query.path
      ||!Number.isSafeInteger(request.maxExportBytes)||request.maxExportBytes<1||request.maxExportBytes>262144)return false;
    const scope={...original,signal:context.signal};
    const invocationCurrent=()=>current()&&isDeepStrictEqual(original,readOriginalScope(original.taskId,original.runId,coding));
    if(coding) {
      // The trusted workspace port proved the worker -> local-task operation and exact original receipt.
      // A completed read cannot receive another execution grant or a newly added requirement.
      if(original.taskId!==authority.taskId||original.runId!==authority.runId||original.toolName!=='coding.repair.read'
        ||original.arguments?.path!==request.query.path||!invocationCurrent())return false;
      question.assertConsumedResult(scope,'tool');
      if(request.phase==='confirmed') {
        if(context.result===undefined||!/^[a-f0-9]{64}$/u.test(request.contentDigest)
          ||!Number.isSafeInteger(request.byteLength)||request.byteLength<0||request.byteLength>request.maxExportBytes)return false;
        question.authorizeConsumedExport(scope,context.result,exportRequirement);
      }
      return invocationCurrent();
    }
    const bindingDigest=digest({query:request.query,toolName:request.toolName,purpose:request.purpose,
      maxExportBytes:request.maxExportBytes,expiresAt:request.expiresAt});
    if(request.phase==='preflight') {
      question.prepare(scope,{requirements:[{requirementId:readRequirement,kind:'tool',scopes:['public-reference:read'],bindingDigest,
        summary:`读取明确标记PUBLIC的原参考来源 ${request.query.path}，最多${request.maxExportBytes}字节；仅本提案。`.slice(0,512)}],assertCurrent:invocationCurrent});
      question.prepareExport(scope,{requirementId:exportRequirement,bindingDigest,
        summary:`向本任务选定模型发送该PUBLIC参考的有界结果，源上限${request.maxExportBytes}字节；仍核对原实际内容摘要。`,assertCurrent:invocationCurrent});
      // Preparation is not a grant. Runtime subsequently waits for the original question before tool execution.
      return invocationCurrent();
    }
    if(!/^[a-f0-9]{64}$/u.test(request.contentDigest)||!Number.isSafeInteger(request.byteLength)
      ||request.byteLength<0||request.byteLength>request.maxExportBytes)return false;
    question.currentRequirement(scope,readRequirement);
    question.currentRequirement(scope,exportRequirement);
    // The existing consent adapter rechecks candidate/run/version/digest/byte identity and derives the exact lease.
    return invocationCurrent();
  };
}

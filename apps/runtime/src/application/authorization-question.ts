import {createHash,randomUUID} from 'node:crypto';
import {ProtocolError} from '@personal-agent/contracts';
import type {TrustedHostStateStore} from '../host-state-store.js';

export type AuthorizationDecision='allow_once'|'allow_task'|'allow_always'|'deny';
export type AuthorizationQuestionState='pending'|'allowed'|'denied'|'expired'|'cancelled'|'stale';
export interface AuthorizationRequirement {
  requirementId:string;kind:'tool'|'export'|'connector_session';scopes:string[];bindingDigest:string;summary:string;
  /** Trusted resource/configuration/projection rule, never supplied by a model or Renderer. */
  ruleBindingDigest?:string;
  /** Optional narrower task scope, supplied only by the trusted host (for example an exact external write). */
  taskBindingDigest?:string;
}
export interface AuthorizationQuestionRequest {
  taskId:string;proposalId:string;runId:string;toolName:string;toolVersion:string;argumentsDigest:string;
  deadline:string;signal:AbortSignal;requirements:AuthorizationRequirement[];
  sideEffect?:'read'|'local_write'|'external_write';
  /** Trusted workflow grouping, never accepted from Renderer or a model proposal. */
  taskConsent?:{taskId:string;bindingDigest:string;summary:string;mode:'read-only'|'workspace-write';requiresNative?:boolean};
  /** Complete trusted-host projection of dangerous content. Each operation needs an explicit decision. */
  contentConfirmation?:{digest:string;text:string};
  /** Host opt-in. Forces a confirmation card even under full-access, while still allowing permanent allow_always whitelisting. */
  forceAsk?:boolean;
  /** Host-only marker for reversible local UI configuration actions explicitly initiated by the user. */
  trustedLocalConfig?:boolean;
}
export interface AuthorizationSandbox {
  ref:string;label:string;mode:'read-only'|'workspace-write'|'full-access';revision:number;available:boolean;reason?:string;
  /** Host opt-in. Read-like tool scopes may be allowed once; writes, sends and external processes still ask. */
  lowRiskAuto?:boolean;
  /** Host opt-in. Workspace/local reversible writes may be allowed once under workspace-write mode. */
  localWriteAuto?:boolean;
  /** Host opt-in. Skip contentConfirmation cards in full-access when credential/secret checks pass. */
  fullAccessAutoContent?:boolean;
  kind?:'application_policy';native?:AuthorizationNativeExecution;
}
export interface AuthorizationNativeExecution {required:boolean;available:boolean;backend:'windows-psec'|'none'|'unavailable';enforced:boolean;
  reason?:string;bindingDigest?:string;}
export interface AuthorizationQuestionReceipt {
  questionId:string;revision:number;decision:AuthorizationDecision;receiptRef:string;
}
interface Question {
  questionId:string;revision:number;state:AuthorizationQuestionState;taskId:string;conversationId:string;
  proposalId:string;runId:string;toolName:string;toolVersion:string;argumentsDigest:string;deadline:string;expiresAt:string;
  sideEffect?:'read'|'local_write'|'external_write';
  requirements:AuthorizationRequirement[];sandbox:AuthorizationSandbox;ownerBinding:string;
  baseSandboxRef?:string;
  decision?:AuthorizationDecision;receiptRef?:string;reason?:string;consumed:Record<string,string>;
  derivedFrom?:string;
  taskConsentFrom?:string;
  /** A fresh exact receipt from the user's selected policy, not a UI question. */
  automatic?:'full-access'|'low-risk'|'local-write';
  taskConsent?:AuthorizationQuestionRequest['taskConsent'];
  contentConfirmation?:AuthorizationQuestionRequest['contentConfirmation'];
  forceAsk?:boolean;
  trustedLocalConfig?:boolean;
}
interface Rule {ruleId:string;revision:number;active:boolean;revoked?:boolean;toolName:string;toolVersion:string;
  sandboxRef:string;sandboxRevision:number;sandboxLabel:string;profileDigest?:string;baseSandboxRef?:string;baseProfileDigest?:string;
  requirements:AuthorizationRequirement[];summary:string;}
interface State {version:1;selectedRef:string;revision:number;questions:Question[];rules:Rule[];profileChosen?:boolean;}
export interface AuthorizationQuestionsOptions {
  store:TrustedHostStateStore;
  profiles:readonly AuthorizationSandbox[];
  defaultProfileRef:string;
  /** Reads original task/proposal/owner/config identities. waiting_approval is legitimate here. */
  readBinding(request:Omit<AuthorizationQuestionRequest,'signal'>):{conversationId:string;digest:string}|undefined;
  readReceiptBinding?:(request:Omit<AuthorizationQuestionRequest,'signal'>)=>{conversationId:string;digest:string}|undefined;
  /** Interactive modes require UI. Explicit full access supplies its own decision. */
  available():boolean;
  /** Opt-in for desktop host: keep manual questions pending even when panel is closed instead of failing early. */
  deferWhenUnavailable?:boolean;
  /** Real side effects require the original Runtime execution state in addition to the decision. */
  canExecute(request:Omit<AuthorizationQuestionRequest,'signal'>):boolean;
  resolveProfile?:(request:Omit<AuthorizationQuestionRequest,'signal'>,selected:AuthorizationSandbox)=>string;
  describeExecution?:(request:Omit<AuthorizationQuestionRequest,'signal'>|undefined,profile:AuthorizationSandbox)=>AuthorizationNativeExecution;
  canAutoApprove?:(kind:'low-risk'|'local-write',request:Omit<AuthorizationQuestionRequest,'signal'>,profile:AuthorizationSandbox)=>boolean;
  onInvalidated?:(binding:{taskId:string;runId:string},state:'expired'|'cancelled'|'stale')=>void;
  onPending?:(question:{questionId:string;taskId:string;runId:string;conversationId:string})=>void;
  now?:()=>number;onChange?:()=>void;
}
const canonical=(value:unknown):unknown=>Array.isArray(value)?value.map(canonical):value&&typeof value==='object'
  ?Object.fromEntries(Object.entries(value).filter(([,item])=>item!==undefined).sort(([a],[b])=>a.localeCompare(b)).map(([key,item])=>[key,canonical(item)])):value;
const digest=(value:unknown)=>createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
const hash=(value:unknown):value is string=>typeof value==='string'&&/^[a-f0-9]{64}$/u.test(value);
const text=(value:unknown):value is string=>typeof value==='string'&&value.length>0&&value.length<=512&&!/[\x00-\x1f]/u.test(value);
const fail:(message:string)=>never=message=>{throw new ProtocolError('UNAUTHORIZED',message);};
const requirementRule=(requirement:AuthorizationRequirement)=>({requirementId:requirement.requirementId,
  kind:requirement.kind,scopes:[...requirement.scopes].sort(),ruleBindingDigest:requirement.ruleBindingDigest});
const reusable=(requirements:AuthorizationRequirement[])=>requirements.every(item=>hash(item.ruleBindingDigest));
const taskRule=(requirements:AuthorizationRequirement[])=>digest(requirements.map(item=>({...requirementRule(item),
  ruleBindingDigest:item.taskBindingDigest??item.ruleBindingDigest})).sort((a,b)=>a.requirementId.localeCompare(b.requirementId)));
const canReuse=(question:Pick<Question,'requirements'|'taskConsent'|'contentConfirmation'|'forceAsk'>)=>!question.contentConfirmation
  &&!question.forceAsk&&(Boolean(question.taskConsent)||reusable(question.requirements));
const consentNative=(native:AuthorizationNativeExecution|undefined)=>native?.required?native:{required:false};
const profileDefinitionDigest=(profile:Pick<AuthorizationSandbox,'ref'|'mode'|'lowRiskAuto'|'localWriteAuto'|'fullAccessAutoContent'>)=>digest({
  ref:profile.ref,
  mode:profile.mode,
  lowRiskAuto:profile.lowRiskAuto===true,
  localWriteAuto:profile.localWriteAuto===true,
  fullAccessAutoContent:profile.fullAccessAutoContent===true,
});
const resolveRuleStatus=(rule:Rule,selected:AuthorizationSandbox,profiles:readonly AuthorizationSandbox[]):'active'|'inactive_profile'|'revoked'=>{
  if(rule.revoked===true)return 'revoked';
  if(!rule.profileDigest)return rule.active===true&&rule.sandboxRevision===selected.revision?'active':'revoked';
  const targetProfile=profiles.find(item=>item.ref===rule.sandboxRef);
  if(!targetProfile||profileDefinitionDigest(targetProfile)!==rule.profileDigest)return 'revoked';
  const expectedBaseRef=rule.baseSandboxRef??rule.sandboxRef;
  const expectedBaseDigest=rule.baseProfileDigest??rule.profileDigest;
  if(selected.ref===expectedBaseRef&&profileDefinitionDigest(selected)===expectedBaseDigest)return 'active';
  return 'inactive_profile';
};
const isRuleEffectiveForProfile=(rule:Rule,resolvedProfile:AuthorizationSandbox,selectedProfile:AuthorizationSandbox):boolean=>{
  if(rule.revoked===true)return false;
  if(rule.sandboxRef!==resolvedProfile.ref)return false;
  if(!rule.profileDigest)return rule.active===true&&rule.sandboxRevision===resolvedProfile.revision;
  if(rule.profileDigest!==profileDefinitionDigest(resolvedProfile))return false;
  if(rule.baseSandboxRef){
    if(selectedProfile.ref!==rule.baseSandboxRef)return false;
    if(rule.baseProfileDigest&&rule.baseProfileDigest!==profileDefinitionDigest(selectedProfile))return false;
  }
  return true;
};
const hasSecretForceAsk=(question:Pick<Question,'forceAsk'|'requirements'>)=>question.forceAsk===true
  &&question.requirements.some(item=>/secret|密钥|凭据|口令|令牌/iu.test(item.summary)||item.scopes.some(scope=>/secret/iu.test(scope)));
const ELEVATED_SCOPE = /(?:write|execute|verify|patch|send|create|delete|update|erase|install|enable|uninstall|configure|withdraw|respond)/iu;
const READ_SCOPE = /(?:^|[.:])(?:read|list|search|get|status)$/iu;
const LOCAL_WRITE_SCOPE = /(?:^|[.:])(?:write|patch|create|update)$/iu;
const FORBIDDEN_LOCAL_AUTO_SCOPE = /(?:execute|verify|send|delete|remove|erase|install|uninstall|configure|enable|activate|pair|withdraw|respond|publish|push|merge|pay|transfer|grant|revoke|admin|system)/iu;
const FORBIDDEN_TRUSTED_LOCAL_CONFIG_SCOPE = /(?:erase|delete|withdraw|install|uninstall|export|egress|voice|consume|execute|run|send|publish|push|merge|pay|transfer|grant|revoke)/iu;
function isTrustedLocalConfigRequest(request: Omit<AuthorizationQuestionRequest, 'signal'>): boolean {
  if (request.trustedLocalConfig !== true) return false;
  if (request.toolName !== 'desktop.authorization.intent' || request.sideEffect !== 'read') return false;
  if (request.taskConsent?.requiresNative === true) return false;
  if (!request.requirements?.length) return false;
  return request.requirements.every(req =>
    req.kind === 'tool'
    && req.scopes.length > 0
    && req.scopes.every(scope => !FORBIDDEN_TRUSTED_LOCAL_CONFIG_SCOPE.test(scope))
  );
}
/** Conservative gate. Allows read-only tool/connector scopes and declared model:export; writes, sends and external processes stay pending. */
export function isLowRiskAuthorizationRequest(request: Omit<AuthorizationQuestionRequest,'signal'>): boolean {
  if (isTrustedLocalConfigRequest(request)) return true;
  if (!request?.requirements?.length) return false;
  if (request.sideEffect !== 'read') return false;
  if (request.taskConsent && (request.taskConsent.mode !== 'read-only' || request.taskConsent.requiresNative === true)) return false;
  if (/send|delete|erase|install|execute|withdraw|configure/iu.test(request.toolName)) return false;
  if (!request.requirements.some(requirement => requirement.kind === 'tool')) return false;
  return request.requirements.every(requirement => {
    if (!requirement.scopes.length) return false;
    if (requirement.kind === 'export') return requirement.scopes.every(scope => scope === 'model:export');
    if (requirement.kind === 'tool' || requirement.kind === 'connector_session') {
      return requirement.scopes.every(scope => READ_SCOPE.test(scope) && !ELEVATED_SCOPE.test(scope));
    }
    return false;
  });
}
/** Gate for workspace-write mode. Allows local reversible writes/workspace edits and model:export; external writes/sends/deletes/native commands stay pending. */
export function isLocalWriteAuthorizationRequest(request: Omit<AuthorizationQuestionRequest,'signal'>): boolean {
  if (isTrustedLocalConfigRequest(request)) return true;
  if (!request?.requirements?.length) return false;
  if (request.sideEffect !== 'read' && request.sideEffect !== 'local_write') return false;
  if (request.taskConsent?.requiresNative === true) return false;
  if (/send|publish|delete|remove|erase|pay|transfer|grant|revoke|install|uninstall|push|merge|close|configure|enable|activate|pair/iu.test(request.toolName)) return false;
  if (!request.requirements.some(requirement => requirement.kind === 'tool')) return false;
  return request.requirements.every(requirement => {
    if (!requirement.scopes.length) return false;
    if (requirement.kind === 'export') return requirement.scopes.every(scope => scope === 'model:export');
    if (requirement.kind === 'tool' || requirement.kind === 'connector_session') {
      return requirement.scopes.every(scope => (READ_SCOPE.test(scope) || LOCAL_WRITE_SCOPE.test(scope)) && !FORBIDDEN_LOCAL_AUTO_SCOPE.test(scope));
    }
    return false;
  });
}

const MAX_STORED_QUESTIONS=256;
const MAX_EXPIRED_SETTLED_QUESTIONS=32;

/** Durable user decisions only. Policy grants and exact export leases remain separate consumers. */
export class AuthorizationQuestions {
  private readonly now:()=>number;
  private readonly waiters=new Map<string,{finish:(value:AuthorizationQuestionReceipt)=>void;reject:(error:unknown)=>void;
    signal:AbortSignal;abort:()=>void;timer:ReturnType<typeof setTimeout>}>();
  private readonly liveBindings=new Map<string,()=>boolean>();
  // Task consent is never restored from disk or transferred to another task.
  private readonly taskConsents=new Map<string,AbortSignal>();
  private closed=false;
  constructor(private readonly options:AuthorizationQuestionsOptions) {
    this.now=options.now??Date.now;
    if(!options.profiles.some(profile=>profile.ref===options.defaultProfileRef))throw new ProtocolError('INVALID_ARGUMENT','Unknown default sandbox');
    if(!options.store.compareAndSet)throw new ProtocolError('UNSUPPORTED_CAPABILITY','Atomic authorization state is unavailable');
    const interrupted=this.mutate(state=>{
      const interrupted:Question[]=[];
      // A restarted host cannot prove former in-memory configuration/signal ownership.
      // Keep the original persisted question visible, but require a fresh request to resume it.
      for(const question of state.questions)if(question.state==='pending'){
        question.state=this.now()>=Date.parse(question.expiresAt)?'expired':'stale';question.reason='host_restarted';question.revision++;
        interrupted.push(structuredClone(question));
      }
      return interrupted;
    });
    for(const question of interrupted)this.options.onInvalidated?.(question,question.state as 'expired'|'stale');
  }
  private read():State {
    const saved=this.options.store.get('state');
    if(saved===undefined)return {version:1,selectedRef:this.options.defaultProfileRef,revision:1,questions:[],rules:[]};
    const state=saved as State;
    if(state.version!==1||!Array.isArray(state.questions)||!Array.isArray(state.rules))fail('Authorization state is unavailable');
    return structuredClone(state);
  }
  private readView():State {
    const saved=this.options.store.get('state');
    if(saved===undefined)return {version:1,selectedRef:this.options.defaultProfileRef,revision:1,questions:[],rules:[]};
    const state=saved as State;
    if(state.version!==1||!Array.isArray(state.questions)||!Array.isArray(state.rules))fail('Authorization state is unavailable');
    return state;
  }
  private pruneQuestions(questions:Question[]):Question[] {
    const now=this.now();
    const referenced=new Set<string>();
    const activeSet=new Set<Question>();
    for(const item of questions){
      const deadlineMs=Date.parse(item.deadline),expiresMs=Date.parse(item.expiresAt);
      const unexpired=(Number.isFinite(deadlineMs)&&deadlineMs>now)||(Number.isFinite(expiresMs)&&expiresMs>now);
      if(item.state==='pending'||this.liveBindings.has(item.questionId)||this.taskConsents.has(item.questionId)||unexpired){
        activeSet.add(item);
        if(item.derivedFrom)referenced.add(item.derivedFrom);
        if(item.taskConsentFrom)referenced.add(item.taskConsentFrom);
      }
    }
    const expiredSettled:{index:number;ts:number;item:Question}[]=[];
    for(let index=0;index<questions.length;index++){
      const item=questions[index]!;
      if(activeSet.has(item))continue;
      const expiresMs=Date.parse(item.expiresAt);
      const within24h=Number.isFinite(expiresMs)&&now<expiresMs+86400000;
      if(referenced.has(item.questionId)){
        activeSet.add(item);
      }else if(within24h){
        const deadlineMs=Date.parse(item.deadline);
        const ts=Math.max(Number.isFinite(expiresMs)?expiresMs:0,Number.isFinite(deadlineMs)?deadlineMs:0);
        expiredSettled.push({index,ts,item});
      }
    }
    if(expiredSettled.length>MAX_EXPIRED_SETTLED_QUESTIONS){
      expiredSettled.sort((a,b)=>(b.ts-a.ts)||(b.index-a.index));
      for(let i=0;i<MAX_EXPIRED_SETTLED_QUESTIONS;i++)activeSet.add(expiredSettled[i]!.item);
    }else{
      for(const entry of expiredSettled)activeSet.add(entry.item);
    }
    return questions.filter(item=>activeSet.has(item));
  }
  private mutate<T>(update:(state:State)=>T):T {
    const previous=this.options.store.get('state'),state=this.read();
    const result=update(state);
    if(!this.options.store.compareAndSet!('state',previous,state))throw new ProtocolError('REVISION_CONFLICT','Authorization state changed');
    return result;
  }
  private profile(state=this.readView()):AuthorizationSandbox {
    const profile=this.options.profiles.find(item=>item.ref===state.selectedRef);
    if(!profile)fail('Selected sandbox is unavailable');
    return {...profile!,revision:state.revision};
  }
  private input(question:Question):Omit<AuthorizationQuestionRequest,'signal'> {
    return {taskId:question.taskId,proposalId:question.proposalId,runId:question.runId,toolName:question.toolName,
      toolVersion:question.toolVersion,argumentsDigest:question.argumentsDigest,deadline:question.deadline,
      ...(question.sideEffect!==undefined?{sideEffect:question.sideEffect}:{}),
      requirements:structuredClone(question.requirements),...(question.taskConsent?{taskConsent:structuredClone(question.taskConsent)}:{}),
      ...(question.contentConfirmation?{contentConfirmation:structuredClone(question.contentConfirmation)}:{}),
      ...(question.forceAsk?{forceAsk:true}:{}),
      ...(question.trustedLocalConfig?{trustedLocalConfig:true}:{})};
  }
  private normalize(request:AuthorizationQuestionRequest):Omit<AuthorizationQuestionRequest,'signal'> {
    return {taskId:request.taskId,proposalId:request.proposalId,runId:request.runId,toolName:request.toolName,
      toolVersion:request.toolVersion,argumentsDigest:request.argumentsDigest,deadline:request.deadline,
      ...(request.sideEffect!==undefined?{sideEffect:request.sideEffect}:{}),
      ...(request.taskConsent?{taskConsent:structuredClone(request.taskConsent)}:{}),
      ...(request.contentConfirmation?{contentConfirmation:structuredClone(request.contentConfirmation)}:{}),
      ...(request.forceAsk===true?{forceAsk:true}:{}),
      ...(request.trustedLocalConfig===true?{trustedLocalConfig:true}:{}),
      requirements:request.requirements.map(requirement=>({requirementId:requirement.requirementId,kind:requirement.kind,
        scopes:[...requirement.scopes],bindingDigest:requirement.bindingDigest,summary:requirement.summary,
        ...(requirement.ruleBindingDigest!==undefined?{ruleBindingDigest:requirement.ruleBindingDigest}:{}),
        ...(requirement.taskBindingDigest!==undefined?{taskBindingDigest:requirement.taskBindingDigest}:{})}))};
  }
  private current(question:Question):boolean {
    if(this.closed||this.now()>=Date.parse(question.state==='pending'?question.expiresAt:question.deadline))return false;
    const profile=this.profile();
    if(profile.ref!==(question.baseSandboxRef??question.sandbox.ref)||profile.revision!==question.sandbox.revision||!profile.available)return false;
    if(question.sandbox.native?.required){
      const current=this.options.describeExecution?.(this.input(question),question.sandbox);
      if(!current?.available||current.backend!==question.sandbox.native.backend
        ||current.enforced!==question.sandbox.native.enforced||current.bindingDigest!==question.sandbox.native.bindingDigest)return false;
    }
    const binding=this.options.readBinding(this.input(question));
    return binding?.conversationId===question.conversationId&&binding.digest===question.ownerBinding
      &&this.liveBindings.get(question.questionId)?.()===true;
  }
  private validate(request:AuthorizationQuestionRequest):void {
    if(!request||['taskId','proposalId','runId','toolName','toolVersion'].some(key=>!text(request[key as keyof AuthorizationQuestionRequest]))
      ||request.sideEffect!==undefined&&!['read','local_write','external_write'].includes(request.sideEffect)
      ||request.forceAsk!==undefined&&typeof request.forceAsk!=='boolean'
      ||request.trustedLocalConfig!==undefined&&typeof request.trustedLocalConfig!=='boolean'
      ||!hash(request.argumentsDigest)||!Number.isFinite(Date.parse(request.deadline))||Date.parse(request.deadline)<=this.now()
      ||!request.signal||request.signal.aborted||!Array.isArray(request.requirements)||request.requirements.length<1||request.requirements.length>24)
      throw new ProtocolError('INVALID_ARGUMENT','Invalid authorization question binding');
    const ids=new Set<string>();
    if(request.contentConfirmation&&(!hash(request.contentConfirmation.digest)||typeof request.contentConfirmation.text!=='string'
      ||!request.contentConfirmation.text.length||request.contentConfirmation.text.length>1_000_000
      ||request.contentConfirmation.digest!==digest(request.contentConfirmation.text)))
      throw new ProtocolError('INVALID_ARGUMENT','Invalid trusted content confirmation');
    if(request.taskConsent&&(!text(request.taskConsent.taskId)||!hash(request.taskConsent.bindingDigest)
      ||!text(request.taskConsent.summary)||!['read-only','workspace-write'].includes(request.taskConsent.mode)
      ||request.taskConsent.requiresNative!==undefined&&typeof request.taskConsent.requiresNative!=='boolean'))
      throw new ProtocolError('INVALID_ARGUMENT','Invalid trusted task consent scope');
    for(const requirement of request.requirements){
      if(!text(requirement.requirementId)||ids.has(requirement.requirementId)||!['tool','export','connector_session'].includes(requirement.kind)
        ||!hash(requirement.bindingDigest)||requirement.ruleBindingDigest!==undefined&&!hash(requirement.ruleBindingDigest)
        ||requirement.taskBindingDigest!==undefined&&!hash(requirement.taskBindingDigest)
        ||!text(requirement.summary)||!Array.isArray(requirement.scopes)||requirement.scopes.length>32
        ||requirement.scopes.some(scope=>!text(scope)))throw new ProtocolError('INVALID_ARGUMENT','Invalid authorization requirement');
      ids.add(requirement.requirementId);
    }
  }
  request(request:AuthorizationQuestionRequest,assertCurrent:()=>boolean=()=>true,decisionDeadline=request.deadline):Promise<AuthorizationQuestionReceipt> {
    try {
      this.validate(request);
      if(this.closed)fail('当前对话授权卡不可用，操作未获允许');
      const signal=request.signal,input=this.normalize(request),binding=this.options.readBinding(input),selected=this.profile();
      const profileRef=this.options.resolveProfile?.(input,selected)??selected.ref;
      const resolved=this.options.profiles.find(profile=>profile.ref===profileRef);
      if(!resolved||profileRef!==selected.ref&&resolved.mode==='full-access')fail('不允许自动扩大为完全访问');
      const profile={...resolved,revision:selected.revision,kind:'application_policy' as const,
        native:this.options.describeExecution?.(input,resolved)??{required:false,available:false,backend:'unavailable' as const,enforced:false}};
      if(!binding||!profile.available||!assertCurrent())fail('原任务或权限策略已变化，操作未获允许');
      if(profile.native.required&&(!profile.native.available||profile.native.backend==='windows-psec'&&!profile.native.enforced))
        fail(profile.native.reason??'本次外部进程执行后端不可用');
      if(!Number.isFinite(Date.parse(decisionDeadline))||Date.parse(decisionDeadline)<=this.now())fail('授权决定期限已过');
      const question:Question={questionId:randomUUID(),revision:1,state:'pending',...structuredClone(input),
        expiresAt:new Date(Math.min(Date.parse(request.deadline),Date.parse(decisionDeadline))).toISOString(),
        conversationId:binding.conversationId,sandbox:profile,baseSandboxRef:selected.ref,ownerBinding:binding.digest,consumed:{}};
      if(!question.contentConfirmation&&!question.forceAsk&&selected.mode==='full-access'&&profile.mode==='full-access'){
        question.state='allowed';question.decision='allow_once';question.receiptRef=randomUUID();question.automatic='full-access';
      } else if(!question.contentConfirmation && !question.forceAsk && question.state==='pending' && selected.lowRiskAuto===true && profile.ref===selected.ref
        && profile.native?.required!==true && isLowRiskAuthorizationRequest(input)
        && (this.options.canAutoApprove?.('low-risk',input,profile)??true)){
        question.state='allowed';question.decision='allow_once';question.receiptRef=randomUUID();question.automatic='low-risk';
      } else if(!question.contentConfirmation && !question.forceAsk && question.state==='pending' && selected.localWriteAuto===true
        && selected.mode==='workspace-write' && profile.ref===selected.ref && profile.native?.required!==true
        && isLocalWriteAuthorizationRequest(input)
        && (this.options.canAutoApprove?.('local-write',input,profile)??true)){
        question.state='allowed';question.decision='allow_once';question.receiptRef=randomUUID();question.automatic='local-write';
      }
      this.mutate(state=>{
        state.questions=this.pruneQuestions(state.questions);
        if(state.questions.length>=MAX_STORED_QUESTIONS)fail('授权记录已满，请先处理当前请求');
        const rule=state.rules.find(item=>isRuleEffectiveForProfile(item,profile,selected)
          &&item.toolName===question.toolName&&item.toolVersion===question.toolVersion
          &&question.requirements.every(requirement=>hash(requirement.ruleBindingDigest))
          &&digest(item.requirements.map(requirementRule))===digest(question.requirements.map(requirementRule)));
        if(question.state==='pending'&&!question.contentConfirmation&&rule){question.state='allowed';question.decision='allow_always';question.receiptRef=randomUUID();}
        if(question.state==='pending'&&canReuse(question)){
          const consent=state.questions.find(item=>this.taskConsents.has(item.questionId)&&!this.taskConsents.get(item.questionId)!.aborted
            &&item.state==='allowed'&&item.decision==='allow_task'&&item.conversationId===question.conversationId
            &&item.sandbox.ref===profile.ref&&item.sandbox.revision===profile.revision
            &&digest(consentNative(item.sandbox.native))===digest(consentNative(profile.native))&&Date.parse(item.deadline)>this.now()
            &&Date.parse(question.deadline)<=Date.parse(item.deadline)
            &&(question.taskConsent?item.taskConsent&&digest(item.taskConsent)===digest(question.taskConsent)
              :!item.taskConsent&&item.taskId===question.taskId&&item.toolName===question.toolName&&item.toolVersion===question.toolVersion
                &&taskRule(item.requirements)===taskRule(question.requirements)));
          if(consent){question.state='allowed';question.decision='allow_task';question.receiptRef=randomUUID();question.taskConsentFrom=consent.questionId;}
        }
        if(question.state==='pending'&&!this.options.available()&&this.options.deferWhenUnavailable!==true){
          fail('当前对话授权卡不可用，操作未获允许');
        }
        state.questions.push(question);
      });
      this.liveBindings.set(question.questionId,()=>!signal.aborted&&assertCurrent());
      if(question.state==='allowed'){this.options.onChange?.();return Promise.resolve(this.receipt(question));}
      return new Promise((finish,reject)=>{
        const abort=()=>this.end(question.questionId,'cancelled','request_cancelled');
        const timer=setTimeout(()=>this.end(question.questionId,'expired','deadline'),Math.max(1,Math.min(2147483647,Date.parse(question.expiresAt)-this.now())));
        timer.unref?.();this.waiters.set(question.questionId,{finish,reject,signal,abort,timer});
        this.taskConsents.set(question.questionId,signal);
        signal.addEventListener('abort',abort,{once:true});if(signal.aborted)abort();
        this.options.onChange?.();
        if(question.state==='pending'){
          this.options.onPending?.({questionId:question.questionId,taskId:question.taskId,runId:question.runId,conversationId:question.conversationId});
        }
      });
    }catch(error){return Promise.reject(error);}
  }
  private receipt(question:Question):AuthorizationQuestionReceipt {
    return {questionId:question.questionId,revision:question.revision,decision:question.decision!,receiptRef:question.receiptRef!};
  }
  private settle(question:Question):void {
    const waiter=this.waiters.get(question.questionId);if(!waiter)return;
    clearTimeout(waiter.timer);waiter.signal.removeEventListener('abort',waiter.abort);this.waiters.delete(question.questionId);
    if(question.state==='allowed'||question.state==='denied')waiter.finish(this.receipt(question));
    else waiter.reject(new ProtocolError(question.state==='expired'?'TIMEOUT':question.state==='cancelled'?'CANCELLED':'UNAUTHORIZED',
      '原授权请求已失效，未执行操作'));
  }
  private end(questionId:string,state:AuthorizationQuestionState,reason:string):void {
    const question=this.mutate(saved=>{const item=saved.questions.find(value=>value.questionId===questionId);
      if(item?.state==='pending'){item.state=state;item.reason=reason;item.revision++;}return item;});
    if(question){this.settle(question);if(['expired','cancelled','stale'].includes(question.state))
      this.options.onInvalidated?.(question,question.state as 'expired'|'cancelled'|'stale');this.options.onChange?.();}
  }
  respond(input:{questionId:string;expectedRevision:number;decision:AuthorizationDecision},conversationId:string) {
    if(!input||Object.keys(input).some(key=>!['questionId','expectedRevision','decision'].includes(key))
      ||!text(input.questionId)||!Number.isSafeInteger(input.expectedRevision)||!['allow_once','allow_task','allow_always','deny'].includes(input.decision))
      throw new ProtocolError('INVALID_ARGUMENT','Invalid question decision');
    if(this.closed||!this.options.available())fail('当前对话授权卡不可用，操作未获允许');
    const question=this.mutate(state=>{
      const item=state.questions.find(value=>value.questionId===input.questionId);
      if(!item||item.conversationId!==conversationId)fail('此请求不属于当前对话');
      if(item!.revision!==input.expectedRevision||item!.state!=='pending')throw new ProtocolError('REVISION_CONFLICT','授权请求已处理或已变化');
      if(!this.current(item!)){item!.state=this.now()>=Date.parse(item!.expiresAt)?'expired':'stale';item!.revision++;return item!;}
      const canAlways=!item!.contentConfirmation&&item!.requirements.every(requirement=>hash(requirement.ruleBindingDigest));
      if(input.decision==='allow_always'&&!canAlways)fail('此请求不能保存为永久规则');
      if(input.decision==='allow_task'&&!canReuse(item!))fail('此请求尚未绑定可复用的任务范围');
      item!.state=input.decision==='deny'?'denied':'allowed';item!.decision=input.decision;item!.revision++;
      item!.receiptRef=randomUUID();
      if(input.decision==='allow_always'){
        if(state.rules.filter(rule=>rule.revoked!==true).length>=128)fail('授权规则已满');
        const baseProfile=this.options.profiles.find(p=>p.ref===(item!.baseSandboxRef??item!.sandbox.ref))??item!.sandbox;
        state.rules.push({ruleId:randomUUID(),revision:1,active:true,revoked:false,toolName:item!.toolName,toolVersion:item!.toolVersion,
          sandboxRef:item!.sandbox.ref,sandboxRevision:item!.sandbox.revision,sandboxLabel:item!.sandbox.label,
          profileDigest:profileDefinitionDigest(item!.sandbox),baseSandboxRef:baseProfile.ref,baseProfileDigest:profileDefinitionDigest(baseProfile),
          requirements:structuredClone(item!.requirements),summary:item!.requirements.map(requirement=>requirement.summary).join('；')});
      }
      return item!;
    });
    this.settle(question);this.options.onChange?.();
    if(question.state==='expired'||question.state==='stale')this.options.onInvalidated?.(question,question.state);
    return {accepted:question.state==='allowed'||question.state==='denied',questionId:question.questionId,revision:question.revision,state:question.state};
  }
  /** Called at each concrete grant/lease boundary, separately from receiving an answer. */
  consume(receipt:AuthorizationQuestionReceipt,request:AuthorizationQuestionRequest,requirementId:string,consumerId:string):void {
    this.validate(request);
    this.mutate(state=>{
      const question=state.questions.find(item=>item.questionId===receipt.questionId);
      const requirement=question?.requirements.find(item=>item.requirementId===requirementId);
      const input=this.normalize(request);
      if(!question||!requirement||question.state!=='allowed'||question.receiptRef!==receipt.receiptRef||question.revision!==receipt.revision
        ||digest(this.input(question))!==digest(input)||!this.current(question)||!text(consumerId))fail('原精确授权已失效');
      if(question.consumed[requirementId]!==undefined)fail('本次授权已消费');
      question.consumed[requirementId]=consumerId;
    });
  }
  assertRequirement(receipt:AuthorizationQuestionReceipt,request:AuthorizationQuestionRequest,requirementId:string,consumerId:string):void {
    this.validate(request);
    const question=this.readView().questions.find(item=>item.questionId===receipt.questionId);
    const input=this.normalize(request);
    if(!question||question.state!=='allowed'||question.receiptRef!==receipt.receiptRef||question.revision!==receipt.revision
      ||question.consumed[requirementId]!==consumerId||digest(this.input(question))!==digest(input)||!this.current(question)
      ||!this.options.canExecute(this.input(question)))fail('原任务当前不能执行此授权操作');
  }
  executionProfile(receipt:AuthorizationQuestionReceipt,request:AuthorizationQuestionRequest):AuthorizationSandbox {
    this.assertRequirement(receipt,request,'tool',request.runId+':tool');
    const question=this.readView().questions.find(item=>item.questionId===receipt.questionId)!;
    return structuredClone(question.sandbox);
  }
  /** For bounded local processing of the original confirmed read, never a new execution grant. */
  assertConsumedResult(receipt:AuthorizationQuestionReceipt,request:AuthorizationQuestionRequest,requirementId:string,consumerId:string):void {
    this.validate(request);
    const question=this.readView().questions.find(item=>item.questionId===receipt.questionId),profile=this.profile();
    const input=this.normalize(request),binding=this.options.readReceiptBinding?.(input);
    if(!question||question.state!=='allowed'||question.receiptRef!==receipt.receiptRef||question.revision!==receipt.revision
      ||question.consumed[requirementId]!==consumerId||digest(this.input(question))!==digest(input)
      ||profile.ref!==(question.baseSandboxRef??question.sandbox.ref)||profile.revision!==question.sandbox.revision||!profile.available
      ||binding?.conversationId!==question.conversationId||binding.digest!==question.ownerBinding
      ||this.liveBindings.get(question.questionId)?.()!==true)fail('原已确认结果的读取许可已失效');
  }
  /** Consume only a predeclared result-export requirement after the original confirmed tool, never another execution. */
  consumeConfirmedExport(receipt:AuthorizationQuestionReceipt,request:AuthorizationQuestionRequest,requirementId:string,consumerId:string):void {
    this.assertConsumedResult(receipt,request,'tool',request.runId+':tool');
    this.mutate(state=>{
      const question=state.questions.find(item=>item.questionId===receipt.questionId);
      const requirement=question?.requirements.find(item=>item.requirementId===requirementId);
      if(!question||requirement?.kind!=='export'||question.consumed[requirementId]!==undefined||!text(consumerId))fail('原结果出机许可不可消费');
      question.consumed[requirementId]=consumerId;
    });
  }
  /** Trusted fixed-session derivation. The caller must additionally prove original session membership. */
  deriveConsumedResult(parentReceipt:AuthorizationQuestionReceipt,parentRequest:AuthorizationQuestionRequest,requirementId:string,
    consumerId:string,request:AuthorizationQuestionRequest,assertCurrent:()=>boolean):AuthorizationQuestionReceipt {
    this.assertConsumedResult(parentReceipt,parentRequest,requirementId,consumerId);this.validate(request);
    if(request.contentConfirmation||request.forceAsk)fail('本次操作内容需要重新明确确认');
    if(Date.parse(request.deadline)>Date.parse(parentRequest.deadline)||request.toolName!==parentRequest.toolName
      ||request.toolVersion!==parentRequest.toolVersion||request.requirements.length!==parentRequest.requirements.length
      ||request.requirements.some(item=>{
        const parent=parentRequest.requirements.find(value=>value.requirementId===item.requirementId);
        return !parent||item.kind!==parent.kind||digest([...item.scopes].sort())!==digest([...parent.scopes].sort())
          ||item.requirementId!=='tool'&&item.ruleBindingDigest!==parent.ruleBindingDigest;
      })||!assertCurrent())fail('原批次授权不覆盖此页');
    const input=this.normalize(request),binding=this.options.readBinding(input),sandbox=this.profile();
    if(!binding||!sandbox.available)fail('原批次页不可执行');
    const question:Question={...input,questionId:randomUUID(),revision:1,state:'allowed',decision:'allow_once',receiptRef:randomUUID(),
      expiresAt:request.deadline,sandbox,conversationId:binding.conversationId,ownerBinding:binding.digest,
      baseSandboxRef:sandbox.ref,consumed:{},derivedFrom:parentReceipt.questionId};
    this.liveBindings.set(question.questionId,()=>!request.signal.aborted&&assertCurrent());
    this.mutate(state=>{
      // Completed derived pages already retain their exact approval/anchor in TaskRuntime.
      // Retain live pages here without imposing a new total page budget on a mailbox batch.
      state.questions=this.pruneQuestions(state.questions.filter(item=>!item.derivedFrom||!this.options.readReceiptBinding?.(this.input(item))));
      if(state.questions.length>=MAX_STORED_QUESTIONS)fail('同时活动的授权记录已满');state.questions.push(question);
    });
    return this.receipt(question);
  }
  snapshot(conversationId?:string) {
    return this.readView().questions.filter(question=>!question.automatic&&!question.derivedFrom&&!question.taskConsentFrom&&(!conversationId||question.conversationId===conversationId)).map(question=>({
      questionId:question.questionId,taskId:question.taskId,conversationId:question.conversationId,sourceApprovalId:question.runId,
      revision:question.revision,state:question.state,
      title:hasSecretForceAsk(question)?'检测到疑似密钥或凭据，是否放行？':question.forceAsk?'请确认这项操作':question.contentConfirmation?'确认本次操作的目标与完整内容':'同意这项操作？',description:(question.contentConfirmation?.text??question.taskConsent?.summary??question.requirements.find(item=>item.requirementId==='intent')?.summary
        ??question.requirements.find(item=>item.requirementId==='tool')?.summary??'完成这项操作。')
        +(question.requirements.some(item=>item.kind==='export')&&!/云端|模型/u.test(question.taskConsent?.summary??'')?' 必要结果将用于本次云端对话。':''),toolName:question.toolName,
      expiresAt:question.expiresAt,canAlways:!question.contentConfirmation&&question.requirements.every(requirement=>hash(requirement.ruleBindingDigest)),
      ...(question.forceAsk?{forceAsk:true}:{}),
      canReuseTask:canReuse(question),suggestedDecision:canReuse(question)?'allow_task' as const:'allow_once' as const,
      requirements:question.requirements.map(({requirementId,kind,summary,scopes})=>({requirementId,kind,summary,scopes:[...scopes]})),
      sandbox:{kind:'application_policy' as const,label:question.sandbox.label,mode:question.sandbox.mode,revision:question.sandbox.revision,
        ...(question.sandbox.native?{native:{required:question.sandbox.native.required,available:question.sandbox.native.available,
          backend:question.sandbox.native.backend,enforced:question.sandbox.native.enforced,
          ...(question.sandbox.native.reason?{reason:question.sandbox.native.reason}:{})}}:{})},
    }));
  }
  hasPending(runId:string):boolean {return this.readView().questions.some(question=>question.runId===runId&&question.state==='pending');}
  refresh():void {
    for(const question of this.readView().questions)if(question.state==='pending'&&!this.current(question))
      this.end(question.questionId,this.now()>=Date.parse(question.expiresAt)?'expired':'stale','original_binding_changed');
  }
  sandboxSnapshot() {
    const state=this.readView(),selected=this.profile(state);
    const execution=this.options.describeExecution?.(undefined,selected);
    return {selected:{ref:selected.ref,label:selected.label,mode:selected.mode,revision:selected.revision},
      nativeExecution:execution?{available:execution.available,backend:execution.backend,enforced:execution.enforced,
        ...(execution.reason?{reason:execution.reason}:{})}:{available:false,backend:'unavailable',enforced:false},
      profiles:this.options.profiles.map(({ref,label,mode,available,reason})=>({ref,label,mode,available,...(reason?{reason}:{})})),
      rules:state.rules.map(rule=>{
        const status=resolveRuleStatus(rule,selected,this.options.profiles);
        return {ruleId:rule.ruleId,revision:rule.revision,summary:rule.summary,sandboxLabel:rule.sandboxLabel,sandboxRef:rule.sandboxRef,
          active:status==='active',status};
      })};
  }
  selectSandbox(input:{profileRef:string;expectedRevision:number}) {
    if(!input||Object.keys(input).some(key=>!['profileRef','expectedRevision'].includes(key))||!Number.isSafeInteger(input.expectedRevision))
      throw new ProtocolError('INVALID_ARGUMENT','Invalid sandbox selection');
    const profile=this.options.profiles.find(item=>item.ref===input?.profileRef);
    if(!profile?.available)fail('此沙箱执行后端不可用');
    this.mutate(state=>{if(state.revision!==input.expectedRevision)throw new ProtocolError('REVISION_CONFLICT','沙箱已变化');
      state.selectedRef=profile!.ref;state.profileChosen=true;state.revision++;
      const nextSelected={...profile!,revision:state.revision};
      for(const rule of state.rules){
        if(rule.revoked!==true)rule.active=resolveRuleStatus(rule,nextSelected,this.options.profiles)==='active';
      }
    });
    for(const questionId of this.waiters.keys())this.end(questionId,'stale','sandbox_changed');
    this.options.onChange?.();return this.sandboxSnapshot();
  }
  revokeRule(input:{ruleId:string;expectedRevision:number}) {
    if(!input||Object.keys(input).some(key=>!['ruleId','expectedRevision'].includes(key))||!Number.isSafeInteger(input.expectedRevision))
      throw new ProtocolError('INVALID_ARGUMENT','Invalid rule revocation');
    const revokedWaiters:string[]=[];
    this.mutate(state=>{const rule=state.rules.find(item=>item.ruleId===input?.ruleId);
      if(!rule||rule.revision!==input.expectedRevision||rule.revoked===true)throw new ProtocolError('REVISION_CONFLICT','授权规则已变化');
      const previousRevision=state.revision;
      rule.revoked=true;rule.active=false;rule.revision++;state.revision++;
      for(const item of state.rules){
        if(item!==rule&&item.active&&item.sandboxRevision===previousRevision)item.sandboxRevision=state.revision;
      }
      for(const question of state.questions){
        const sameTool=question.toolName===rule.toolName&&question.toolVersion===rule.toolVersion;
        if(question.state==='pending'&&this.waiters.has(question.questionId)){
          if(sameTool)revokedWaiters.push(question.questionId);
          else if(question.sandbox.revision===previousRevision)question.sandbox.revision=state.revision;
        }else if(question.state==='allowed'&&question.decision==='allow_task'&&this.taskConsents.has(question.questionId)
          &&!sameTool&&question.sandbox.revision===previousRevision){
          question.sandbox.revision=state.revision;
        }
      }
    });
    for(const questionId of revokedWaiters)this.end(questionId,'stale','rule_revoked');
    this.options.onChange?.();return this.sandboxSnapshot();
  }
  close():void {this.closed=true;for(const questionId of this.waiters.keys())this.end(questionId,'cancelled','host_closed');this.liveBindings.clear();this.taskConsents.clear();}
}

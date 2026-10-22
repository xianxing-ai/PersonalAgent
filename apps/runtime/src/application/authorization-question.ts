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
  /** Trusted workflow grouping, never accepted from Renderer or a model proposal. */
  taskConsent?:{taskId:string;bindingDigest:string;summary:string;mode:'read-only'|'workspace-write';requiresNative?:boolean};
}
export interface AuthorizationSandbox {
  ref:string;label:string;mode:'read-only'|'workspace-write'|'full-access';revision:number;available:boolean;reason?:string;
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
  requirements:AuthorizationRequirement[];sandbox:AuthorizationSandbox;ownerBinding:string;
  baseSandboxRef?:string;
  decision?:AuthorizationDecision;receiptRef?:string;reason?:string;consumed:Record<string,string>;
  derivedFrom?:string;
  taskConsentFrom?:string;
  taskConsent?:AuthorizationQuestionRequest['taskConsent'];
}
interface Rule {ruleId:string;revision:number;active:boolean;toolName:string;toolVersion:string;
  sandboxRef:string;sandboxRevision:number;sandboxLabel:string;requirements:AuthorizationRequirement[];summary:string;}
interface State {version:1;selectedRef:string;revision:number;questions:Question[];rules:Rule[];}
export interface AuthorizationQuestionsOptions {
  store:TrustedHostStateStore;
  profiles:readonly AuthorizationSandbox[];
  defaultProfileRef:string;
  /** Reads original task/proposal/owner/config identities. waiting_approval is legitimate here. */
  readBinding(request:Omit<AuthorizationQuestionRequest,'signal'>):{conversationId:string;digest:string}|undefined;
  readReceiptBinding?:(request:Omit<AuthorizationQuestionRequest,'signal'>)=>{conversationId:string;digest:string}|undefined;
  /** UI absence is an unavailable capability, never an implicit allow. */
  available():boolean;
  /** Real side effects require the original Runtime execution state in addition to the decision. */
  canExecute(request:Omit<AuthorizationQuestionRequest,'signal'>):boolean;
  resolveProfile?:(request:Omit<AuthorizationQuestionRequest,'signal'>,selected:AuthorizationSandbox)=>string;
  describeExecution?:(request:Omit<AuthorizationQuestionRequest,'signal'>|undefined,profile:AuthorizationSandbox)=>AuthorizationNativeExecution;
  onInvalidated?:(binding:{taskId:string;runId:string},state:'expired'|'cancelled'|'stale')=>void;
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
const canReuse=(question:Pick<Question,'requirements'|'taskConsent'>)=>Boolean(question.taskConsent)||reusable(question.requirements);
const consentNative=(native:AuthorizationNativeExecution|undefined)=>native?.required?native:{required:false};

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
  private mutate<T>(update:(state:State)=>T):T {
    const previous=this.options.store.get('state'),state=this.read();
    const result=update(state);
    if(!this.options.store.compareAndSet!('state',previous,state))throw new ProtocolError('REVISION_CONFLICT','Authorization state changed');
    return result;
  }
  private profile(state=this.read()):AuthorizationSandbox {
    const profile=this.options.profiles.find(item=>item.ref===state.selectedRef);
    if(!profile)fail('Selected sandbox is unavailable');
    return {...profile!,revision:state.revision};
  }
  private input(question:Question):Omit<AuthorizationQuestionRequest,'signal'> {
    return {taskId:question.taskId,proposalId:question.proposalId,runId:question.runId,toolName:question.toolName,
      toolVersion:question.toolVersion,argumentsDigest:question.argumentsDigest,deadline:question.deadline,
      requirements:structuredClone(question.requirements),...(question.taskConsent?{taskConsent:structuredClone(question.taskConsent)}:{})};
  }
  private normalize(request:AuthorizationQuestionRequest):Omit<AuthorizationQuestionRequest,'signal'> {
    return {taskId:request.taskId,proposalId:request.proposalId,runId:request.runId,toolName:request.toolName,
      toolVersion:request.toolVersion,argumentsDigest:request.argumentsDigest,deadline:request.deadline,
      ...(request.taskConsent?{taskConsent:structuredClone(request.taskConsent)}:{}),
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
      ||!hash(request.argumentsDigest)||!Number.isFinite(Date.parse(request.deadline))||Date.parse(request.deadline)<=this.now()
      ||!request.signal||request.signal.aborted||!Array.isArray(request.requirements)||request.requirements.length<1||request.requirements.length>24)
      throw new ProtocolError('INVALID_ARGUMENT','Invalid authorization question binding');
    const ids=new Set<string>();
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
      if(this.closed||!this.options.available())fail('当前对话授权卡不可用，操作未获允许');
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
      this.liveBindings.set(question.questionId,()=>!signal.aborted&&assertCurrent());
      this.mutate(state=>{
        state.questions=state.questions.filter(item=>item.state==='pending'||this.now()<Date.parse(item.expiresAt)+86400000);
        if(state.questions.length>=256)fail('授权记录已满，请先处理当前请求');
        const rule=state.rules.find(item=>item.active&&item.toolName===question.toolName&&item.toolVersion===question.toolVersion
          &&item.sandboxRef===profile.ref&&item.sandboxRevision===profile.revision
          &&question.requirements.every(requirement=>hash(requirement.ruleBindingDigest))
          &&digest(item.requirements.map(requirementRule))===digest(question.requirements.map(requirementRule)));
        if(rule){question.state='allowed';question.decision='allow_always';question.receiptRef=randomUUID();}
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
        state.questions.push(question);
      });
      if(question.state==='allowed'){this.options.onChange?.();return Promise.resolve(this.receipt(question));}
      return new Promise((finish,reject)=>{
        const abort=()=>this.end(question.questionId,'cancelled','request_cancelled');
        const timer=setTimeout(()=>this.end(question.questionId,'expired','deadline'),Math.max(1,Math.min(2147483647,Date.parse(question.expiresAt)-this.now())));
        timer.unref?.();this.waiters.set(question.questionId,{finish,reject,signal,abort,timer});
        this.taskConsents.set(question.questionId,signal);
        signal.addEventListener('abort',abort,{once:true});if(signal.aborted)abort();
        this.options.onChange?.();
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
    const question=this.mutate(state=>{
      const item=state.questions.find(value=>value.questionId===input.questionId);
      if(!item||item.conversationId!==conversationId)fail('此请求不属于当前对话');
      if(item!.revision!==input.expectedRevision||item!.state!=='pending')throw new ProtocolError('REVISION_CONFLICT','授权请求已处理或已变化');
      if(!this.current(item!)){item!.state=this.now()>=Date.parse(item!.expiresAt)?'expired':'stale';item!.revision++;return item!;}
      const canAlways=item!.requirements.every(requirement=>hash(requirement.ruleBindingDigest));
      if(input.decision==='allow_always'&&!canAlways)fail('此请求不能保存为永久规则');
      if(input.decision==='allow_task'&&!canReuse(item!))fail('此请求尚未绑定可复用的任务范围');
      item!.state=input.decision==='deny'?'denied':'allowed';item!.decision=input.decision;item!.revision++;
      item!.receiptRef=randomUUID();
      if(input.decision==='allow_always'){
        if(state.rules.filter(rule=>rule.active).length>=128)fail('授权规则已满');
        state.rules.push({ruleId:randomUUID(),revision:1,active:true,toolName:item!.toolName,toolVersion:item!.toolVersion,
          sandboxRef:item!.sandbox.ref,sandboxRevision:item!.sandbox.revision,sandboxLabel:item!.sandbox.label,
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
    const question=this.read().questions.find(item=>item.questionId===receipt.questionId);
    const input=this.normalize(request);
    if(!question||question.state!=='allowed'||question.receiptRef!==receipt.receiptRef||question.revision!==receipt.revision
      ||question.consumed[requirementId]!==consumerId||digest(this.input(question))!==digest(input)||!this.current(question)
      ||!this.options.canExecute(this.input(question)))fail('原任务当前不能执行此授权操作');
  }
  executionProfile(receipt:AuthorizationQuestionReceipt,request:AuthorizationQuestionRequest):AuthorizationSandbox {
    this.assertRequirement(receipt,request,'tool',request.runId+':tool');
    const question=this.read().questions.find(item=>item.questionId===receipt.questionId)!;
    return structuredClone(question.sandbox);
  }
  /** For bounded local processing of the original confirmed read, never a new execution grant. */
  assertConsumedResult(receipt:AuthorizationQuestionReceipt,request:AuthorizationQuestionRequest,requirementId:string,consumerId:string):void {
    this.validate(request);
    const question=this.read().questions.find(item=>item.questionId===receipt.questionId),profile=this.profile();
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
      state.questions=state.questions.filter(item=>!item.derivedFrom||!this.options.readReceiptBinding?.(this.input(item)));
      if(state.questions.length>=256)fail('同时活动的授权记录已满');state.questions.push(question);
    });
    return this.receipt(question);
  }
  snapshot(conversationId?:string) {
    return this.read().questions.filter(question=>!question.derivedFrom&&!question.taskConsentFrom&&(!conversationId||question.conversationId===conversationId)).map(question=>({
      questionId:question.questionId,taskId:question.taskId,conversationId:question.conversationId,sourceApprovalId:question.runId,
      revision:question.revision,state:question.state,
      title:'同意这项操作？',description:(question.taskConsent?.summary??question.requirements.find(item=>item.requirementId==='intent')?.summary
        ??question.requirements.find(item=>item.requirementId==='tool')?.summary??'完成这项操作。')
        +(question.requirements.some(item=>item.kind==='export')&&!/云端|模型/u.test(question.taskConsent?.summary??'')?' 必要结果将用于本次云端对话。':''),toolName:question.toolName,
      expiresAt:question.expiresAt,canAlways:question.requirements.every(requirement=>hash(requirement.ruleBindingDigest)),
      canReuseTask:canReuse(question),suggestedDecision:canReuse(question)?'allow_task' as const:'allow_once' as const,
      requirements:question.requirements.map(({requirementId,kind,summary,scopes})=>({requirementId,kind,summary,scopes:[...scopes]})),
      sandbox:{kind:'application_policy' as const,label:question.sandbox.label,mode:question.sandbox.mode,revision:question.sandbox.revision,
        ...(question.sandbox.native?{native:{required:question.sandbox.native.required,available:question.sandbox.native.available,
          backend:question.sandbox.native.backend,enforced:question.sandbox.native.enforced,
          ...(question.sandbox.native.reason?{reason:question.sandbox.native.reason}:{})}}:{})},
    }));
  }
  hasPending(runId:string):boolean {return this.read().questions.some(question=>question.runId===runId&&question.state==='pending');}
  refresh():void {
    for(const question of this.read().questions)if(question.state==='pending'&&!this.current(question))
      this.end(question.questionId,this.now()>=Date.parse(question.expiresAt)?'expired':'stale','original_binding_changed');
  }
  sandboxSnapshot() {
    const state=this.read(),selected=this.profile(state);
    const execution=this.options.describeExecution?.(undefined,selected);
    return {selected:{label:selected.label,mode:selected.mode,revision:selected.revision},
      nativeExecution:execution?{available:execution.available,backend:execution.backend,enforced:execution.enforced,
        ...(execution.reason?{reason:execution.reason}:{})}:{available:false,backend:'unavailable',enforced:false},
      profiles:this.options.profiles.map(({ref,label,mode,available,reason})=>({ref,label,mode,available,...(reason?{reason}:{})})),
      rules:state.rules.map(({ruleId,revision,summary,sandboxLabel,active})=>({ruleId,revision,summary,sandboxLabel,active}))};
  }
  selectSandbox(input:{profileRef:string;expectedRevision:number}) {
    if(!input||Object.keys(input).some(key=>!['profileRef','expectedRevision'].includes(key))||!Number.isSafeInteger(input.expectedRevision))
      throw new ProtocolError('INVALID_ARGUMENT','Invalid sandbox selection');
    const profile=this.options.profiles.find(item=>item.ref===input?.profileRef);
    if(!profile?.available)fail('此沙箱执行后端不可用');
    this.mutate(state=>{if(state.revision!==input.expectedRevision)throw new ProtocolError('REVISION_CONFLICT','沙箱已变化');
      state.selectedRef=profile!.ref;state.revision++;for(const rule of state.rules)rule.active=false;});
    for(const questionId of this.waiters.keys())this.end(questionId,'stale','sandbox_changed');
    this.options.onChange?.();return this.sandboxSnapshot();
  }
  revokeRule(input:{ruleId:string;expectedRevision:number}) {
    if(!input||Object.keys(input).some(key=>!['ruleId','expectedRevision'].includes(key))||!Number.isSafeInteger(input.expectedRevision))
      throw new ProtocolError('INVALID_ARGUMENT','Invalid rule revocation');
    this.mutate(state=>{const rule=state.rules.find(item=>item.ruleId===input?.ruleId);
      if(!rule||rule.revision!==input.expectedRevision)throw new ProtocolError('REVISION_CONFLICT','授权规则已变化');
      rule.active=false;rule.revision++;state.revision++;for(const item of state.rules)item.active=false;});
    for(const questionId of this.waiters.keys())this.end(questionId,'stale','rule_revoked');
    this.options.onChange?.();return this.sandboxSnapshot();
  }
  close():void {this.closed=true;for(const questionId of this.waiters.keys())this.end(questionId,'cancelled','host_closed');this.liveBindings.clear();this.taskConsents.clear();}
}

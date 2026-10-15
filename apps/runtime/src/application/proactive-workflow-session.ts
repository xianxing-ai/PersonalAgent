import {createHash} from 'node:crypto';
import {ProtocolError} from '@personal-agent/contracts';
import type {AgentToolInvocation,AgentToolPort} from '@personal-agent/agents';
import type {RuntimeAtomicStatePort} from '../atomic-host-state.js';

export interface ProactiveSessionBinding {
  taskId:string;sessionId:string;controlRevision:number;taskDeadline:string;
}
export interface ProactiveSessionProposal {
  proposalId:string;operationId:string;argumentsDigest:string;originControlRevision:number;taskDeadline:string;
}
export interface ProactiveSessionResult<P extends ProactiveSessionProposal=ProactiveSessionProposal> {
  checkpoint:string;taskDeadline:string;proposals:readonly P[];
}
export interface ProactiveSessionRequest extends ProactiveSessionBinding {
  requestId:string;deadline:string;signal:AbortSignal;
}
export interface ProactiveExecutionReadback {
  state:'confirmed'|'failed'|'unknown'|'pending';evidenceRefs:readonly string[];result?:unknown;
}
type SavedInvocation=Omit<AgentToolInvocation,'signal'>;
interface Operation {
  proposal:ProactiveSessionProposal;invocation:SavedInvocation;state:'pending'|'settled';readback?:ProactiveExecutionReadback;
}
interface SessionState {
  version:1;binding:ProactiveSessionBinding;checkpoint?:string;
  requests:Record<string,{digest:string;state:'pending'|'committed';result?:unknown;input?:unknown;checkpointDigest?:string;
    recovery?:'recompute_after_lost_pure_frontier_response'}>;
  proposals:Record<string,ProactiveSessionProposal>;operations:Record<string,Operation>;
}
export interface ProactiveWorkflowSessionOptions<I extends ProactiveSessionRequest,R extends ProactiveSessionResult> {
  atomicState:RuntimeAtomicStatePort;binding:ProactiveSessionBinding;
  /** Must read current TaskRuntime cancellation/terminal state and trusted control revision. */
  assertActive(binding:ProactiveSessionBinding):void|Promise<void>;
  advancePort(input:I & {checkpoint?:string}):Promise<R>;
  /** Existing image response signature verifier, including request/session binding. */
  verifyAdvance(result:R,input:I & {checkpoint?:string}):boolean|Promise<boolean>;
  /** Trusted startup capability, never request/model data. Port performs signed frontier computation only: no models, tools or external writes. */
  pureAdvance?:{kind:'signed_frontier_no_effects'};
  onRecovery?:(event:{event:'recompute_after_lost_pure_frontier_response';requestId:string;observedAt:string})=>void;
  now?:()=>number;
  execution?:{
    tools:AgentToolPort;
    /** Trusted host maps a committed proposal to an existing Policy authorization; never model supplied authority. */
    resolveInvocation(proposal:R['proposals'][number],context:{signal:AbortSignal;deadline:string}):AgentToolInvocation|Promise<AgentToolInvocation>;
    /** Reads the original Runtime run/Evidence, checks run/task/input binding, never model success claims. */
    readExecution(invocation:SavedInvocation,proposal:R['proposals'][number]):Promise<ProactiveExecutionReadback>;
  };
}
function digest(value:unknown):string {
  const canonical=(v:unknown):string=>{
    if(v===null||typeof v==='string'||typeof v==='boolean'||typeof v==='number'&&Number.isFinite(v))return JSON.stringify(v);
    if(Array.isArray(v))return '['+v.map(canonical).join(',')+']';
    if(v&&typeof v==='object'&&Object.getPrototypeOf(v)===Object.prototype)
      return '{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+canonical((v as Record<string,unknown>)[k])).join(',')+'}';
    throw new ProtocolError('INVALID_ARGUMENT','Session data must be finite JSON');
  };
  return createHash('sha256').update(canonical(value)).digest('hex');
}
const conflict=():never=>{throw new ProtocolError('REVISION_CONFLICT','Proactive session changed; no new proposal released');};
/** Host facade over the existing Runtime atomic namespace. It owns no scheduler, model loop or permissions. */
export function createProactiveWorkflowSession<I extends ProactiveSessionRequest,R extends ProactiveSessionResult>(options:ProactiveWorkflowSessionOptions<I,R>) {
  const binding=structuredClone(options.binding),now=options.now??Date.now;
  if(!binding.taskId||!binding.sessionId||!Number.isSafeInteger(binding.controlRevision)||binding.controlRevision<0||!Number.isFinite(Date.parse(binding.taskDeadline)))
    throw new ProtocolError('INVALID_ARGUMENT','Invalid original proactive session binding');
  const key='proactive.session:'+digest({taskId:binding.taskId,sessionId:binding.sessionId});
  async function bounded<T>(work:()=>T|Promise<T>,signal:AbortSignal,deadline:string,historicalRead=false):Promise<T>{
    const limit=()=>historicalRead?Date.parse(deadline):Math.min(Date.parse(deadline),Date.parse(binding.taskDeadline));
    let timer:ReturnType<typeof setTimeout>|undefined,onAbort:()=>void=()=>{};
    const stop=new Promise<never>((_resolve,reject)=>{
      onAbort=()=>reject(new ProtocolError('CANCELLED','Proactive session cancelled; original operation may still need readback'));
      signal.addEventListener('abort',onAbort,{once:true});
      const tick=()=>{
        const remaining=limit()-now();
        if(remaining<=0){reject(new ProtocolError('TIMEOUT','Original proactive deadline expired; original operation may still need readback'));return;}
        timer=setTimeout(tick,Math.min(remaining,2147483647));timer.unref();
      };
      if(signal.aborted)onAbort();else tick();
    });
    try{return await Promise.race([stop,Promise.resolve().then(()=>{
      if(signal.aborted)throw new ProtocolError('CANCELLED','Proactive session cancelled before invocation');
      if(now()>=limit())throw new ProtocolError('TIMEOUT','Proactive request read deadline expired');
      return work();
    })]);}
    finally{if(timer)clearTimeout(timer);signal.removeEventListener('abort',onAbort);}
  }
  function read(){
    const saved=options.atomicState.read(key),state=saved?.value as SessionState|undefined;
    if(state&&(state.version!==1||state.binding.taskId!==binding.taskId||state.binding.sessionId!==binding.sessionId||
      state.binding.taskDeadline!==binding.taskDeadline||state.binding.controlRevision>binding.controlRevision))conflict();
    return {revision:saved?.revision,state:state??{version:1 as const,binding,requests:{},proposals:{},operations:{}}};
  }
  async function active(signal:AbortSignal,deadline:string){
    if(!(signal instanceof AbortSignal))throw new ProtocolError('INVALID_ARGUMENT','Cancellation signal required');
    if(signal.aborted)throw new ProtocolError('CANCELLED','Proactive session cancelled');
    if(!Number.isFinite(Date.parse(deadline))||Date.parse(deadline)>Date.parse(binding.taskDeadline))
      throw new ProtocolError('INVALID_ARGUMENT','Original task deadline cannot be extended');
    if(now()>=Math.min(Date.parse(deadline),Date.parse(binding.taskDeadline)))throw new ProtocolError('TIMEOUT','Original proactive task deadline expired');
    await bounded(()=>options.assertActive(binding),signal,deadline);
    if(signal.aborted)throw new ProtocolError('CANCELLED','Proactive session cancelled');
    if(now()>=Math.min(Date.parse(deadline),Date.parse(binding.taskDeadline)))throw new ProtocolError('TIMEOUT','Original proactive task deadline expired');
  }
  const commit=(revision:number|undefined,state:SessionState)=>{if(!options.atomicState.compareAndSet(key,revision,state))conflict();};
  async function computeAndCommit(request:I & {checkpoint?:string},reserved:ReturnType<typeof read>,recovery=false):Promise<R>{
    const prior=reserved.state.requests[request.requestId]!;
    const result=await bounded(()=>options.advancePort(request),request.signal,request.deadline);
    if(!await bounded(()=>options.verifyAdvance(result,request),request.signal,request.deadline)||!result.checkpoint||result.taskDeadline!==binding.taskDeadline||!Array.isArray(result.proposals))
      throw new ProtocolError('UNAUTHORIZED','Unverified proactive advance response');
    await active(request.signal,request.deadline);
    const completed=structuredClone(reserved.state);
    for(const proposal of result.proposals){
      if(!proposal.proposalId||!proposal.operationId||proposal.originControlRevision!==binding.controlRevision||proposal.taskDeadline!==binding.taskDeadline)
        throw new ProtocolError('UNAUTHORIZED','Proposal outside original session');
      const old=completed.proposals[proposal.proposalId];
      if(old&&digest(old)!==digest(proposal))conflict();
      completed.proposals[proposal.proposalId]=structuredClone(proposal);
    }
    completed.checkpoint=result.checkpoint;
    completed.requests[request.requestId]={...prior,state:'committed',result:structuredClone(result),
      ...(recovery?{recovery:'recompute_after_lost_pure_frontier_response' as const}:{})};
    commit(reserved.revision,completed);
    return structuredClone(result);
  }
  return {
    async advance(input:I):Promise<R>{
      await active(input.signal,input.deadline);
      if(digest({taskId:input.taskId,sessionId:input.sessionId,controlRevision:input.controlRevision,taskDeadline:input.taskDeadline})!==digest(binding)||!input.requestId)
        throw new ProtocolError('INVALID_ARGUMENT','Request does not match trusted original session');
      if('checkpoint' in input)throw new ProtocolError('INVALID_ARGUMENT','Checkpoint comes only from trusted Runtime state');
      const {signal,...data}=input,requestDigest=digest(data),snapshot=read(),prior=snapshot.state.requests[input.requestId];
      if(prior){
        if(prior.digest!==requestDigest)conflict();
        if(prior.state==='committed')return structuredClone(prior.result) as R;
        throw new ProtocolError('EXTERNAL_FAILURE','Original advance outcome pending; do not replay request');
      }
      if(Object.values(snapshot.state.requests).some(r=>r.state==='pending'))conflict();
      const state=structuredClone(snapshot.state);
      state.binding=structuredClone(binding);
      state.requests[input.requestId]={digest:requestDigest,state:'pending',input:structuredClone(data),checkpointDigest:digest(state.checkpoint??null)};
      commit(snapshot.revision,state);
      const reserved=read();
      if(reserved.revision!==(snapshot.revision??0)+1)conflict();
      const request={...input,signal,...(state.checkpoint?{checkpoint:state.checkpoint}:{})};
      return computeAndCommit(request,reserved);
    },
    async recoverPendingRequest(requestId:string,context:{signal:AbortSignal}):Promise<R>{
      if(options.pureAdvance?.kind!=='signed_frontier_no_effects')
        throw new ProtocolError('UNSUPPORTED_CAPABILITY','Trusted pure frontier capability unavailable; original request retained');
      const reserved=read(),prior=reserved.state.requests[requestId];
      if(!prior)throw new ProtocolError('NOT_FOUND','Original advance intent unavailable');
      if(!prior.input||digest(prior.input)!==prior.digest)conflict();
      const original=structuredClone(prior.input) as Omit<I,'signal'>;
      if(original.requestId!==requestId||digest({taskId:original.taskId,sessionId:original.sessionId,controlRevision:original.controlRevision,taskDeadline:original.taskDeadline})!==digest(binding))conflict();
      await active(context.signal,original.deadline);
      if(prior.state==='committed')return structuredClone(prior.result) as R;
      if(prior.checkpointDigest!==digest(reserved.state.checkpoint??null))conflict();
      try{options.onRecovery?.({event:'recompute_after_lost_pure_frontier_response',requestId,observedAt:new Date(now()).toISOString()});}catch{/* diagnostics grant nothing */}
      const request={...original,signal:context.signal,...(reserved.state.checkpoint?{checkpoint:reserved.state.checkpoint}:{})} as I & {checkpoint?:string};
      // Recompute, not historical response replay: current time may change freshness and createdAt.
      // Every concurrent response competes for the same original pending CAS slot; losers expose no proposals.
      return computeAndCommit(request,reserved,true);
    },
    async executeProposal(proposal:R['proposals'][number],context:{signal:AbortSignal;deadline:string}):Promise<ProactiveExecutionReadback>{
      await active(context.signal,context.deadline);
      const execution=options.execution;
      if(!execution)throw new ProtocolError('UNSUPPORTED_CAPABILITY','Existing ToolGateway execution adapter unavailable');
      let snapshot=read();
      const registered=snapshot.state.proposals[proposal.proposalId];
      if(!registered||digest(registered)!==digest(proposal)||proposal.originControlRevision!==binding.controlRevision)
        throw new ProtocolError('UNAUTHORIZED','Proposal was not committed at the current control revision');
      let operation=snapshot.state.operations[proposal.operationId];
      if(operation&&digest(operation.proposal)!==digest(proposal))conflict();
      if(operation?.state==='settled')return structuredClone(operation.readback!);
      let invocation:AgentToolInvocation|undefined;
      if(!operation){
        invocation=await bounded(()=>execution.resolveInvocation(proposal,context),context.signal,context.deadline);
        await active(context.signal,context.deadline);
        if(invocation.taskId!==binding.taskId||invocation.signal!==context.signal||!invocation.runId||!invocation.authorizationRef||
          !Number.isFinite(Date.parse(invocation.deadline))||Date.parse(invocation.deadline)>Date.parse(context.deadline)||
          !execution.tools.list().some(t=>t.name===invocation!.toolName&&t.version===invocation!.toolVersion))
          throw new ProtocolError('UNAUTHORIZED','Tool invocation is not bound to registered host authority');
        const {signal,...saved}=invocation;
        const current=read();
        if(current.revision!==snapshot.revision)conflict();
        // A run identity cannot be reused with another proposal/input.
        if(Object.values(current.state.operations).some(o=>o.invocation.runId===saved.runId))conflict();
        operation={proposal:structuredClone(proposal),invocation:structuredClone(saved),state:'pending'};
        const pending=structuredClone(current.state);pending.operations[proposal.operationId]=operation;
        commit(current.revision,pending);
        snapshot=read();
        if(snapshot.revision!==(current.revision??0)+1)conflict();
        await active(context.signal,context.deadline);
        // Throws/unknown leave the durable intent in place. Only original readback can resolve it.
        try{await bounded(()=>execution.tools.invoke(invocation!),context.signal,context.deadline);}catch{/* Preserve Runtime error in its original run/Evidence; read it below. */}
        await active(context.signal,context.deadline);
      }
      const readback=await bounded(()=>execution.readExecution(operation!.invocation,proposal),context.signal,context.deadline);
      if(!['confirmed','failed','unknown','pending'].includes(readback.state)||!Array.isArray(readback.evidenceRefs)||
        (readback.state==='confirmed'||readback.state==='failed')&&(!readback.evidenceRefs.length||readback.evidenceRefs.some(e=>typeof e!=='string'||!e)))
        throw new ProtocolError('UNAUTHORIZED','Original execution Evidence unavailable');
      await active(context.signal,context.deadline);
      const settled=structuredClone(snapshot.state);
      settled.operations[proposal.operationId]={...operation,state:readback.state==='confirmed'||readback.state==='failed'?'settled':'pending',readback:structuredClone(readback)};
      commit(snapshot.revision,settled);
      return structuredClone(readback);
    },
    /** Historical read only: cancellation/control revision/expiry never authorize a new execution, nor prevent original Evidence recovery. */
    async reconcileOperation(operationId:string,context:{signal:AbortSignal;deadline:string}):Promise<ProactiveExecutionReadback>{
      if(!(context.signal instanceof AbortSignal)||!Number.isFinite(Date.parse(context.deadline)))
        throw new ProtocolError('INVALID_ARGUMENT','Explicit readback request lifetime required');
      const execution=options.execution;
      if(!execution)throw new ProtocolError('UNSUPPORTED_CAPABILITY','Original Runtime Evidence reader unavailable');
      const snapshot=read(),operation=snapshot.state.operations[operationId];
      if(!operation||operation.proposal.operationId!==operationId||operation.invocation.taskId!==binding.taskId||
        operation.proposal.taskDeadline!==binding.taskDeadline||!operation.invocation.runId||!operation.proposal.argumentsDigest)
        throw new ProtocolError('NOT_FOUND','Original bound operation unavailable');
      if(operation.state==='settled')return structuredClone(operation.readback!);
      const readback=await bounded(()=>execution.readExecution(operation.invocation,operation.proposal as R['proposals'][number]),context.signal,context.deadline,true);
      if(!['confirmed','failed','unknown','pending'].includes(readback.state)||!Array.isArray(readback.evidenceRefs)||
        (readback.state==='confirmed'||readback.state==='failed')&&(!readback.evidenceRefs.length||readback.evidenceRefs.some(e=>typeof e!=='string'||!e)))
        throw new ProtocolError('UNAUTHORIZED','Original bound execution Evidence unavailable');
      const recovered=structuredClone(snapshot.state);
      recovered.operations[operationId]={...operation,state:readback.state==='confirmed'||readback.state==='failed'?'settled':'pending',readback:structuredClone(readback)};
      commit(snapshot.revision,recovered);
      return structuredClone(readback);
    },
    /** No image readback port exists here: never clear or replay an uncertain image request. */
    reconcileRequest():never{throw new ProtocolError('UNSUPPORTED_CAPABILITY','Original image result readback adapter unavailable; pending request retained');},
    /** Read-only recovery surface. Pending requests are not automatically replayed after host restart. */
    inspect(){return structuredClone(read());},
  };
}

import {createHash} from 'node:crypto';
import {ProtocolError,validateToolValue} from '@personal-agent/contracts';
import type {RegisteredTool,ToolContext} from '@personal-agent/contracts';
import type {CoordinationPort,CoordinationRequest,CoordinationResult} from '@personal-agent/coordination';
import type {LayaActionChoiceService} from '@personal-agent/cognition';
import {actionArgumentsDigest} from '@personal-agent/cognition';
import {proactiveWorkflowDigest} from '@personal-agent/agentarts';

export interface RuntimeProactiveDecisionToolOptions {
  localChooser?:Pick<LayaActionChoiceService,'choose'>;
  /** Original Competition coordinator already bound by trusted composition to its teacher deployment. */
  teacher?:CoordinationPort;
  /** Trusted Runtime composition carries the original Gateway run; never a model request field. */
  teacherExchange?:(request:CoordinationRequest,context:ToolContext)=>Promise<CoordinationResult>;
  readContext:(taskId:string,contextRef:string,lifetime:{deadline:string;signal:AbortSignal})=>unknown|Promise<unknown>;
  getRevision:(taskId:string)=>number;
}
export const RUNTIME_PROACTIVE_DECISION_TOOLS=Object.freeze({local:'proactive.local_decision_batch',teacher:'proactive.teacher_decision'});
const inputSchema={type:'object',additionalProperties:false,required:['contract','independentQuestions','authorityBoundary'],properties:{
  contract:{type:'object'},independentQuestions:{type:'array',minItems:1,items:{type:'object'}},authorityBoundary:{type:'string'}}};
const plain=(value:unknown):value is Record<string,unknown>=>!!value&&typeof value==='object'&&!Array.isArray(value);
const fail=(message:string):never=>{throw new ProtocolError('INVALID_ARGUMENT',message);};
const active=(context:ToolContext)=>{
  if(!context.authorizationRef||!context.scopes.includes('proactive:decision'))throw new ProtocolError('SCOPE_DENIED','Original proactive decision authorization required');
  if(context.signal.aborted)throw new ProtocolError('CANCELLED','Original proactive decision cancelled');
  if(!Number.isFinite(Date.parse(context.deadline))||Date.parse(context.deadline)<=Date.now())throw new ProtocolError('TIMEOUT','Original proactive decision expired');
};
export function createRuntimeProactiveDecisionTools(options:RuntimeProactiveDecisionToolOptions):RegisteredTool[] {
  function parse(input:unknown) {
    validateToolValue(inputSchema,input);const value=input as Record<string,unknown>,contract=value.contract;
    if(!plain(contract)||typeof contract.id!=='string'||typeof contract.version!=='string'||typeof contract.criteria!=='string'
      ||!contract.criteria.trim()||!Array.isArray(contract.candidates)||contract.candidates.length<2||contract.candidates.length>16
      ||contract.candidates.some(candidate=>!plain(candidate)||typeof candidate.id!=='string'||typeof candidate.description!=='string')
      ||new Set(contract.candidates.map(candidate=>candidate.id)).size!==contract.candidates.length)fail('Original versioned proactive decision contract required');
    const questions=value.independentQuestions as Record<string,unknown>[];
    if(questions.some(question=>!plain(question)||typeof question.itemId!=='string'||typeof question.contextRef!=='string')
      ||new Set(questions.map(question=>question.itemId)).size!==questions.length)fail('Original independent item/context bindings required');
    return {contract:contract as Record<string,unknown>&{id:string;version:string;criteria:string;candidates:{id:string;description:string}[]},
      questions:questions as (Record<string,unknown>&{itemId:string;contextRef:string})[]};
  }
  const tool=(kind:'local'|'teacher'):RegisteredTool=>({descriptor:{name:RUNTIME_PROACTIVE_DECISION_TOOLS[kind],version:'1.0.0',inputSchema,
    outputSchema:{type:'object',required:['selections'],properties:{selections:{type:'array'}}},sideEffect:'read',
    requiredScopes:['proactive:decision'],idempotencySupport:true,recoverySupport:true,requiresPresence:false},
    async execute(input,context){
      active(context);const {contract,questions}=parse(input),candidates=contract.candidates as {id:string;description:string}[];
      const observations=[];
      for(const question of questions) {
        const originalContext=await options.readContext(context.taskId,question.contextRef,{deadline:context.deadline,signal:context.signal});
        active(context);observations.push({...question,originalContext});
      }
      if(kind==='local') {
        const selections=[];
        for(const question of observations) {
          active(context);const state=JSON.stringify({criteria:contract.criteria,observation:question,sourceTextIsUntrusted:true});
          const choice=await options.localChooser!.choose({context:state,deadline:context.deadline,signal:context.signal,
            candidates:candidates.map(candidate=>({id:candidate.id,revision:1,kind:'escalate',description:candidate.description,sources:[],
              scopeRef:'proactive:'+contract.id+':'+contract.version,expiresAt:context.deadline,risk:'low',argumentsDigest:actionArgumentsDigest({})}))});
          active(context);
          if(!choice.selected||!candidates.some(candidate=>candidate.id===choice.selected!.id)
            ||choice.receipt.contextDigest!==createHash('sha256').update(state).digest('hex'))
            throw new ProtocolError('EXTERNAL_FAILURE','Local proactive candidate unavailable; original failed receipt requires teacher handling');
          // Current base weights remain unqualified. This candidate never suppresses an event or authorizes an action.
          selections.push({itemId:question.itemId,candidateId:choice.selected.id,decisionRef:choice.receipt.id,decidedBy:'laya',
            uncertain:true,complex:false,importance:'important',authorityRequired:false});
        }
        return {selections};
      }
      const request:CoordinationRequest={taskId:context.taskId,revision:options.getRevision(context.taskId),deadline:context.deadline,
        signal:context.signal,textOnly:true,goal:JSON.stringify({goal:'Compare every independent proactive item using only its original contract candidates and original context. '
          +'Return a text answer containing only JSON {"selections":[{"itemId":"original item","candidateId":"original candidate",'
          +'"uncertain":false,"complex":false,"importance":"important|normal|irrelevant","authorityRequired":false}]}. '
          +'Do not invent authorization or execution evidence. Important/conflicting or unsupported events must not be silently ignored.\n'
          +JSON.stringify({contract,independentQuestions:observations}),availableTools:[]})};
      const result=await(options.teacherExchange?options.teacherExchange(request,context):options.teacher!.execute(request));
      active(context);
      if(result.kind!=='text')throw new ProtocolError('EXTERNAL_FAILURE','Proactive teacher must return selection data only');
      let parsed:unknown;try{parsed=JSON.parse(result.text);}catch{throw new ProtocolError('EXTERNAL_FAILURE','Proactive teacher returned invalid JSON');}
      if(!plain(parsed)||Object.keys(parsed).join(',')!=='selections'||!Array.isArray(parsed.selections)
        ||parsed.selections.length!==questions.length)throw new ProtocolError('EXTERNAL_FAILURE','Proactive teacher must answer the original item set');
      const seen=new Set();
      const selections=parsed.selections.map(value=>{
        if(!plain(value)||Object.keys(value).sort().join(',')!=='authorityRequired,candidateId,complex,importance,itemId,uncertain'
          ||!questions.some(question=>question.itemId===value.itemId)||seen.has(value.itemId)||!candidates.some(candidate=>candidate.id===value.candidateId)
          ||typeof value.uncertain!=='boolean'||typeof value.complex!=='boolean'||typeof value.authorityRequired!=='boolean'
          ||!['important','normal','irrelevant'].includes(String(value.importance)))throw new ProtocolError('EXTERNAL_FAILURE','Proactive teacher changed original decision bindings');
        seen.add(value.itemId);return {...value,decidedBy:'deepseek',decisionRef:'proactive-teacher:'+proactiveWorkflowDigest({
          taskId:context.taskId,runId:context.runId,contract,selection:value})};
      });
      return {selections};
    }});
  return [...(options.localChooser?[tool('local')]:[]),...(options.teacher||options.teacherExchange?[tool('teacher')]:[])];
}

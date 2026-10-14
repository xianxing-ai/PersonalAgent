import {createHash,createHmac,timingSafeEqual} from 'node:crypto';
import {ProtocolError} from '@personal-agent/contracts';
import type {OwnedWorkflowAdvanceRequest,WorkflowProposal,WorkflowReceipt,WorkflowReceiptVerifier,
  WorkflowRevisionIdentity,WorkflowRevisionMigration} from './owned-workflows.js';

const canonical=(value:unknown):string=>{
  if(value===null||typeof value!=='object') return JSON.stringify(value);
  if(Array.isArray(value)) return '['+value.map(canonical).join(',')+']';
  const record=value as Record<string,unknown>;
  return '{'+Object.keys(record).sort().map(key=>JSON.stringify(key)+':'+canonical(record[key])).join(',')+'}';
};
const hash=(value:unknown):string=>createHash('sha256').update(canonical(value)).digest('hex');
const plain=(value:unknown):value is Record<string,unknown>=>!!value&&typeof value==='object'&&!Array.isArray(value);
const invalid=(message:string):never=>{throw new ProtocolError('INVALID_ARGUMENT',message);};
function signer(secret:string) {
  if(typeof secret!=='string'||Buffer.byteLength(secret)<32) invalid('Invalid trusted workflow receipt key');
  return (value:unknown)=>createHmac('sha256',secret).update(canonical(value)).digest('base64url');
}
function authentic(proof:unknown,sign:(value:unknown)=>string):proof is Record<string,unknown> {
  if(!plain(proof)||typeof proof.signature!=='string') return false;
  const {signature,...body}=proof;
  const expected=Buffer.from(sign(body),'base64url'),actual=Buffer.from(signature,'base64url');
  return expected.length===actual.length&&timingSafeEqual(expected,actual);
}

/** Signature checks provenance of an existing local result. It is never a Policy grant. */
export function createOwnedWorkflowReceiptVerifier(options:{secret:string}):WorkflowReceiptVerifier {
  const sign=signer(options.secret);
  return {
    async verify(receipt,expected,request) {
      const proof=receipt.proof;
      if(!authentic(proof,sign)||proof.proofVersion!=='1.0.0'||proof.kind!=='tool_receipt'
        ||expected.kind!=='tool_proposal'||proof.taskId!==request.taskId||proof.sessionId!==request.sessionId
        ||proof.workflowId!==request.workflowId&&`owned-${proof.workflowId}`!==request.workflowId
        ||proof.originControlRevision!==expected.originControlRevision||proof.nodeId!==expected.nodeId
        ||proof.operationId!==expected.operationId||proof.proposalId!==expected.proposalId
        ||proof.inputDigest!==expected.inputDigest||proof.toolName!==expected.toolName||proof.toolVersion!==expected.toolVersion
        ||proof.argumentsDigest!==hash(expected.arguments)||proof.state!==receipt.state
        ||proof.resultDigest!==hash(receipt.result)||proof.evidenceDigest!==hash(receipt.evidenceRefs)
        ||typeof proof.localTaskId!=='string'||proof.runId!==`host-tool-${proof.localTaskId}`) return false;
      return receipt.state!=='confirmed'||receipt.evidenceRefs.includes(proof.runId as string);
    },
    async verifyMigration(migration,previous,next) {
      const proof=migration.proof;
      return authentic(proof,sign)&&proof.proofVersion==='1.0.0'&&proof.kind==='revision_migration'
        &&proof.previousDigest===hash(previous)&&proof.nextDigest===hash(next)
        &&proof.invalidatedDigest===hash(migration.invalidatedNodeIds);
    },
  };
}

/** Structural projection of the existing RuntimeApplication public host-tool API, not a new executor. */
export interface WorkflowHostTaskPort {
  submitHostToolTask(request:{commandId:string;toolName:string;toolVersion:string;arguments:Record<string,unknown>;deadline:string}):{
    commandId:string;toolName:string;toolVersion:string;task:{taskId:string;state:string}};
  readHostToolTask(taskId:string):{commandId:string;toolName:string;toolVersion:string;task:{taskId:string;state:string};
    confirmed?:{runId:string;result:unknown;evidenceRefs:string[]}};
}
export interface WorkflowCheckpointPort {
  read(taskId:string,key:string):unknown;
  /** Must be backed by existing TaskRuntime.saveCheckpointOnce, not an in-memory map in production. */
  writeOnce(taskId:string,key:string,value:unknown):boolean;
}
interface HostBinding {proposal:Extract<WorkflowProposal,{kind:'tool_proposal'}>;localTaskId:string;
  taskId:string;sessionId:string;workflowId:string;controlRevision:number}

/** Host-only bridge; never expose its receipt key or signing methods in an end-user HTTP route. */
export class OwnedWorkflowHostBridge {
  private readonly sign:(value:unknown)=>string;
  constructor(private readonly options:{host:WorkflowHostTaskPort;checkpoints:WorkflowCheckpointPort;receiptSecret:string;
    /** Existing local control/TaskRuntime source must reject stale, cancelled or terminal work. */
    assertActive:(taskId:string,controlRevision:number)=>void}) {
    this.sign=signer(options.receiptSecret);
  }
  submit(request:Pick<OwnedWorkflowAdvanceRequest,'taskId'|'sessionId'|'workflowId'|'controlRevision'|'deadline'>,
    proposal:WorkflowProposal):{localTaskId:string;state:string} {
    if(proposal.kind!=='tool_proposal') throw new ProtocolError('UNSUPPORTED_CAPABILITY','Host operation needs its actual public adapter');
    const key='owned-workflow:operation:'+proposal.operationId;
    const saved=this.options.checkpoints.read(request.taskId,key);
    if(saved!==undefined) {
      const binding=saved as HostBinding;
      if(hash(binding.proposal)!==hash(proposal)||binding.taskId!==request.taskId
        ||binding.sessionId!==request.sessionId||binding.workflowId!==request.workflowId) invalid('Original operation binding changed');
      const readback=this.options.host.readHostToolTask(binding.localTaskId);
      return {localTaskId:binding.localTaskId,state:readback.task.state};
    }
    // A durable binding permits readback only. Neither a new revision nor an old submit intent
    // is permission to submit old parameters for the first time.
    this.options.assertActive(request.taskId,request.controlRevision);
    if(proposal.originControlRevision!==request.controlRevision) {
      throw new ProtocolError('REVISION_CONFLICT','Old unbound operation requires original host reconciliation; it cannot first submit in a new revision');
    }
    const intentKey='owned-workflow:intent:'+proposal.operationId;
    const proposedIntent={taskId:request.taskId,sessionId:request.sessionId,workflowId:request.workflowId,
      proposal:structuredClone(proposal),deadline:request.deadline};
    this.options.checkpoints.writeOnce(request.taskId,intentKey,proposedIntent);
    const intent=this.options.checkpoints.read(request.taskId,intentKey) as typeof proposedIntent;
    if(!intent||intent.taskId!==request.taskId||intent.sessionId!==request.sessionId||intent.workflowId!==request.workflowId
      ||hash(intent.proposal)!==hash(proposal)) invalid('Original host submit intent changed');
    const local=this.options.host.submitHostToolTask({commandId:proposal.operationId,toolName:proposal.toolName,
      toolVersion:proposal.toolVersion,arguments:structuredClone(proposal.arguments),deadline:intent.deadline});
    const binding:HostBinding={proposal:structuredClone(proposal),localTaskId:local.task.taskId,taskId:request.taskId,
      sessionId:request.sessionId,workflowId:request.workflowId,controlRevision:request.controlRevision};
    if(!this.options.checkpoints.writeOnce(request.taskId,key,binding)) {
      // commandId is stable in the original Runtime, so a concurrent/restarted submit cannot create a second execution.
      const persisted=this.options.checkpoints.read(request.taskId,key) as HostBinding;
      if(hash(persisted)!==hash(binding)) throw new ProtocolError('REVISION_CONFLICT','Concurrent host operation binding changed');
    }
    return {localTaskId:binding.localTaskId,state:local.task.state};
  }
  readReceipt(request:Pick<OwnedWorkflowAdvanceRequest,'taskId'|'sessionId'|'workflowId'|'controlRevision'>,
    proposal:WorkflowProposal):WorkflowReceipt|undefined {
    if(proposal.kind!=='tool_proposal') throw new ProtocolError('UNSUPPORTED_CAPABILITY','No generic host-operation success signer');
    const saved=this.options.checkpoints.read(request.taskId,'owned-workflow:operation:'+proposal.operationId) as HostBinding|undefined;
    if(!saved||hash(saved.proposal)!==hash(proposal)||saved.taskId!==request.taskId
      ||saved.sessionId!==request.sessionId||saved.workflowId!==request.workflowId) invalid('Original host tool binding not found');
    const binding=saved!;
    const readback=this.options.host.readHostToolTask(binding.localTaskId);
    if(readback.commandId!==proposal.operationId||readback.toolName!==proposal.toolName||readback.toolVersion!==proposal.toolVersion) {
      invalid('Host readback does not match the original tool operation');
    }
    let state:WorkflowReceipt['state'],result:unknown,evidenceRefs:string[];
    if(readback.task.state==='succeeded'&&readback.confirmed) {
      if(readback.confirmed.runId!==`host-tool-${binding.localTaskId}`||!readback.confirmed.evidenceRefs.includes(readback.confirmed.runId)) {
        invalid('Host result has no matching actual execution evidence');
      }
      state='confirmed';result=structuredClone(readback.confirmed.result);evidenceRefs=[...readback.confirmed.evidenceRefs];
    } else if(readback.task.state==='waiting_reconciliation') {state='unknown';result={localState:readback.task.state};evidenceRefs=[];}
    else if(readback.task.state==='failed') {state='failed';result={localState:readback.task.state};evidenceRefs=[];}
    else return undefined;
    const body={proofVersion:'1.0.0',kind:'tool_receipt',taskId:binding.taskId,sessionId:binding.sessionId,
      workflowId:binding.workflowId,originControlRevision:proposal.originControlRevision,nodeId:proposal.nodeId,
      proposalId:proposal.proposalId,operationId:proposal.operationId,inputDigest:proposal.inputDigest,
      toolName:proposal.toolName,toolVersion:proposal.toolVersion,argumentsDigest:hash(proposal.arguments),
      localTaskId:binding.localTaskId,runId:`host-tool-${binding.localTaskId}`,state,resultDigest:hash(result),evidenceDigest:hash(evidenceRefs)};
    return {nodeId:proposal.nodeId,proposalId:proposal.proposalId,operationId:proposal.operationId,inputDigest:proposal.inputDigest,
      state,result,evidenceRefs,proof:{...body,signature:this.sign(body)}};
  }
  migration(previous:WorkflowRevisionIdentity,next:WorkflowRevisionIdentity,invalidatedNodeIds:readonly string[]):WorkflowRevisionMigration {
    this.options.assertActive(next.taskId,next.controlRevision);
    if(previous.taskId!==next.taskId||previous.sessionId!==next.sessionId||previous.workflowId!==next.workflowId
      ||previous.templateDigest!==next.templateDigest||next.controlRevision<=previous.controlRevision) invalid('Invalid host revision migration');
    const body={proofVersion:'1.0.0',kind:'revision_migration',previousDigest:hash(previous),nextDigest:hash(next),invalidatedDigest:hash(invalidatedNodeIds)};
    return {invalidatedNodeIds:[...invalidatedNodeIds],proof:{...body,signature:this.sign(body)}};
  }
}

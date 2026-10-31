import {createHash,createPublicKey,verify} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import {ProtocolError,validateToolValue} from '@personal-agent/contracts';
import type {RegisteredTool,ToolDescriptor} from '@personal-agent/contracts';
import type {RuntimeApplication} from './runtime-application.js';
import type {RuntimeCodingRepairIndependentReviewPort} from './coding-repair-frontier.js';

const NAME='workflow.host.f15_independent_review';
const sha=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
function fail(message:string):never {throw new ProtocolError('UNAUTHORIZED',message);}
type ReviewKey={taskId:string;sessionId:string;snapshotId:string;patchDigest:string};
export interface CodingRepairSignedReview extends ReviewKey {
  version:1;reviewerId:string;authorId:string;policyId:string;decision:'approved'|'rejected';reviewedAt:string;expiresAt:string;
}
export interface CodingRepairSignedReviewEnvelope {review:CodingRepairSignedReview;signature:string}
/** Exact bytes signed by the independent reviewer; neither image nor model receives the key. */
export function codingRepairReviewBytes(review:CodingRepairSignedReview):Buffer {
  return Buffer.from(JSON.stringify({version:review.version,taskId:review.taskId,sessionId:review.sessionId,snapshotId:review.snapshotId,
    patchDigest:review.patchDigest,reviewerId:review.reviewerId,authorId:review.authorId,policyId:review.policyId,
    decision:review.decision,reviewedAt:review.reviewedAt,expiresAt:review.expiresAt}));
}
export const codingRepairReviewOperationId=(value:ReviewKey)=>'f15-review-'+sha(value);
export function codingRepairSignedReviewDescriptor():ToolDescriptor {
  return {name:NAME,version:'1.0.0',inputSchema:{type:'object',additionalProperties:false,required:['sessionId','snapshotId','patchDigest'],properties:{
    sessionId:{type:'string',minLength:1},snapshotId:{type:'string',minLength:1},patchDigest:{type:'string',pattern:'^[a-f0-9]{64}$'}}},
    outputSchema:{},sideEffect:'read',requiredScopes:['workspace:read'],idempotencySupport:false,recoverySupport:false,requiresPresence:false};
}
export interface CodingRepairSignedReviewOptions {
  reviewerId:string;authorId:string;policyId:string;publicKey:string;
  /** Trusted configuration supplies the current independent signed review. It must not sign on the model's behalf. */
  read:(key:ReviewKey)=>CodingRepairSignedReviewEnvelope|undefined;
  /** Checks the current trusted reviewer/configuration and revocation state. */
  assertCurrent:(key:ReviewKey)=>boolean;
}
/** A real Ed25519 verification host. Missing config, signed record, or current grant denies the operation. */
export function createRuntimeCodingRepairSignedReview(getApplication:()=>RuntimeApplication,options:CodingRepairSignedReviewOptions):
  {tool:RegisteredTool;port:RuntimeCodingRepairIndependentReviewPort} {
  if(!options||typeof options.read!=='function'||typeof options.assertCurrent!=='function'||!options.reviewerId?.trim()
    ||!options.authorId?.trim()||options.reviewerId===options.authorId||!options.policyId?.trim())
    throw new ProtocolError('INVALID_ARGUMENT','Independent reviewer configuration is required');
  const publicKey=createPublicKey(options.publicKey);
  if(publicKey.asymmetricKeyType!=='ed25519')throw new ProtocolError('INVALID_ARGUMENT','Independent reviewer requires Ed25519');
  const read=(key:ReviewKey)=>{
    if(options.assertCurrent(structuredClone(key))!==true)fail('Independent reviewer authorization is unavailable');
    const envelope=options.read(structuredClone(key)),review=envelope?.review;
    if(!review||review.version!==1||review.taskId!==key.taskId||review.sessionId!==key.sessionId||review.snapshotId!==key.snapshotId
      ||review.patchDigest!==key.patchDigest||review.reviewerId!==options.reviewerId||review.authorId!==options.authorId
      ||review.policyId!==options.policyId||review.decision!=='approved'||typeof envelope.signature!=='string'
      ||!Number.isFinite(Date.parse(review.reviewedAt))||!Number.isFinite(Date.parse(review.expiresAt))
      ||Date.parse(review.reviewedAt)>Date.now()||Date.parse(review.expiresAt)<=Date.now()
      ||Date.parse(review.expiresAt)<=Date.parse(review.reviewedAt))fail('Independent signed review is unavailable or changed');
    const signature=Buffer.from(envelope.signature,'base64');
    if(signature.length!==64||signature.toString('base64')!==envelope.signature||!verify(null,codingRepairReviewBytes(review),publicKey,signature))
      fail('Independent review signature is invalid');
    return review;
  };
  const descriptor=codingRepairSignedReviewDescriptor(),schema=descriptor.inputSchema;
  const tool:RegisteredTool={descriptor,async execute(value,context){
    validateToolValue(schema,value);const args=value as Omit<ReviewKey,'taskId'>,application=getApplication(),runtime=application.runtime;
    const parent=runtime.loadCheckpoint(context.taskId,'coding-repair:parent') as {taskId?:string;operationId?:string}|undefined;
    if(!parent?.taskId||!parent.operationId||context.runId!=='host-tool-'+context.taskId)fail('Original review operation binding missing');
    const key={taskId:parent.taskId,...args},operationId=codingRepairReviewOperationId(key);
    const intent=runtime.loadCheckpoint(parent.taskId,'owned-workflow:intent:'+operationId) as {taskId?:string;sessionId?:string;workflowId?:string;
      proposal?:{nodeId?:string;toolName?:string;operationId?:string;arguments?:unknown}}|undefined;
    const preflight=runtime.loadCheckpoint(parent.taskId,'coding-repair:review-preflight:'+operationId);
    if(parent.operationId!==operationId||intent?.taskId!==parent.taskId||intent.sessionId!==args.sessionId||intent.workflowId!=='F15'
      ||intent.proposal?.nodeId!=='F15_N04'||intent.proposal.toolName!==NAME||intent.proposal.operationId!==operationId
      ||!isDeepStrictEqual(intent.proposal.arguments,args)||!isDeepStrictEqual(preflight,key))fail('Original reviewed patch binding changed');
    if(context.signal.aborted||Date.now()>=Date.parse(context.deadline))throw new ProtocolError('TIMEOUT','Review operation expired');
    const result=read(key);
    return {version:1,sessionId:result.sessionId,snapshotId:result.snapshotId,patchDigest:result.patchDigest,decision:result.decision,
      reviewerId:result.reviewerId,reviewedAt:result.reviewedAt,expiresAt:result.expiresAt};
  }};
  const port:RuntimeCodingRepairIndependentReviewPort={read(input){
    const key={taskId:input.taskId,sessionId:input.sessionId,snapshotId:input.snapshotId,patchDigest:input.patchDigest};
    const operationId=codingRepairReviewOperationId(key),linked=getApplication().runtime.loadCheckpoint(input.taskId,'coding-repair:host:'+operationId) as {localTaskId?:string}|undefined;
    return linked?.localTaskId?{localTaskId:linked.localTaskId,operationId}:undefined;
  },assertCurrent(input){
    const key={taskId:input.taskId,sessionId:input.sessionId,snapshotId:input.snapshotId,patchDigest:input.patchDigest},review=read(key);
    if(input.signal.aborted||Date.now()>=Date.parse(input.deadline)||input.operationId!==codingRepairReviewOperationId(key)
      ||review.reviewerId!==input.reviewerId||review.reviewedAt!==input.reviewedAt||review.expiresAt!==input.expiresAt)
      fail('Independent review authorization changed');
  }};
  return {tool,port};
}

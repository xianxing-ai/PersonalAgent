import {createHash} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import {ProtocolError} from '@personal-agent/contracts';
import {readF16AcceptanceBytes,assertF16PreservedBytes} from './f16-acceptance-bytes.js';

const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const fail=message=>{throw new ProtocolError('UNAUTHORIZED',message);};
const key='f16:original-acceptance-bytes';

/** Internal production port assembled by F16/F17 composition, with the same graph,
 * workspace guard and original HEAD bridge. The model supplies no review evidence. */
export function createF16TestIntentPort({getApplication,root,assertCurrent,resolveScope,readHead}) {
  const captureBytes=(scope,input)=>readF16AcceptanceBytes({root,patch:input.patch,assertCurrent:()=>assertCurrent(scope)});
  const baseline=(scope,input)=>{
    assertCurrent(scope);const saved=getApplication().runtime.loadCheckpoint(scope.parentTaskId,key);
    if(!saved||saved.sessionId!==scope.sessionId||saved.deadline!==scope.deadline||!isDeepStrictEqual(saved.input,input))
      fail('Original F16 acceptance snapshot is unavailable');return saved;
  };
  async function preserved(scope,input,patch){
    const saved=baseline(scope,input),after=await captureBytes(scope,input);assertCurrent(scope);
    assertF16PreservedBytes(saved.bytes,after,input.patch,patch.result);
    return {noCheatingDetected:true,patchDigest:hash(input.patch),reviewRef:'f16-bytes:'+hash({before:saved.bytes.digest,after:after.digest}),
      policy:saved.bytes.policy,acceptanceDigest:saved.bytes.digest,workspaceDigest:after.digest};
  }
  const tool={descriptor:{name:'workflow.host.f16_n04',version:'1.0.0',sideEffect:'read',requiredScopes:['workspace:read'],
    inputSchema:{type:'object',additionalProperties:false,properties:{}},outputSchema:{type:'object',additionalProperties:false,
      required:['noCheatingDetected','patchDigest','reviewRef','policy','acceptanceDigest','workspaceDigest'],properties:{
        noCheatingDetected:{const:true},policy:{const:'unchanged-acceptance-bytes-v1'},
        ...Object.fromEntries(['patchDigest','acceptanceDigest','workspaceDigest'].map(name=>[name,{type:'string',pattern:'^[a-f0-9]{64}$'}])),
        reviewRef:{type:'string',pattern:'^f16-bytes:[a-f0-9]{64}$'}}},requiresPresence:false,idempotencySupport:false,recoverySupport:false},
    async execute(input,context){
      if(!isDeepStrictEqual(input,{})||!context.scopes.includes('workspace:read'))fail('Original F16 review scope required');
      const {scope,bound}=resolveScope(context,'F16_N04'),patch=bound.confirmedOperations.find(item=>item.nodeId==='F16_N03'&&item.toolName==='workspace.apply_text_patch');
      if(!patch)fail('Original F16 applied patch unavailable');
      const before=await readHead(scope,context,'execute');
      if(before.result.headSha!==bound.input.headSha)fail('F16 version changed before acceptance review');
      const result=await preserved(scope,bound.input,patch),after=await readHead(scope,context,'before_export');
      if(!isDeepStrictEqual(before.result,after.result))fail('F16 workspace changed during acceptance review');
      assertCurrent(scope);getApplication().runtime.saveCheckpointOnce(context.taskId,'f16:test-intent-review',result);
      if(!isDeepStrictEqual(result,getApplication().runtime.loadCheckpoint(context.taskId,'f16:test-intent-review')))
        fail('Original F16 review cannot be replaced');return result;
    }};
  return {tool,available:scope=>{try{assertCurrent({...scope,parentTaskId:scope.taskId});return true;}catch{return false;}},
    async capture(scope,context,input){
      const before=await readHead(scope,context,'execute');
      if(before.result.headSha!==input.headSha||before.result.workspaceClean!==true)fail('F16 requires the clean original failed commit');
      const bytes=await captureBytes(scope,input),after=await readHead(scope,context,'before_export');
      if(!isDeepStrictEqual(before.result,after.result))fail('F16 baseline changed during snapshot');
      const snapshot={sessionId:scope.sessionId,deadline:scope.deadline,input:structuredClone(input),head:before.result,bytes};
      const runtime=getApplication().runtime;runtime.saveCheckpointOnce(scope.parentTaskId,key,snapshot);
      if(!isDeepStrictEqual(snapshot,runtime.loadCheckpoint(scope.parentTaskId,key)))fail('Original F16 acceptance bytes changed');
    },
    async verifyReceipt({taskId,deadline,signal,input,patch,review}){
      const runtime=getApplication().runtime,saved=runtime.loadCheckpoint(taskId,key);
      if(!saved)return false;const scope={parentTaskId:taskId,sessionId:saved.sessionId,deadline,signal};
      const bound=getApplication().readConfiguredWorkflowBinding({taskId,workflowId:'F16',sessionId:saved.sessionId,signal});
      if(!bound||!isDeepStrictEqual(bound.input,input)||![patch,review].every(item=>bound.confirmedOperations.some(original=>isDeepStrictEqual(original,item)))
        ||review.toolName!==tool.descriptor.name||!isDeepStrictEqual(runtime.loadCheckpoint(review.localTaskId,'f16:test-intent-review'),review.result))return false;
      return isDeepStrictEqual(await preserved(scope,input,patch),review.result);
    },
    async assertReceiptCurrent({scope,input,patch,result}){
      if(!patch||!isDeepStrictEqual(await preserved(scope,input,patch),result))fail('F16 acceptance changed during export consent');
    },
    readBaseline:baseline};
}

import {createHash} from 'node:crypto';
import {ProtocolError,validateToolValue} from '@personal-agent/contracts';
import {createOwnedWorkflowAdapter} from '@personal-agent/agentarts';
import {connectorResultProjectionSchema} from './connector-result-projection.js';

const plain=value=>!!value&&typeof value==='object'&&!Array.isArray(value);
const fail=message=>{throw new ProtocolError('UNAUTHORIZED',message);};
const canonical=value=>value===null||typeof value!=='object'?JSON.stringify(value):Array.isArray(value)
  ?'['+value.map(canonical).join(',')+']'
  :'{'+Object.keys(value).sort().map(key=>JSON.stringify(key)+':'+canonical(value[key])).join(',')+'}';
const hash=value=>createHash('sha256').update(canonical(value)).digest('hex');

/** Composition-only: source access must be revalidated against the original
 * feeds lease. Graph receipt export still needs its own exact authorization. */
export function createF09FeedGraphHost({application,getApplication,collectTool,assertFeedAccess}={}) {
  if((typeof getApplication!=='function'&&(!application?.runtime||typeof application.readHostToolTask!=='function'))
    ||collectTool?.descriptor?.name!=='feeds.collect'||typeof collectTool.descriptor.version!=='string'
    ||typeof assertFeedAccess!=='function')return {tools:[],unavailable:'trusted_feed_runtime_and_access_required'};
  const resolveApplication=typeof getApplication==='function'?getApplication:()=>application;
  const sourceSchema=connectorResultProjectionSchema(collectTool.descriptor.outputSchema);
  const itemSchema=sourceSchema?.properties?.items?.items;
  if(!plain(itemSchema))return {tools:[],unavailable:'feed_item_projection_unavailable'};
  const readBinding=(context,sourceOperationId)=>{
    const application=resolveApplication(),runtime=application?.runtime;
    if(!runtime||typeof application.readHostToolTask!=='function')fail('Original F09 Runtime is unavailable');
    const parent=runtime.loadCheckpoint(context.taskId,'coding-repair:parent');
    if(!plain(parent)||typeof parent.taskId!=='string'||typeof parent.operationId!=='string')fail('Original graph host binding unavailable');
    const task=runtime.getTask(parent.taskId);
    if(task.cancelRequested||['cancelled','failed','succeeded'].includes(task.state))fail('Original graph task is no longer active');
    const current=runtime.loadCheckpoint(parent.taskId,'owned-workflow:intent:'+parent.operationId);
    const currentHost=runtime.loadCheckpoint(context.taskId,'host-tool-intent');
    const source=runtime.loadCheckpoint(parent.taskId,'owned-workflow:operation:'+sourceOperationId);
    const submitted=runtime.loadCheckpoint(parent.taskId,'coding-repair:host:'+sourceOperationId);
    if(!plain(current)||current.taskId!==parent.taskId||current.workflowId!=='F09'
      ||current.proposal?.nodeId!=='F09_N02'||current.proposal?.toolName!=='workflow.host.f09_n02'
      ||current.proposal?.operationId!==parent.operationId||current.proposal?.arguments?.sourceOperationId!==sourceOperationId
      ||currentHost?.commandId!==parent.operationId||currentHost?.toolName!=='workflow.host.f09_n02'
      ||canonical(currentHost?.arguments)!==canonical(current.proposal.arguments)
      ||!plain(source)||source.taskId!==parent.taskId||source.workflowId!=='F09'||source.sessionId!==current.sessionId
      ||source.proposal?.nodeId!=='F09_N01'||source.proposal?.operationId!==sourceOperationId
      ||source.proposal?.toolName!=='feeds.collect'||source.proposal?.toolVersion!==collectTool.descriptor.version
      ||!plain(submitted)||submitted.localTaskId!==source.localTaskId
      ||canonical(runtime.loadCheckpoint(source.localTaskId,'coding-repair:parent'))!==canonical({taskId:parent.taskId,operationId:sourceOperationId})
      ||submitted.request?.commandId!==sourceOperationId||submitted.request?.toolName!=='feeds.collect'
      ||canonical(submitted.request?.arguments)!==canonical(source.proposal.arguments))fail('Original F09 source operation binding changed');
    const back=application.readHostToolTask(source.localTaskId);
    if(back.commandId!==sourceOperationId||back.toolName!=='feeds.collect'||back.toolVersion!==collectTool.descriptor.version
      ||back.task?.state!=='succeeded'||!back.confirmed||back.confirmed.runId!=='host-tool-'+source.localTaskId
      ||!Array.isArray(back.confirmed.evidenceRefs)||!back.confirmed.evidenceRefs.includes(back.confirmed.runId))
      fail('Original F09 source has no confirmed local receipt');
    return {parentTaskId:parent.taskId,sourceTaskId:source.localTaskId,sourceOperationId,result:back.confirmed.result};
  };
  const tool=createOwnedWorkflowAdapter({nodeId:'F09_N02',kind:'host',sideEffect:'read',requiredScopes:['feeds:read'],
    inputSchema:{type:'object',additionalProperties:false,required:['sourceOperationId'],properties:{
      sourceOperationId:{type:'string',minLength:1,maxLength:256}}},
    outputSchema:{type:'object',additionalProperties:false,required:['uniqueCount','duplicateDiscarded','candidates','hasMore','nextCursor'],properties:{
      uniqueCount:{type:'integer',minimum:0},duplicateDiscarded:{type:'integer',minimum:0},
      candidates:{type:'array',maxItems:sourceSchema.properties.items.maxItems,items:itemSchema},
      hasMore:{type:'boolean'},nextCursor:{type:'string'}}},
    async execute(input,context){
      const binding=readBinding(context,input.sourceOperationId);
      if(await assertFeedAccess({...binding,context})!==true)fail('Original feed access is unavailable');
      const checked=readBinding(context,input.sourceOperationId);
      if(canonical(binding)!==canonical(checked))fail('Original F09 source changed during authorization');
      validateToolValue(sourceSchema,checked.result);
      const seen=new Set(),candidates=[];
      for(const item of checked.result.items){
        // Deduplicate exact complete records only. Different content/revisions
        // under the same feed key remain separate for downstream conflict handling.
        const key=hash(item);if(seen.has(key))continue;seen.add(key);candidates.push(structuredClone(item));
      }
      return {uniqueCount:candidates.length,duplicateDiscarded:checked.result.items.length-candidates.length,
        candidates,hasMore:checked.result.hasMore,nextCursor:checked.result.nextCursor};
    }});
  return {tools:[tool],unavailable:null};
}

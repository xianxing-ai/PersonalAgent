// Fixed shapes of projectCodingRepairResult. The original ToolGateway receipt
// and parser stay authoritative; these schemas only permit the redacted output.
const string={type:'string'},id={type:'string',minLength:1},boolean={type:'boolean'},version={const:1};
const array=items=>({type:'array',items});
const object=(properties,optional=[])=>({type:'object',properties,additionalProperties:false,
  required:Object.keys(properties).filter(key=>!optional.includes(key))});
const sha={anyOf:[{type:'null'},{type:'string',pattern:'^[a-f0-9]{64}$'}]};
const file=object({path:id,sha256:sha,packageId:id,kind:{enum:['source','test','config','lock','other']}});
const snapshot=object({snapshotId:id,files:array(file),packages:array(object({id,path:string,dependencies:array(id)}))});
const session=object({version,sessionId:id,taskId:id,workspaceId:id,mode:{enum:['main','isolated']},baselineSnapshotId:id});
const verification=object({version,sessionId:id,runId:id,recipeId:id,packageIds:array(id),inputSnapshotId:id,
  files:array(file),exitCode:{anyOf:[{type:'integer'},{type:'null'}]},status:{enum:['VALID','STALE','FAILED','UNKNOWN']},
  evidenceRefs:array(id),diagnostics:{type:'array',maxItems:0,items:{type:'null'}},packageGraphDigest:{type:'string',pattern:'^[a-f0-9]{64}$'}},['packageGraphDigest']);
const publish=object({version,sessionId:id,state:{enum:['published','conflict','unknown','not_started']},
  files:array(object({path:id,beforeSha256:sha,afterSha256:sha})),evidenceRefs:array(id)});
const patch={path:id,beforeSha256:sha,afterSha256:sha,changed:boolean};
const shapes={
  start:object({version,session,initialSnapshot:snapshot,recipes:array(object({recipeId:id,packageIds:array(id),required:boolean}))}),
  snapshot,
  readback:object({version,sessionId:id,snapshot,verification:array(verification)}),
  verify:verification,
  publish,
  preview:object({sessionId:id,approved:boolean,previewed:boolean,patches:array(object(patch))}),
  patch:object({...patch,applied:boolean}),
  read:object({path:id,encoding:{const:'utf-8'},byteLength:{type:'integer',minimum:0},sha256:sha,read:boolean}),
  list:object({path:id,entries:array(object({name:id,kind:{enum:['file','directory']}})),truncated:boolean}),
  reconcile:object({state:{enum:['clear','in_progress','unknown']},delivery:publish},['delivery']),
};
shapes.check=shapes.readback;
export function workspaceWorkflowSummaryProjectionSchema() {
  return object({workflowId:{const:'F15'},state:{const:'settled'},mode:{enum:['main','isolated']},confirmedOperations:{type:'integer',minimum:0}});
}
export function workspaceRepairProjectionSchema(operation) {
  const schema=shapes[operation];if(!schema)throw Error('工作区没有固定元数据投影');return structuredClone(schema);
}

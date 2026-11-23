import {workspaceRepairProjectionSchema} from './workspace-result-projection.js';
import {F20_VERIFIED_COMPLETION} from '@personal-agent/contracts/f20-candidate';
const text={type:'string'},id={type:'string',minLength:1},digest={type:'string',pattern:'^[a-f0-9]{64}$'};
const object=properties=>({type:'object',properties,required:Object.keys(properties),additionalProperties:false});
export const f20InputProjectionSchema=()=>object(Object.fromEntries(['schemaFile','codeFile','recipeId','docTemplate','targetDoc','sourceVersion'].map(key=>[key,text])));
export const f20CompletionProjectionSchema=()=>object(Object.fromEntries(
  Object.entries(F20_VERIFIED_COMPLETION).map(([key,value])=>[key,{const:value}])
));
export function f20TrialProjectionSchema(){
  const checkReadback=workspaceRepairProjectionSchema('readback');
  checkReadback.properties.verification.items.properties.diagnostics={type:'array',items:object({source:{const:'command'},
    message:{const:'Original verification returned diagnostics; inspect its trusted local record'}})};
  return object({binding:object({version:{const:1},taskId:id,workspaceId:id,baselineSnapshotId:id,inputDigest:digest,
    configurationDigest:digest,workflowVersion:id,runtimeVersion:id,recipeFingerprint:digest,executionKind:{const:'real_host'},
    candidateId:id,artifactId:id,sessionId:id,trialTaskId:id,artifactDigest:digest,parentArtifactDigests:{type:'array',maxItems:0,items:digest}}),
    session:workspaceRepairProjectionSchema('start').properties.session,checkReadback});
}

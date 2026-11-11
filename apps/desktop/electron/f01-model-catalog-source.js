import {createHash} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import {ProtocolError} from '@personal-agent/contracts';

const digest=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const unavailable=()=>{throw new ProtocolError('UNSUPPORTED_CAPABILITY','F01 原 AgentArts 模型目录不可用');};

/** Current AgentArts declarations are conditional metadata, never a substitute
 * ModelGateway or proof of native tools, streaming, vision or structured output. */
export function createF01ModelCatalogSource({getApplication,models,readDeploymentBinding,assertCurrent}) {
  const current=scope=>{const result=assertCurrent(scope);if(result!==undefined){void Promise.resolve(result).catch(()=>{});return unavailable();}};
  return scope=>{
    current(scope);
    const application=getApplication(),original=application?.readF01ContextBinding({taskId:scope.parentTaskId,sessionId:scope.sessionId,signal:scope.signal});
    if(!original?.selection||original.binding.deadline!==scope.deadline)return unavailable();
    const deployment=readDeploymentBinding(),snapshot=models.snapshot(),selection=original.selection;
    if(typeof deployment!=='string'||!deployment||!snapshot.available||snapshot.catalog?.revision!==selection.catalogRevision
      ||!isDeepStrictEqual(models.resolveExecutionModel(selection),selection))return unavailable();
    const entry=snapshot.catalog.models.find(model=>model.id===selection.modelId);
    if(!entry||entry.type!=='text'||!['available','unverified'].includes(entry.availability))return unavailable();
    const value={kind:'agentarts_catalog',revision:digest([deployment,original.destination,selection,entry]),models:[{
      id:entry.id,verification:'conditional',type:'text',availability:entry.availability,requestProfile:entry.requestProfile,
      reasoningEfforts:[...entry.reasoningEfforts],...(entry.route?{route:entry.route}:{}),
      ...(selection.reasoningEffort===undefined?{}:{selectedReasoningEffort:selection.reasoningEffort})}]};
    current(scope);
    if(getApplication()!==application||readDeploymentBinding()!==deployment||!isDeepStrictEqual(models.snapshot(),snapshot)
      ||!isDeepStrictEqual(application.readF01ContextBinding({taskId:scope.parentTaskId,sessionId:scope.sessionId,signal:scope.signal}),original))return unavailable();
    return value;
  };
}

import {readFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import path from 'node:path';
import {ProtocolError} from '@personal-agent/contracts';
import {correlatePinnedReadonlyTool,bindPlatformEvaluationToOutputs,recordCompetitionPublishChain,planOwnedImageBuild,correlateOwnedImageControlPlane} from '@personal-agent/agentarts';
import {createPlatformServices} from './platform-services.mjs';
import {createWorkflowShadowController} from './shadow-controller.mjs';
import {createProactiveWorkflowController} from './proactive-controller.mjs';

const plain=value=>value&&typeof value==='object'&&!Array.isArray(value);
const bad=()=>{throw new ProtocolError('INVALID_ARGUMENT','Invalid trusted image service configuration');};
/** Loaded only from operator startup configuration, never from an invocation. */
export async function loadImageServiceConfiguration({configurationFile,adapterFile}={}) {
  const config=configurationFile?JSON.parse(await readFile(configurationFile,'utf8')):{};
  if(!plain(config)||Object.keys(config).some(key=>!['platform','shadowPolicy','proactive'].includes(key)))bad();
  let ports={};
  if(adapterFile!==undefined) {
    if(typeof adapterFile!=='string'||!path.isAbsolute(adapterFile))bad();
    const module=await import(pathToFileURL(adapterFile).href);
    if(typeof module.createTrustedPlatformPorts!=='function')bad();
    ports=await module.createTrustedPlatformPorts();
    if(!plain(ports))bad();
  }
  return {...config,trustedPlatformPorts:ports};
}

/** Functions/credentials come from trusted startup ports, never request JSON. */
export function createImageServices({receiptSecret,platform={},shadowPolicy,proactive={},trustedPlatformPorts={},onStage}={}) {
  if(!plain(platform)||!plain(trustedPlatformPorts))bad();
  const services=createPlatformServices({...platform,...trustedPlatformPorts,
    ...((platform.mcp||trustedPlatformPorts.mcp)?{mcp:{...platform.mcp,...trustedPlatformPorts.mcp}}:{}),
    ...((platform.knowledge||trustedPlatformPorts.knowledge)?{knowledge:{...platform.knowledge,...trustedPlatformPorts.knowledge}}:{}),
    ...((platform.observation||trustedPlatformPorts.observation)?{observation:{...platform.observation,...trustedPlatformPorts.observation}}:{})});
  const shadow=shadowPolicy?createWorkflowShadowController({receiptSecret,policyConfig:shadowPolicy}):undefined;
  if(!plain(proactive)||Object.keys(proactive).some(key=>key!=='decisionContracts'))bad();
  const proactiveController=receiptSecret?createProactiveWorkflowController({receiptSecret,decisionContracts:proactive.decisionContracts??[],onStage}):undefined;
  const exact=(value,keys)=>plain(value)&&Object.keys(value).length===keys.length&&keys.every(key=>Object.hasOwn(value,key));
  const unavailable=(message)=>{throw new ProtocolError('UNSUPPORTED_CAPABILITY',message);};
  const surfaceStatus=()=>{const status=services.status();return {knowledge:status.knowledge,mcp:status.mcp,trace:status.observation,evaluation:status.evaluation};};
  const platformController=async({value,...context})=>{
    if(!plain(value)||value.platformVersion!==1)bad();
    const {platformVersion:_,...operation}=value;
    if(operation.operation==='list') {
      if(Object.keys(operation).length!==1)bad();
      const listed=services.list();
      return {platformVersion:1,verification:'unverified',...listed,operations:[...listed.operations,
        'pinned_readonly.correlate','evaluation.bind','publish.record','deployment.build_plan','deployment.correlate_readback']};
    }
    if(operation.operation==='pinned_readonly.correlate') {
      if(!exact(operation,['operation','arguments']))bad();
      const ports=trustedPlatformPorts.pinnedReadonly;
      if(!ports)unavailable('Pinned readonly ports are not configured');
      return {platformVersion:1,verification:'unverified',result:await correlatePinnedReadonlyTool({...ports,surfaceStatus},operation,context)};
    }
    if(operation.operation==='evaluation.bind'||operation.operation==='publish.record') {
      if(!exact(operation,['operation']))bad();
      const ports=trustedPlatformPorts.evaluationBinding;
      if(!ports?.readOriginalOutputs||!ports.readPlatformResult)unavailable('Platform evaluation binding ports are not configured');
      const outputs=await ports.readOriginalOutputs(context);
      const platform=await ports.readPlatformResult(context)??undefined;
      const evaluation=bindPlatformEvaluationToOutputs({deployment:ports.deployment,outputs,platform});
      if(operation.operation==='evaluation.bind')return {platformVersion:1,verification:'unverified',result:evaluation};
      const consumerReadback=ports.readConsumer?await ports.readConsumer(context):undefined;
      return {platformVersion:1,verification:'unverified',result:recordCompetitionPublishChain({deployment:ports.deployment,evaluation,consumerReadback})};
    }
    if(operation.operation==='deployment.build_plan'||operation.operation==='deployment.correlate_readback') {
      if(!exact(operation,['operation']))bad();
      const ports=trustedPlatformPorts.imageBuild;
      if(!ports?.planInput||!ports.expectedDeployment)unavailable('Owned image build plan is not configured');
      const build=planOwnedImageBuild(ports.planInput);
      if(operation.operation==='deployment.build_plan')return {platformVersion:1,verification:'unverified',result:build};
      const readback=ports.readControlPlane?await ports.readControlPlane(context):undefined;
      return {platformVersion:1,verification:'unverified',result:correlateOwnedImageControlPlane(build,ports.expectedDeployment,readback)};
    }
    return {platformVersion:1,verification:'unverified',result:await services.execute(operation,context)};
  };
  return {controllers:{platformVersion:platformController,...(shadow?{shadowVersion:shadow}:{}),...(proactiveController?{proactiveVersion:proactiveController}:{})},
    status:()=>({platform:services.status(),shadow:shadow?'configured_not_verified':'unavailable_missing_trusted_policy',
      proactive:proactiveController?'host_receipts_required':'unavailable_missing_host_secret'}),
    close:()=>services.close()};
}

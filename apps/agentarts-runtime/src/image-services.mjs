import {readFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import path from 'node:path';
import {ProtocolError} from '@personal-agent/contracts';
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
  const platformController=async({value,...context})=>{
    if(!plain(value)||value.platformVersion!==1)bad();
    const {platformVersion:_,...operation}=value;
    if(operation.operation==='list') {
      if(Object.keys(operation).length!==1)bad();
      return {platformVersion:1,verification:'unverified',...services.list()};
    }
    return {platformVersion:1,verification:'unverified',result:await services.execute(operation,context)};
  };
  return {controllers:{platformVersion:platformController,...(shadow?{shadowVersion:shadow}:{}),...(proactiveController?{proactiveVersion:proactiveController}:{})},
    status:()=>({platform:services.status(),shadow:shadow?'configured_not_verified':'unavailable_missing_trusted_policy',
      proactive:proactiveController?'host_receipts_required':'unavailable_missing_host_secret'}),
    close:()=>services.close()};
}

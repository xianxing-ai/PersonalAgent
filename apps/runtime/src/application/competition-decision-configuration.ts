import {isDeepStrictEqual} from 'node:util';
import {ProtocolError} from '@personal-agent/contracts';
import {parseExecutionModelSelection,type ExecutionModelSelection} from '@personal-agent/coordination';
import type {TaskRuntime} from '../index.js';
import {readRuntimeWorkflowShadowConfiguration} from './workflow-shadow-configuration.js';

export interface CompetitionDecisionConfigurationBinding {
  configuration:{configurationId:string;revision:number;version:string;parametersDigest:string};
  executionModel:ExecutionModelSelection;
}

/** F23's concrete consumer is F03 candidate generation through the existing cloud
 * execution-model registry. This is a local selection, never a remote deployment write. */
export function createCompetitionDecisionConfigurationConsumer(options:{
  runtime:TaskRuntime;namespace:string;stateKey:string;configurationId:string;
  resolveExecutionModel:(selection:ExecutionModelSelection)=>ExecutionModelSelection;
}) {
  const fail=():never=>{throw new ProtocolError('REVISION_CONFLICT','Original Competition decision configuration unavailable');};
  function read(revision?:number):CompetitionDecisionConfigurationBinding|undefined {
    const value=readRuntimeWorkflowShadowConfiguration(options.runtime,options.namespace,options.stateKey,options.configurationId,revision);
    if(!value)return undefined;
    const parameters=parseExecutionModelSelection(value.parameters),executionModel=options.resolveExecutionModel(parameters);
    if(!isDeepStrictEqual(parameters,executionModel))return fail();
    const {configurationId,version,parametersDigest}=value;
    return {configuration:{configurationId,revision:value.revision,version,parametersDigest},executionModel};
  }
  return Object.freeze({
    read,
    assertCurrent(binding:CompetitionDecisionConfigurationBinding){
      if(!binding||binding.configuration.configurationId!==options.configurationId
        ||!isDeepStrictEqual(read(binding.configuration.revision),binding))fail();
    },
  });
}

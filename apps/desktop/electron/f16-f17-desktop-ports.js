import {createHash} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import {ProtocolError} from '@personal-agent/contracts';
import {createF16F17WorkflowPorts} from './f16-f17-workflow-ports.js';
import {findF17InitialFailure} from './f17-initial-failure-source.js';

const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const fail=()=>{throw new ProtocolError('UNAUTHORIZED','F16/F17 原任务、case 或开发工作区绑定已变化');};

/** Actual Desktop source adapter. Consume the existing workspace, developer deployment,
 * native case selection and Runtime; create neither commands nor approval providers. */
export function createDesktopF16F17WorkflowPorts({runtimeModule,getApplication,codingWorkspace,developerDeployment,
  caseConfiguration,authorizeExport,now=()=>new Date()}={}) {
  const missing=reason=>({tools:[],configuredWorkflowWorkerPorts:[],unavailable:[reason]});
  const configuration=codingWorkspace?.readDeveloperConfiguration?.(),deployment=developerDeployment?.snapshot?.();
  const host=developerDeployment?.host;
  const commandTool=host?.tools?.find(tool=>tool.descriptor.name==='workspace.run_allowed_command'&&tool.descriptor.version==='1.0.0');
  const headTool=host?.tools?.find(tool=>tool.descriptor.name==='workspace.git.head'&&tool.descriptor.version==='1.0.0');
  if(!configuration?.command?.recipeIds?.length||!commandTool||!headTool||!host?.competitionToolAvailability
    ||deployment?.configured!==true||deployment.state!=='configured'||!deployment.repository
    ||typeof getApplication!=='function'||typeof caseConfiguration?.read!=='function'||typeof authorizeExport!=='function')
    return missing('f16_f17_workspace_deployment_case_or_consent_unavailable');
  const pins={bindingId:configuration.bindingId,root:configuration.rootPath,repository:deployment.repository,
    recipes:[...configuration.command.recipeIds],descriptor:structuredClone(commandTool.descriptor)};
  const current=(workflow,scope)=>{
    const application=getApplication(),latest=codingWorkspace.readDeveloperConfiguration(),status=developerDeployment.snapshot();
    if(!application||scope.signal?.aborted||!Number.isFinite(Date.parse(scope.deadline))||now().getTime()>=Date.parse(scope.deadline)
      ||status.configured!==true||status.state!=='configured'||status.repository!==pins.repository
      ||latest?.bindingId!==pins.bindingId||latest.rootPath!==pins.root||!isDeepStrictEqual(latest.command?.recipeIds,pins.recipes)
      ||host.tools.find(tool=>tool.descriptor.name==='workspace.run_allowed_command')!==commandTool
      ||host.tools.find(tool=>tool.descriptor.name==='workspace.git.head')!==headTool
      ||!isDeepStrictEqual(commandTool.descriptor,pins.descriptor))fail();
    const task=application.runtime.getTask(scope.taskId);
    if(task.cancelRequested||!['running','waiting_approval'].includes(task.state)
      ||application.runtime.loadCheckpoint(scope.taskId,'application-deadline')!==scope.deadline
      ||!application.readToolConversation(scope.taskId))fail();
    latest.assertCurrent(scope);
    const selected=caseConfiguration.read(workflow,scope);
    if(!selected||selected.selection.repository!==pins.repository||!pins.recipes.includes(selected.selection.recipeId))fail();
    const binding={...pins,caseRef:selected.configurationRef};
    const saved=application.runtime.loadCheckpoint(scope.taskId,'f16-f17:desktop-source:'+workflow);
    if(saved!==undefined&&!isDeepStrictEqual(saved,binding))fail();
    return {application,selected,binding};
  };
  const available=async(workflow,scope)=>{
    try{
      current(workflow,scope);
      for(const tool of [headTool,commandTool]){
        const bindings=host.competitionToolAvailability.filter(value=>value.toolName===tool.descriptor.name&&value.toolVersion===tool.descriptor.version);
        if(bindings.length!==1||await bindings[0].available(scope)!==true)return false;
      }
      current(workflow,scope);
      // The catalog is fixed before the task's first command. Receipt qualification
      // belongs in resolveInput; advertising a configured port grants no execution.
      return workflow==='F17';
    }catch{return false;}
  };
  const workspace={root:pins.root,commandTool,recipes:pins.recipes.map(id=>({id,configurationRef:hash(pins)})),
    patchReconciliation:codingWorkspace.patchReconciliation,available,
    assertCurrent(workflow,scope){current(workflow,scope);},
    async readSelection(workflow,scope){
      const {application,selected,binding}=current(workflow,scope);
      const value=workflow==='F17'?findF17InitialFailure(application,scope,selected.selection):undefined;
      if(!value)return undefined;
      application.runtime.saveCheckpointOnce(scope.taskId,'f16-f17:desktop-source:'+workflow,binding);current(workflow,scope);
      return {...value,configurationRef:selected.configurationRef};
    }};
  const ports=createF16F17WorkflowPorts({runtimeModule,getApplication,workspace,
    authority:{available,assertCurrent:workspace.assertCurrent},authorizeExport,now});
  // No production service currently proves preserved test intent or emits the repaired CI identity.
  // F15's signed review and Laya's advisory choice cannot be relabelled as that proof.
  if(!ports.unavailable.includes('f16_test_intent_verifier_unavailable'))ports.unavailable.push('f16_test_intent_verifier_unavailable');
  ports.unavailable.push('f16_repaired_ci_identity_recipe_unavailable');
  return ports;
}

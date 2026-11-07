import {createHash} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import {ProtocolError,validateToolValue} from '@personal-agent/contracts';
import {F16_PUBLICATION_SCHEMA} from './f16-publication-host.js';
import {createF16F17WorkflowPorts} from './f16-f17-workflow-ports.js';
import {findF17InitialFailure} from './f17-initial-failure-source.js';

const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const fail=()=>{throw new ProtocolError('UNAUTHORIZED','F16/F17 原任务、case 或开发工作区绑定已变化');};

/** Actual Desktop source adapter. Consume the existing workspace, developer deployment,
 * native case selection and Runtime; create neither commands nor approval providers. */
export function createDesktopF16F17WorkflowPorts({runtimeModule,getApplication,codingWorkspace,developerDeployment,
  caseConfiguration,authorizeExport,requestPresence,now=()=>new Date()}={}) {
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
  const gitConfiguration=host.readF16PublicationConfiguration?.();
  const publicationTools=['workspace.git.commit','workspace.git.push','workspace.git.read_publication'];
  const publicationReady=Boolean(typeof requestPresence==='function'&&gitConfiguration&&gitConfiguration.repository===pins.repository&&gitConfiguration.rootPath===pins.root
    &&/^(?:agent|codex|repair)\//.test(gitConfiguration.sourceBranch)&&typeof host.configureF16Publication==='function'
    &&publicationTools.every(name=>host.tools.some(tool=>tool.descriptor.name===name&&tool.descriptor.version==='1.0.0')));
  const current=(workflow,scope)=>{
    const application=getApplication(),latest=codingWorkspace.readDeveloperConfiguration(),status=developerDeployment.snapshot();
    if(!application||scope.signal?.aborted||!Number.isFinite(Date.parse(scope.deadline))||now().getTime()>=Date.parse(scope.deadline)
      ||status.configured!==true||status.state!=='configured'||status.repository!==pins.repository
      ||latest?.bindingId!==pins.bindingId||latest.rootPath!==pins.root||!isDeepStrictEqual(latest.command?.recipeIds,pins.recipes)
      ||host.tools.find(tool=>tool.descriptor.name==='workspace.run_allowed_command')!==commandTool
      ||host.tools.find(tool=>tool.descriptor.name==='workspace.git.head')!==headTool
      ||!isDeepStrictEqual(commandTool.descriptor,pins.descriptor))fail();
    const task=application.runtime.getTask(scope.taskId);
    if(task.cancelRequested||!['running','waiting_approval','waiting_reconciliation'].includes(task.state)
      ||application.runtime.loadCheckpoint(scope.taskId,'application-deadline')!==scope.deadline
      ||!application.readToolConversation(scope.taskId))fail();
    latest.assertCurrent(scope);
    const selected=caseConfiguration.read(workflow,scope);
    if(!selected||selected.selection.repository!==pins.repository||!pins.recipes.includes(selected.selection.recipeId))fail();
    const binding={...pins,caseRef:selected.configurationRef,...(workflow==='F16'&&publicationReady?{publicationConfiguration:gitConfiguration}:{})};
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
      if(workflow==='F16'){
        if(!publicationReady)return false;
        for(const name of [...publicationTools,'github.actions.run.list','github.actions.job.list','github.actions.log.read']){
          const entries=host.competitionToolAvailability.filter(value=>value.toolName===name);
          if(entries.length!==1||await entries[0].available(scope)!==true)return false;
        }
        const selected=current(workflow,scope).selected.selection;
        validateToolValue(F16_PUBLICATION_SCHEMA,selected.publication);
        assertPublication(selected,{...scope,parentTaskId:scope.taskId});
      }
      return true;
    }catch{return false;}
  };
  const workspace={root:pins.root,commandTool,recipes:pins.recipes.map(id=>({id,configurationRef:hash(pins)})),
    patchReconciliation:codingWorkspace.patchReconciliation,available,
    assertCurrent(workflow,scope){current(workflow,scope);},
    async readSelection(workflow,scope){
      const {application,selected,binding}=current(workflow,scope);
      const value=workflow==='F17'?findF17InitialFailure(application,scope,selected.selection):selected.selection;
      if(!value)return undefined;
      application.runtime.saveCheckpointOnce(scope.taskId,'f16-f17:desktop-source:'+workflow,binding);current(workflow,scope);
      return {...value,configurationRef:selected.configurationRef};
    }};
  const assertPublication=(input,scope)=>{
    current('F16',{taskId:scope.parentTaskId,deadline:scope.deadline,signal:scope.signal});
    if(!publicationReady||!isDeepStrictEqual(host.readF16PublicationConfiguration({taskId:scope.parentTaskId,deadline:scope.deadline,signal:scope.signal}),gitConfiguration)
      ||input.repository!==gitConfiguration.repository||input.publication?.createNewBranch!==true
      ||input.publication.branch!==gitConfiguration.sourceBranch||!gitConfiguration.allowedPaths.includes(input.patch.path))fail();
    validateToolValue(F16_PUBLICATION_SCHEMA,input.publication);
  };
  const ports=createF16F17WorkflowPorts({runtimeModule,getApplication,workspace,
    authority:{available,assertCurrent:workspace.assertCurrent},authorizeExport,
    f16TestIntent:'preserved-bytes',f16CiIdentityRecipe:'github-readback',
    ...(publicationReady?{f16Publication:{assertCurrent:assertPublication,installGitPort:port=>host.configureF16Publication(port),
      configurationRef:hash(gitConfiguration),requestPresence}}:{}),now});
  if(!publicationReady){ports.configuredWorkflowWorkerPorts=ports.configuredWorkflowWorkerPorts.filter(port=>port.workflowId!=='F16');
    ports.unavailable.push('f16_ci_publication_tool_chain_unavailable');}
  return ports;
}

import {getOwnedWorkflowTemplates,getOwnedWorkflowAdapterRequirements,createWorkflowDecisionTool,getOwnedWorkflowDesignCoverage} from '@personal-agent/agentarts';
import {writeFile} from 'node:fs/promises';
const destination=new URL('../../docs/competition/workflow-wiring.json',import.meta.url);
const decisionTool=createWorkflowDecisionTool({selector:{select:async()=>{throw Error('Manifest export never invokes a model');}}});
const workflows=getOwnedWorkflowTemplates().map(template=>({...template,
  requiredTools:[...new Set(template.nodes.flatMap(node=>node.capabilities.filter(cap=>cap.kind==='tool').map(cap=>cap.name)))],
  adapterRequirements:getOwnedWorkflowAdapterRequirements().filter(item=>item.workflowId===template.workflowId)}));
await writeFile(destination,JSON.stringify({schemaVersion:'1.0.0',profile:'huawei_ict_agentarts',execution:'serial',
  decisionLocation:'local_runtime',decisionTool:decisionTool.descriptor,designCoverage:getOwnedWorkflowDesignCoverage(),verification:'unverified',workflows},null,2)+'\n');
process.stdout.write(JSON.stringify({workflowCount:workflows.length,nodeCount:workflows.reduce((count,workflow)=>count+workflow.nodes.length,0),
  externalAdapterCount:getOwnedWorkflowAdapterRequirements().length})+'\n');

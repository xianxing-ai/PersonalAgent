// These are original F15 graph nodes, consumed through coding.repair.workflow.
const codingNodes=new Set([
  'coding.repair.start','coding.repair.list','coding.repair.read','coding.repair.snapshot',
  'coding.repair.preview','coding.repair.patch','coding.repair.verify','coding.repair.check',
  'coding.repair.publish','coding.repair.reconcile','workspace.coding_snapshot',
  'workflow.host.f15_n04','workflow.host.f15_n05','workflow.host.f15_n06',
]);
const commandAliases=new Set(['workspace.git_diff_check','workspace.node_check','workspace.npm_build','workspace.npm_test']);

/** Visibility is trusted composition metadata, never a grant or a second registry.
 * Graph bindings keep their readiness. Fixed command aliases remain a fallback
 * when the task cannot use the canonical command; registration alone is not readiness.
 */
export function createConversationToolSurface({profile,tools,competitionToolAvailability}) {
  if(profile!=='huawei_ict_agentarts'||!Array.isArray(tools)||!Array.isArray(competitionToolAvailability))throw Error('Trusted Competition profile, registered tools and availability are required');
  const names=new Set(tools.map(tool=>tool.descriptor.name));
  const command=names.has('workspace.run_allowed_command')
    ?competitionToolAvailability.find(binding=>binding.toolName==='workspace.run_allowed_command'):undefined;
  return competitionToolAvailability.map(binding=>{
    if(command&&commandAliases.has(binding.toolName))return {...binding,async available(scope){
      if(await binding.available(scope)!==true)return false;
      try{return await command.available(scope)!==true;}catch{return true;}
    }};
    return {...binding,...(codingNodes.has(binding.toolName)?{modelExposure:'internal'}:{})};
  });
}

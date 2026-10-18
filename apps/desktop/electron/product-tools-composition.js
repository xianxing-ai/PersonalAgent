/** Trusted main-process composition. No provider calls or execution loop at setup. */
export function createProductToolsComposition({modules = {}, connectors = {}, workspace,
  systemObservation = false, exports = [], now = Date.now} = {}) {
  const tools = [];
  const disposers = [];
  const unavailable = [];
  let active = true;
  const missing = (capability, reason) => unavailable.push(Object.freeze({capability, reason}));
  // This temporary collector only adapts package register(host); Runtime owns execution.
  const host = {register(tool) {
    if (tools.some(item => item.descriptor.name === tool.descriptor.name)) throw Error('Duplicate product tool');
    const guarded = {...tool, execute: (input, context) => {
      if (!active) throw Error('Product tools are closed');
      return tool.execute(input, context);
    }};
    tools.push(guarded);
    return () => { const index = tools.indexOf(guarded); if (index >= 0) tools.splice(index, 1); };
  }};
  const add = (name, factory, options) => {
    if (typeof factory !== 'function') { missing(name, 'public_factory_unavailable'); return; }
    disposers.push(host.register(factory(options)));
  };
  try {
    for (const name of ['weather', 'research', 'feeds', 'mail', 'calendar']) {
      const config = connectors[name];
      if (!config?.enabled) { missing(name, 'not_configured'); continue; }
      if (!config.options?.provider || !['conditional', 'verified'].includes(config.options.provider.verification)) {
        missing(name, 'real_provider_required'); continue;
      }
      if (typeof config.available !== 'function') { missing(name, 'host_readiness_required'); continue; }
      if (typeof modules[name]?.register !== 'function') { missing(name, 'public_register_unavailable'); continue; }
      disposers.push(modules[name].register(host, config.options));
    }
    if (workspace?.approved === true && typeof workspace.options?.rootPath === 'string'
      && typeof workspace.available === 'function') {
      const coding = modules.coding ?? {};
      if (workspace.read !== false) add('workspace.read_text', coding.createWorkspaceReadTool, workspace.options);
      add('workspace.list_entries', coding.createWorkspaceListTool, workspace.options);
      add('workspace.preview_text_patch', coding.createWorkspacePatchPreviewTool, workspace.options);
      if (workspace.writeApproved === true) {
        add('workspace.stage_text_patch', coding.createWorkspacePatchStageTool, workspace.options);
        if (workspace.apply?.recoveryRootPath && workspace.apply?.powerShellPath
          && workspace.apply?.recoveryAccessVerified === true) {
        add('workspace.apply_text_patch', coding.createWorkspacePatchApplyTool,
          {...workspace.options, ...workspace.apply, rootPath: workspace.options.rootPath});
        } else missing('workspace.apply_text_patch', 'verified_recovery_access_and_helper_required');
      } else missing('workspace.write', 'workspace_write_not_approved');
      if (workspace.commandApproved === true && workspace.command?.recipes?.length) {
        add('workspace.run_allowed_command', coding.createWorkspaceCommandTool,
          {...workspace.options, ...workspace.command, rootPath: workspace.options.rootPath});
      } else missing('workspace.run_allowed_command', 'approved_host_recipes_required');
      if(workspace.writeApproved===true&&workspace.commandApproved===true&&workspace.repair?.host
        &&typeof workspace.repair.available==='function'&&typeof coding.createIsolatedCodingRepairTools==='function') {
        const repair=coding.createIsolatedCodingRepairTools(workspace.repair.host);
        for(const tool of repair)disposers.push(host.register(tool));
        for(const [source,name] of [['snapshot','workspace.coding_snapshot'],['preview','workflow.host.f15_n04'],
          ['check','workflow.host.f15_n05'],['publish','workflow.host.f15_n06']]) {
          const tool=repair.find(item=>item.descriptor.name==='coding.repair.'+source);
          if(!tool)throw Error('Missing isolated coding adapter');
          disposers.push(host.register({...tool,descriptor:{...tool.descriptor,name}}));
        }
      }else missing('coding.repair.workflow','trusted_isolated_host_and_current_workspace_scope_required');
    } else missing('workspace', 'approved_workspace_required');
    if (systemObservation) add('computer.system.observe', modules.windows?.createSystemObservationTool, {});
    else missing('computer.system.observe', 'not_enabled');
    missing('computer.execute', 'native_host_target_binding_required');
  } catch (error) {
    for (const dispose of disposers.reverse()) { try { dispose(); } catch {} }
    throw error;
  }
  const registered = Object.freeze([...tools]);
  const ready = async (tool, context) => {
    if (!active || context.signal?.aborted || !Number.isFinite(Date.parse(context.deadline))
      || now() >= Date.parse(context.deadline)) return false;
    const family = tool.descriptor.name.split('.')[0];
    const repair=tool.descriptor.name.startsWith('coding.repair.')||tool.descriptor.name.startsWith('workflow.host.f15_')||tool.descriptor.name==='workspace.coding_snapshot';
    const check=repair?workspace?.repair?.available:family === 'workspace' ? workspace?.available : connectors[family]?.available;
    try { return check ? await check(context) === true : family === 'computer'; } catch { return false; }
  };
  const competitionToolAvailability = registered.map(tool => ({toolName: tool.descriptor.name,
    toolVersion: tool.descriptor.version, available: context => ready(tool, context)}));
  // An explicit host policy is required even for read results; never export raw private data by default.
  const competitionToolExports = [];
  try { for (const policy of exports) {
    const tool = registered.find(item => item.descriptor.name === policy.toolName
      && item.descriptor.version === policy.toolVersion);
    if (!tool || typeof policy.accepts !== 'function' || typeof policy.project !== 'function'
      || typeof policy.exportPolicyVersion !== 'string' || !policy.exportPolicyVersion) {
      throw Error('Invalid product result export policy');
    }
    competitionToolExports.push({...policy,
      accepts: input => active && policy.accepts(input),
      project: async input => {
        if (!active || input.signal?.aborted) throw Error('Product result export is unavailable');
        return policy.project(input);
      }});
  } } catch (error) {
    active = false;
    for (const dispose of disposers.reverse()) { try { dispose(); } catch {} }
    throw error;
  }
  const close = () => {
    if (!active) return;
    active = false;
    const errors = [];
    for (const dispose of disposers.reverse()) { try { dispose(); } catch (error) { errors.push(error); } }
    if (errors.length) throw new AggregateError(errors, 'Product tool cleanup failed');
  };
  return Object.freeze({tools: registered, competitionToolAvailability: Object.freeze(competitionToolAvailability),
    competitionToolExports: Object.freeze(competitionToolExports), unavailable: Object.freeze(unavailable), close});
}

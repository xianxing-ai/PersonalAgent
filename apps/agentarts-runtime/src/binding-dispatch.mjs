import {ProtocolError} from '@personal-agent/contracts';

const VERSION = '1.0.0';
const WORKFLOW_VERSION = '1.0.0';
const record = value => value && typeof value === 'object' && !Array.isArray(value);
const invalid = () => {throw new ProtocolError('INVALID_ARGUMENT','Invalid owned binding invocation');};
const unsupported = () => {throw new ProtocolError('UNSUPPORTED_CAPABILITY','Owned binding unavailable');};
const sameKeys = (value,keys) => Object.keys(value).length === keys.length && keys.every(key=>Object.hasOwn(value,key));
const text = (value,max) => typeof value === 'string' && value.trim() && Buffer.byteLength(value,'utf8') <= max;

/** Trusted startup catalog only; never read Studio exports or caller-provided code. */
export function createBindingDispatcher({orchestrator,getBindings,defaultControllerId}) {
  if (getBindings !== undefined && typeof getBindings !== 'function') invalid();
  const getter = getBindings ?? (typeof orchestrator.getBindings === 'function' ? ()=>orchestrator.getBindings() : undefined);
  const catalog = getter?.();
  if (catalog !== undefined && (!Array.isArray(catalog) || catalog.length > 32)) invalid();
  const ids = new Set();
  const bindings = (catalog ?? []).map(binding=>{
    if (!record(binding) || !sameKeys(binding,['id','name','type','roles','origin','requirements'])
      || !text(binding.id,128) || !/^[A-Za-z0-9_-]+$/.test(binding.id) || ids.has(binding.id)
      || !text(binding.name,256) || !['workflow','controller'].includes(binding.type)
      || !['migrated','new-owned-binding'].includes(binding.origin)
      || !Array.isArray(binding.roles) || binding.roles.length > 4
      || binding.roles.some(role=>!['fast','world','plan','review'].includes(role))
      || !Array.isArray(binding.requirements) || binding.requirements.length > 16
      || binding.requirements.some(requirement=>!text(requirement,128))) invalid();
    ids.add(binding.id);
    return {...binding,roles:[...binding.roles],requirements:[...binding.requirements]};
  });
  const available = getter !== undefined && typeof orchestrator.invokeWorkflow === 'function'
    && typeof orchestrator.invokeController === 'function';
  const graphMethods = typeof orchestrator.invokeOwnedWorkflow === 'function'
    && typeof orchestrator.getOwnedWorkflowCatalog === 'function' && typeof orchestrator.getOwnedWorkflowTemplate === 'function';
  const workflowBindings = graphMethods ? orchestrator.getOwnedWorkflowCatalog() : [];
  if (!Array.isArray(workflowBindings) || workflowBindings.length > 28
    || new Set(workflowBindings.map(item=>item.workflowId)).size !== workflowBindings.length
    || workflowBindings.some(item=>!record(item) || item.workflowVersion!==WORKFLOW_VERSION
      || !/^F(?:0[1-9]|1[0-9]|2[0-8])$/.test(item.workflowId) || item.id!==`owned-${item.workflowId}`
      || !text(item.templateVersion,128) || !/^[a-f0-9]{64}$/.test(item.templateDigest))) invalid();
  const graphAvailable = graphMethods && workflowBindings.length===28;
  const find = (id,type) => bindings.find(binding=>binding.id===id && binding.type===type);
  if (defaultControllerId !== undefined && (!available || typeof defaultControllerId !== 'string'
    || !find(defaultControllerId,'controller'))) invalid();
  const parse = query => {
    let value;
    try {value = JSON.parse(query);} catch {
      if (/^[\s]*\{/.test(query) && /"bindingVersion"\s*:/.test(query)) invalid();
      return undefined;
    }
    if (record(value) && Object.hasOwn(value,'workflowVersion')) {
      if (Buffer.byteLength(query,'utf8')>1_100_000 || value.workflowVersion!==WORKFLOW_VERSION
        || !['catalog','advance'].includes(value.operation)) invalid();
      if (!graphAvailable) unsupported();
      const allowed=value.operation==='catalog' ? ['workflowVersion','operation','workflowId']
        : ['workflowVersion','operation','workflowId','taskId','controlRevision','input','availableTools',
          'checkpoint','receipts','mode','snapshot','migration','resolvedValues','hostControl','taskDeadline'];
      if (Object.keys(value).some(key=>!allowed.includes(key))) invalid();
      if (value.operation==='advance' && (!['workflowVersion','operation','workflowId','taskId','controlRevision','input','availableTools']
        .every(key=>Object.hasOwn(value,key)) || !Number.isSafeInteger(value.controlRevision) || value.controlRevision<0
        || !text(value.taskId,128) || !Array.isArray(value.availableTools))) invalid();
      if (value.workflowId!==undefined && !workflowBindings.some(item=>item.workflowId===value.workflowId||item.id===value.workflowId)) unsupported();
      if (value.operation==='advance' && value.workflowId===undefined) invalid();
      return {workflow:true,workflowEnvelope:value};
    }
    if (!record(value) || (!Object.hasOwn(value,'bindingVersion')
      && !['workflow','controller'].includes(value.type))) return undefined;
    if (Buffer.byteLength(query,'utf8') > 1_100_000 || value.bindingVersion !== VERSION
      || !['workflow','controller'].includes(value.type) || !text(value.id,128)
      || !text(value.query,1_100_000)) invalid();
    const allowed = ['bindingVersion','type','id','query','world','plan'];
    if (Object.keys(value).some(key=>!allowed.includes(key))) invalid();
    if (!available) unsupported();
    const binding = find(value.id,value.type);
    if (!binding) unsupported();
    for (const [field,requirement] of [['world','world_report'],['plan','plan_report']]) {
      const required = binding.requirements.includes(requirement);
      if (required !== Object.hasOwn(value,field)) invalid();
      // Match core call/reportCopy's UTF-16 JSON budget for stage interoperability.
      // The enclosing binding query still has its independent UTF-8/body bound.
      if (required && (!record(value[field]) || JSON.stringify(value[field]).length > 16_000)) invalid();
    }
    return {envelope:value,binding};
  };
  const validateOutput = (output,binding) => {
    const identity = {id:binding.id,name:binding.name,type:binding.type,origin:binding.origin};
    if (!record(output) || !sameKeys(output,['bindingVersion','binding','verification','result'])
      || output.bindingVersion !== VERSION || output.verification !== 'unverified'
      || !record(output.binding) || !sameKeys(output.binding,Object.keys(identity))
      || Object.entries(identity).some(([key,value])=>output.binding[key]!==value)
      || !record(output.result)) throw new ProtocolError('EXTERNAL_FAILURE','Invalid owned binding result');
    if (output.result.kind === 'application_result') {
      if (!sameKeys(output.result,['kind','value']) || !record(output.result.value)
        || !['text','tool_proposal','repair_candidate'].includes(output.result.value.kind)
        || Object.hasOwn(output.result.value,'verification')) throw new ProtocolError('EXTERNAL_FAILURE','Invalid owned binding result');
    } else if (output.result.kind !== 'role_report' || binding.type !== 'workflow'
      || !sameKeys(output.result,['kind','role','value']) || !['world','plan'].includes(output.result.role)
      || binding.roles.length !== 1 || binding.roles[0] !== output.result.role || !record(output.result.value)) {
      throw new ProtocolError('EXTERNAL_FAILURE','Invalid owned binding result');
    }
    return output;
  };
  const dispatch = async (request,binding,envelope) => {
    if (!available) unsupported();
    const invocation = {...request,query:envelope?.query ?? request.query};
    const output = binding.type === 'workflow'
      ? await orchestrator.invokeWorkflow({...invocation,workflowId:binding.id,
        ...(Object.hasOwn(envelope,'world') ? {world:envelope.world} : {}),
        ...(Object.hasOwn(envelope,'plan') ? {plan:envelope.plan} : {})})
      : await orchestrator.invokeController({...invocation,controllerId:binding.id});
    return validateOutput(output,binding);
  };
  return {
    parse,
    directory() {
      if (!available) unsupported();
      return {bindingVersion:VERSION,verification:'unverified',bindings:bindings.map(binding=>({...binding,
        roles:[...binding.roles],requirements:[...binding.requirements]})),
        ...(graphAvailable?{workflowVersion:WORKFLOW_VERSION,workflowBindings:structuredClone(workflowBindings),
          controls:{version:WORKFLOW_VERSION,actions:['pause','resume','continue','notify_controller','request_controller','request_user'],
            originalDeadline:'taskDeadline',authority:'trusted_host_signature',repairAlgorithm:'awaiting_owner_design'}}:{})};
    },
    async invoke(request,parsed) {
      if (!parsed.workflow) return dispatch(request,parsed.binding,parsed.envelope);
      const value=parsed.workflowEnvelope;
      if (value.operation==='catalog') {
        const template=value.workflowId===undefined?undefined:orchestrator.getOwnedWorkflowTemplate(value.workflowId);
        if (value.workflowId!==undefined&&!template) unsupported();
        return {workflowVersion:WORKFLOW_VERSION,verification:'unverified',workflowBindings:structuredClone(workflowBindings),
          ...(typeof orchestrator.getOwnedWorkflowDesignCoverage==='function'
            ?{designCoverage:orchestrator.getOwnedWorkflowDesignCoverage()}:{}),
          ...(typeof orchestrator.getOwnedWorkflowAdapterRequirements==='function'
            ?{adapterRequirements:orchestrator.getOwnedWorkflowAdapterRequirements().filter(item=>!template||item.workflowId===template.workflowId)}:{}),
          ...(template?{template}:{})};
      }
      const {workflowVersion:_version,operation:_operation,...payload}=value;
      const output=await orchestrator.invokeOwnedWorkflow({...payload,deadline:request.deadline,signal:request.signal,
        sessionId:request.sessionId,requestId:request.requestId});
      const identity=workflowBindings.find(item=>item.workflowId===output?.workflowId);
      if (!record(output) || output.workflowVersion!==WORKFLOW_VERSION || output.verification!=='unverified'
        || !identity || output.templateVersion!==identity.templateVersion || output.templateDigest!==identity.templateDigest
        || !['progress','awaiting_host','unavailable','failed','unknown','cancelled','settled','paused','awaiting_controller','awaiting_user'].includes(output.state)
        || typeof output.checkpoint!=='string' || !record(output.nodes) || !Array.isArray(output.proposals)
        || !Array.isArray(output.unavailable) || !Array.isArray(output.feedback)) {
        throw new ProtocolError('EXTERNAL_FAILURE','Invalid owned workflow graph result');
      }
      return output;
    },
    async invokeDefault(request) {
      if (defaultControllerId === undefined) return orchestrator.invoke(request);
      const output = await dispatch(request,find(defaultControllerId,'controller'));
      if (output.result.kind !== 'application_result') throw new ProtocolError('EXTERNAL_FAILURE','Default controller has no application result');
      return output.result.value;
    },
  };
}

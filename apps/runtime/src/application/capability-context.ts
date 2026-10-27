/** Public, bounded diagnostics only. Registration/readiness never grants execution authority. */
export function capabilityContext(input: {
  profile:string;
  registered:readonly {name:string;version:string}[];
  available?:readonly {name:string;version:string}[];
  discoveryCandidates?:readonly {name:string;version:string}[];
  errorCodes:readonly (string|undefined)[];
  catalogReadFailed?:boolean;
  executionProgress?:{windowEndStep:number;extensions:number;originalReceiptCount:number;recentPriorCount:number;omittedCount:number;
    nextProposalId?:string};
}):string {
  const ready=new Set(input.available?.map(item=>JSON.stringify([item.name,item.version])));
  const candidates=new Set(input.discoveryCandidates?.map(item=>JSON.stringify([item.name,item.version])));
  const suggestions:Record<string,string>={
    TIMEOUT:'An operation reported a timeout. Check the task status and deadline before creating a new request.',
    RESULT_UNKNOWN:'Verify the original execution receipt before retrying; do not repeat a possible write.',
    UNAUTHORIZED:'Check this task’s scope and approval; registration does not grant permission.',
    UNSUPPORTED_CAPABILITY:'Check the current deployment and connector configuration for this capability.',
    EXTERNAL_FAILURE:'Inspect the connector or service health; do not infer that a write was not performed.',
    CANCELLED:'An operation reported cancellation. Check its task status and any unresolved effects.',
  };
  const limit=32;
  const discoveryAvailable=ready.has(JSON.stringify(['capability.search','1.0.0']));
  const paged=discoveryAvailable&&[...candidates].some(identity=>!ready.has(identity));
  // Literal host-owned semantics, never copied from a tool schema description or
  // external result. Presence success and per-tool authorization are separate.
  const computerAccess=input.profile==='huawei_ict_agentarts'
    &&input.registered.some(item=>item.name==='computer.request_access'&&item.version==='1.0.0')?{
      toolName:'computer.request_access',toolVersion:'1.0.0',
      successfulStates:['policy_allowed','presence_confirmed'],
      authorizationGrantedFalseMeans:'This access step succeeded but does not grant permission to later tools; Runtime and Policy authorize each later tool separately.',
      afterSuccess:'Continue the original requested computer task with the next tool and fresh target references. Do not request access again solely because authorizationGranted is false.',
      requestAgainOnlyAfter:'The access receipt expires, is revoked, or a later tool explicitly reports missing current access. Do not replay an unknown write.',
      grantsPermission:false,
    }:undefined;
  return JSON.stringify({capabilityStatus:{profile:input.profile,authorization:'checked_on_invocation',
    itemsRole:'bounded_diagnostics_sample',
    toolCatalogSource:input.available===undefined
      ?'This request does not publish availableTools. Diagnostic items do not create a callable catalog.'
      :'Use this request\'s availableTools for callable names, versions and input schemas. items is only a bounded diagnostic sample; an omitted item is not evidence that the tool is unavailable. This note never grants execution permission.',
    registeredCount:input.registered.length,
    ...(input.available===undefined?{}:{currentPageCount:input.available.length}),
    catalogState:input.catalogReadFailed?'read_failed':input.available===undefined?'not_checked':paged?'paged':'checked',
    items:input.registered.slice(0,limit).map(item=>{
      const identity=JSON.stringify([item.name,item.version]);
      const status=input.available===undefined?'registered':ready.has(identity)?'available':paged&&candidates.has(identity)?'not_in_current_page':'unavailable';
      return {name:item.name,version:item.version,status,
        ...(status==='unavailable'?{reasonCode:'READINESS_NOT_CONFIRMED',
          suggestion:'Check connector configuration, current availability and task scope; the exact reason is unknown.'}:{}),
        ...(status==='not_in_current_page'?{reasonCode:'USE_CAPABILITY_SEARCH',suggestion:'Search the original task directory to select this tool page; permission is checked on invocation.'}:{})};
    }),truncated:input.registered.length>limit,...(computerAccess?{computerAccess}:{}),
    ...(discoveryAvailable?{discovery:{toolName:'capability.search',toolVersion:'1.0.0',grantsPermission:false}}:{}),
    ...(input.executionProgress?{executionProgress:{...input.executionProgress,
      history:'Older tool results remain in the original Runtime. Re-read necessary files or state through the current tools; counts and summaries do not prove goal completion.',
      proposalIdentity:'Every new tool action needs a proposalId never used earlier in this task, including omitted history. Prefer nextProposalId when supplied. A previous ID with changed arguments is rejected; an identical previous proposal only replays its confirmed result. These hints grant no execution permission.'}}:{}),
    recentProblems:[...new Set(input.errorCodes.filter((code):code is string=>typeof code==='string'&&Object.hasOwn(suggestions,code)))].slice(-4)
      .map(code=>({code,suggestion:suggestions[code]}))}});
}

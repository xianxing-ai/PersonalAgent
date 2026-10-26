/** Public, bounded diagnostics only. Registration/readiness never grants execution authority. */
export function capabilityContext(input: {
  profile:string;
  registered:readonly {name:string;version:string}[];
  available?:readonly {name:string;version:string}[];
  errorCodes:readonly (string|undefined)[];
  catalogReadFailed?:boolean;
}):string {
  const ready=new Set(input.available?.map(item=>JSON.stringify([item.name,item.version])));
  const suggestions:Record<string,string>={
    TIMEOUT:'An operation reported a timeout. Check the task status and deadline before creating a new request.',
    RESULT_UNKNOWN:'Verify the original execution receipt before retrying; do not repeat a possible write.',
    UNAUTHORIZED:'Check this task’s scope and approval; registration does not grant permission.',
    UNSUPPORTED_CAPABILITY:'Check the current deployment and connector configuration for this capability.',
    EXTERNAL_FAILURE:'Inspect the connector or service health; do not infer that a write was not performed.',
    CANCELLED:'An operation reported cancellation. Check its task status and any unresolved effects.',
  };
  const limit=32;
  return JSON.stringify({capabilityStatus:{profile:input.profile,authorization:'checked_on_invocation',
    catalogState:input.catalogReadFailed?'read_failed':input.available===undefined?'not_checked':'checked',
    items:input.registered.slice(0,limit).map(item=>{
      const status=input.available===undefined?'registered':ready.has(JSON.stringify([item.name,item.version]))?'available':'unavailable';
      return {name:item.name,version:item.version,status,
        ...(status==='unavailable'?{reasonCode:'READINESS_NOT_CONFIRMED',
          suggestion:'Check connector configuration, current availability and task scope; the exact reason is unknown.'}:{})};
    }),truncated:input.registered.length>limit,
    recentProblems:[...new Set(input.errorCodes.filter((code):code is string=>typeof code==='string'&&Object.hasOwn(suggestions,code)))].slice(-4)
      .map(code=>({code,suggestion:suggestions[code]}))}});
}

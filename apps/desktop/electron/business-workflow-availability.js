import {createHash} from 'node:crypto';

/** Read the configured account/device and the original Todo lease; this grants no operation. */
export function createBusinessWorkflowAvailability({namespace,getApplication,todoHost,notificationHost,
  readCalendarBinding,readMailBinding,readKnowledgeBinding,deviceAvailable}) {
  const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
  return (workflowId,scope)=>{
    try {
      if(!getApplication()?.runtime||scope.signal.aborted)return {ready:false};
      if(workflowId==='F06'){
        const availability=todoHost?.competitionToolAvailability?.find(item=>item.toolName==='todo.create');
        if(availability?.available(scope)!==true||notificationHost?.snapshot().available!==true||deviceAvailable()!==true)
          return {ready:false};
        const policy=notificationHost.getInterruptionPolicy({kind:'connector',connectorId:'productivity'});
        return {ready:true,bindingId:hash({namespace,workflowId,policy})};
      }
      if(workflowId==='F07'||workflowId==='F11'){
        const binding=readCalendarBinding();
        if(!binding||typeof binding.accountRef!=='string'||!binding.accountRef||!binding.calendarUrl
          ||!Number.isSafeInteger(binding.revision))return {ready:false};
        if(workflowId==='F11'&&todoHost?.competitionToolAvailability?.find(item=>item.toolName==='todo.update')?.available(scope)!==true)
          return {ready:false};
        return {ready:true,bindingId:hash({namespace,workflowId,binding})};
      }
      if(workflowId==='F12'){
        if(notificationHost?.snapshot().available!==true)return {ready:false};
        // The original host owns item-scoped policy and actual device outcomes.
        // A local digest remains readable when native banners are unsupported.
        return {ready:true,bindingId:hash({namespace,workflowId,bannerSupported:deviceAvailable()===true})};
      }
      if(workflowId==='F08'){
        const mail=readMailBinding?.(),knowledge=readKnowledgeBinding?.();
        if(typeof mail?.configurationRef!=='string'||!mail.configurationRef||knowledge?.available!==true
          ||knowledge.cloudExportAllowed!==true||knowledge.dataLevel!=='public'
          ||typeof knowledge.sourceId!=='string'||!knowledge.sourceId||typeof knowledge.namespace!=='string'||!knowledge.namespace
          ||!Number.isSafeInteger(knowledge.configRevision)||knowledge.configRevision<1||!Array.isArray(knowledge.publicQueries))return {ready:false};
        return {ready:true,bindingId:hash({namespace,workflowId,mail:mail.configurationRef,
          knowledge:{namespace:knowledge.namespace,sourceId:knowledge.sourceId,configRevision:knowledge.configRevision,
            publicQueries:knowledge.publicQueries}})};
      }
      return {ready:false};
    }catch{return {ready:false};}
  };
}

import {createHash} from 'node:crypto';

/** Read the configured account/device and the original Todo lease; this grants no operation. */
export function createBusinessWorkflowAvailability({namespace,getApplication,todoHost,notificationHost,
  readCalendarBinding,deviceAvailable}) {
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
      if(workflowId==='F07'){
        const binding=readCalendarBinding();
        if(!binding||typeof binding.accountRef!=='string'||!binding.accountRef||!binding.calendarUrl
          ||!Number.isSafeInteger(binding.revision))return {ready:false};
        return {ready:true,bindingId:hash({namespace,workflowId,binding})};
      }
      return {ready:false};
    }catch{return {ready:false};}
  };
}

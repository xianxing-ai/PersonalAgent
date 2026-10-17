// Trusted test-host composition over existing public MOD exports. No connector backend copies.
import {register as registerMail} from '@personal-agent/mail';
import {register as registerResearch} from '@personal-agent/research';
import {register as registerNotifications} from '@personal-agent/notifications';
export function createTestVersionBusinessTools({mail,research,notifications,tools=[]}={}) {
  const registered=[],disposers=[],states=[];
  const host={register(tool){
    if(!tool?.descriptor?.name||!tool.descriptor.version||typeof tool.execute!=='function')throw Error('Invalid actual tool');
    if(registered.some(t=>t.descriptor.name===tool.descriptor.name))throw Error(`Duplicate actual tool: ${tool.descriptor.name}`);
    registered.push(tool);return()=>{const index=registered.indexOf(tool);if(index>=0)registered.splice(index,1);};
  }};
  try {
    tools.forEach(tool=>host.register(tool));
    // Reject collisions before a module creates a connector or mutates a supplied registry.
    const names=[...(mail?['mail.inbox','mail.accounts','mail.mark_seen',
      ...(mail.provider?.saveDraft?['mail.save_draft']:[]),...(mail.provider?.reconcileSend?['mail.reconcile_send']:[])]:[]),
      ...(research?['research.search']:[]),...(notifications?['notifications.status']:[])];
    for(const name of names)if(registered.some(tool=>tool.descriptor.name===name))throw Error(`Duplicate actual tool: ${name}`);
    if(mail) {disposers.push(registerMail(host,mail));states.push({module:'MOD-21',state:'registered_not_live_verified',
      tools:registered.filter(t=>t.descriptor.name.startsWith('mail.')).map(t=>t.descriptor.name)});}
    else states.push({module:'MOD-21',state:'unavailable',reason:'No explicitly supplied account provider'});
    if(research) {disposers.push(registerResearch(host,research));states.push({module:'MOD-24',state:'registered_not_live_verified',
      tools:registered.filter(t=>t.descriptor.name.startsWith('research.')).map(t=>t.descriptor.name)});}
    else states.push({module:'MOD-24',state:'unavailable',reason:'No explicitly supplied research provider'});
    if(notifications) {disposers.push(registerNotifications(host,notifications));states.push({module:'MOD-23',state:'registered_not_live_verified',
      tools:['notifications.status']});}
    else states.push({module:'MOD-23',state:'unavailable',reason:'No explicitly supplied notification storage and policy'});
  }catch(error){disposers.reverse().forEach(dispose=>dispose());registered.length=0;throw error;}
  let disposed=false;
  return {tools:registered,states,dispose:()=>{
    if(disposed)return;disposed=true;
    try {disposers.reverse().forEach(dispose=>dispose());}finally {registered.length=0;}
  }};
}

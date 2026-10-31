import {Page} from '@jackwener/opencli/browser/page';
import {projectOpenCliPage,checkOpenCliControl,operateOpenCliControl} from './opencli-browser-host.js';

// Trusted parent selects from fixed operations. Page code/CLI/CDP are never model arguments.
let page,session,busy=false;
process.on('disconnect',()=>process.exit(0));
process.on('message',async message=>{
  if(busy||!Number.isSafeInteger(message?.id)||typeof message.session!=='string'||!Array.isArray(message.args))return;
  busy=true;
  try {
    if(session&&session!==message.session)throw Error('Session changed');
    session=message.session;page??=new Page(session,undefined,undefined,'foreground','browser');
    let value;
    if(message.method==='newTab'){
      value=await page.newTab(...message.args);
      if(typeof value!=='string')throw Error('Missing page identity');
      page.setActivePage(value);
      const origin=new URL(message.args[0]).origin,deadline=Date.parse(message.deadline);
      let ready=false;
      while(Date.now()<deadline){
        // Read-only readiness polling; creating/navigating the tab is never retried.
        let state;try{state=await page.evaluate(()=>({url:location.href,origin:location.origin,state:document.readyState}));}catch{}
        if(state?.origin===origin&&state.state!=='loading'){ready=true;break;}
        if(state?.url&&state.url!=='about:blank'&&state.origin!==origin)throw Error('Unexpected origin');
        await new Promise(resolve=>setTimeout(resolve,50));
      }
      if(!ready)throw Error('Page readiness deadline');
    }
    else if(message.method==='project')value=await page.evaluate(projectOpenCliPage,...message.args);
    else if(message.method==='check')value=await page.evaluate(checkOpenCliControl,...message.args);
    else if(message.method==='operate')value=await page.evaluate(operateOpenCliControl,...message.args);
    else throw Error('Unsupported operation');
    process.send?.({id:message.id,ok:true,value});
  }catch{process.send?.({id:message.id,ok:false});}
  finally{busy=false;}
});

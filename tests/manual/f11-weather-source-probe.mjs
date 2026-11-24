import {mkdirSync,writeFileSync} from 'node:fs';
import {WeatherService,OpenMeteoProvider} from '@personal-agent/weather';

// Explicit public synthetic location, no user location, account, credential or cloud model.
// This verifies the provider only; original Policy/graph consumption has separate tests.
if(!process.argv.includes('--allow-public-read'))throw Error('Pass --allow-public-read for the public OpenMeteo probe');
const directory=new URL('../../.cache/pr531-business/',import.meta.url);mkdirSync(directory,{recursive:true});
const query={location:'Beijing',date:new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit'})
  .format(new Date(Date.now()+86400000)),units:'metric'};
const startedAt=new Date().toISOString();
let evidence;
try{
  const service=new WeatherService({provider:new OpenMeteoProvider({locationResolution:'strict'}),now:Date.now});
  const result=await service.getForecast(query,AbortSignal.timeout(25000));
  evidence={kind:'public-synthetic-openmeteo-read',startedAt,finishedAt:new Date().toISOString(),query,state:'verified',
    providerVerification:service.providerVerification,policyGraphVerified:false,calendarAccountVerified:false,cloudGraphVerified:false,result};
}catch(error){
  evidence={kind:'public-synthetic-openmeteo-read',startedAt,finishedAt:new Date().toISOString(),query,state:'unavailable',
    policyGraphVerified:false,calendarAccountVerified:false,cloudGraphVerified:false,error:{code:error.code??error.name,message:error.message}};
  process.exitCode=1;
}
const file=new URL('f11-weather-live-'+startedAt.replaceAll(':','-')+'.json',directory);
writeFileSync(file,JSON.stringify(evidence,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({state:evidence.state,query,file:file.pathname,error:evidence.error}));

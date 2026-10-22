import {existsSync,readFileSync,mkdirSync,writeFileSync,renameSync} from 'node:fs';
import path from 'node:path';
import {randomUUID} from 'node:crypto';

const terminal=new Set(['succeeded','failed','cancelled','waiting_reconciliation']);
/** Desktop projection only: the existing Runtime/Policy/ToolGateway performs every fetch. */
export function createWeatherCardHost({userData,getApplication,readToolVersion,onUpdate=()=>{},now=Date.now}){
  const file=path.join(userData,'weather-card.json');let location='',operation,result,failure='',timer,closed=false;
  try{if(existsSync(file)){const saved=JSON.parse(readFileSync(file,'utf8'));if(saved.version===1&&validLocation(saved.location))location=saved.location;}}catch{failure='天气地点配置读取失败，请重新设置';}
  function validLocation(value){return typeof value==='string'&&value.trim()===value&&value.length>0&&value.length<=100&&!/[\u0000-\u001f\u007f]/u.test(value);}
  function read(){
    if(!operation)return;
    if(operation.application!==getApplication()){operation=result=undefined;failure='Runtime 已切换，请重新查询天气';return;}
    const current=operation;let readback;
    try{readback=current.application.readHostToolTask(current.taskId);}catch{failure='天气任务读回失败，请重试';return;}
    current.state=readback.task.state;
    if(current.state==='succeeded'){
      const confirmed=readback.confirmed,forecast=confirmed?.result?.forecast,cache=confirmed?.result?.cache;
      if(confirmed?.runId&&forecast?.units==='metric'&&typeof forecast.summary==='string'&&Number.isFinite(forecast.temperatureMin)&&Number.isFinite(forecast.temperatureMax)){
        result={city:location,condition:forecast.summary,range:`${forecast.temperatureMin}–${forecast.temperatureMax}°C`,
          ...(Number.isFinite(forecast.current?.temperature)?{temp:forecast.current.temperature}:{}),
          temperatureMin:forecast.temperatureMin,temperatureMax:forecast.temperatureMax,date:forecast.date,
          fetchedAt:cache?.fetchedAt??confirmed.result.record?.fetchedAt,stale:cache?.state==='stale',
          source:confirmed.result.record?.source,taskId:current.taskId,evidenceRefs:confirmed.evidenceRefs};failure='';
      }else failure='天气任务没有可核实的结果';
    }else if(terminal.has(current.state))failure='天气查询未完成，请重试';
    else if(now()>=current.expiresAt)failure='天气查询超时，请核对原任务状态';
  }
  function snapshot(){read();return {configured:Boolean(location),location,state:operation?.state??'idle',reason:failure,...result,
    busy:Boolean(operation&&!terminal.has(operation.state)&&now()<operation.expiresAt),...(result?{ageMs:Math.floor(Math.max(0,now()-Date.parse(result.fetchedAt??0))/60000)*60000}:{})};}
  function watch(){
    clearTimeout(timer);if(closed)return;read();onUpdate();
    if(operation&&!terminal.has(operation.state)&&now()<operation.expiresAt){timer=setTimeout(watch,250);timer.unref?.();}
  }
  function refresh(){
    if(closed||!location)throw Error('请先配置天气城市');
    read();if(operation&&!terminal.has(operation.state))return snapshot();
    const application=getApplication(),toolVersion=readToolVersion();if(!application||!toolVersion)throw Error('天气查询能力尚未就绪');
    const commandId='weather-card-'+randomUUID(),expiresAt=now()+30000,deadline=new Date(expiresAt).toISOString();
    const task=application.prepareHostToolTask({commandId,toolName:'weather.forecast',toolVersion,deadline});
    operation={application,taskId:task.taskId,state:task.state,expiresAt};failure='';
    let readback;
    try{readback=application.finalizeHostToolTask({commandId,taskId:task.taskId,expectedTaskRevision:task.revision,arguments:{location,units:'metric'}});}
    catch(error){application.cancelPreparedHostToolTask(task.taskId,commandId,task.revision);operation=undefined;failure='天气请求未受理，请重试';throw error;}
    operation.state=readback.task.state;watch();return snapshot();
  }
  return {snapshot,refresh,configure(input){
    if(!input||Object.keys(input).some(key=>key!=='location')||!validLocation(input.location))throw Error('天气城市无效');
    read();if(operation&&!terminal.has(operation.state))throw Error('请等待当前天气查询结束');
    mkdirSync(userData,{recursive:true});writeFileSync(file+'.tmp',JSON.stringify({version:1,location:input.location}));renameSync(file+'.tmp',file);
    location=input.location;result=operation=undefined;failure='';return refresh();
  },dispose(){closed=true;clearTimeout(timer);}};
}

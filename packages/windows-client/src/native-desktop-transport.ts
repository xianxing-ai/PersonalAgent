import {spawn, type ChildProcessWithoutNullStreams} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {realpath} from 'node:fs/promises';
import {isAbsolute, join} from 'node:path';
import {ProtocolError, ToolNotStartedError} from '@personal-agent/contracts';
import type {TaskSnapshot} from '@personal-agent/contracts';

export type DesktopCallContext={signal:AbortSignal;deadline:string};
export interface NativeDesktopTransport {
  start(context:DesktopCallContext):Promise<void>;
  request(method:string,params:Record<string,unknown>,context:DesktopCallContext):Promise<unknown>;
  stop():Promise<void>;close():Promise<void>;isReady():boolean;
}
const object=(value:unknown):value is Record<string,unknown>=>!!value&&typeof value==='object'&&!Array.isArray(value);
type PublicErrorCode=NonNullable<TaskSnapshot['error']>['code'];
const nativeRefusals:Record<string,readonly [PublicErrorCode,string]>={
  USER_TAKEOVER:['REVISION_CONFLICT','检测到非本组件的输入变化，请重新列出或观察原目标'],
  TARGET_STALE:['REVISION_CONFLICT','原目标已变化或过期，请重新列出或观察'],
  TARGET_AMBIGUOUS:['REVISION_CONFLICT','无法唯一确定原目标，请重新观察并明确选择'],
  RESOURCE_BUSY:['REVISION_CONFLICT','电脑组件请求容量已满，请先检查当前请求状态'],
  REVISION_CONFLICT:['REVISION_CONFLICT','原请求身份已使用，请核对原操作记录'],
  UNAUTHORIZED:['UNAUTHORIZED','原目标受保护或访问许可无效'],
  UNSUPPORTED_CAPABILITY:['UNSUPPORTED_CAPABILITY','原生电脑组件不支持此操作'],
  INVALID_ARGUMENT:['INVALID_ARGUMENT','原生电脑请求不符合协议'],
  PROTOCOL_MISMATCH:['PROTOCOL_MISMATCH','原生电脑组件协议不兼容'],
  CANCELLED:['CANCELLED','原生电脑请求已取消'],
  TIMEOUT:['TIMEOUT','原生电脑请求已过期'],
  EXTERNAL_FAILURE:['EXTERNAL_FAILURE','原生电脑组件未能完成请求'],
};
/** Internal decoder for application-owned stdio only; never accepts renderer/tool output as dispatch proof. */
export function nativeDesktopResponseError(value:unknown):ProtocolError {
  const error=object(value)?value:{};
  // Missing/true dispatch, including a contradictory RESULT_UNKNOWN, is never zero-dispatch proof.
  if(error.dispatched!==false||error.code==='RESULT_UNKNOWN')return new ProtocolError('RESULT_UNKNOWN','设备可能已执行操作，请核实原任务');
  const known=typeof error.code==='string'&&Object.hasOwn(nativeRefusals,error.code)?nativeRefusals[error.code]:undefined;
  if(!known)return new ToolNotStartedError('PROTOCOL_MISMATCH','原生电脑拒绝 [native=UNRECOGNIZED]：错误码不属于当前协议；本次没有输入设备操作');
  // Only allowlisted codes and fixed local explanations may cross the public Error schema.
  // Native messages can contain private OS/provider data and are deliberately ignored.
  return new ToolNotStartedError(known[0],`原生电脑拒绝 [native=${error.code}]：${known[1]}；本次没有输入设备操作`);
}
/** Main owns this executable and private stdio. Never pass a renderer command/env or shell. */
export function createNativeDesktopTransport({executable}:{executable:string}):NativeDesktopTransport {
  let child:ChildProcessWithoutNullStreams|undefined,buffer='',closed=false,ready=false;
  const pending=new Map<string,{resolve:(value:unknown)=>void;reject:(error:Error)=>void;cleanup:()=>void}>();
  const active=(context:DesktopCallContext)=>{
    if(context.signal.aborted)throw new ProtocolError('CANCELLED','电脑请求已取消');
    if(!(Date.parse(context.deadline)>Date.now()))throw new ProtocolError('TIMEOUT','电脑请求期限已过');
  };
  const rejectAll=()=>{ready=false;for(const item of pending.values()){item.cleanup();item.reject(new ProtocolError('EXTERNAL_FAILURE','原生电脑连接已中断'));}pending.clear();};
  async function release(){
    const owned=child;child=undefined;ready=false;if(!owned)return;
    try{if(owned.exitCode===null&&owned.signalCode===null)await new Promise<void>((resolve,reject)=>{
      const timer=setTimeout(()=>{owned.kill();reject(new ProtocolError('EXTERNAL_FAILURE','电脑组件停止未确认'));},5000);
      owned.once('exit',()=>{clearTimeout(timer);resolve();});owned.stdin.end();
    });}finally{rejectAll();buffer='';}
  }
  const host:NativeDesktopTransport={
    isReady:()=>ready&&!!child&&!closed,
    async start(context){
      active(context);if(closed)throw new ProtocolError('CANCELLED','电脑组件已释放');if(host.isReady())return;
      if(process.platform!=='win32'||!isAbsolute(executable))throw new ProtocolError('UNSUPPORTED_CAPABILITY','Windows原生电脑组件不可用');
      await release();const file=await realpath(executable);active(context);
      const system=process.env.SystemRoot??'C:/Windows';
      const owned=spawn(file,[],{windowsHide:true,stdio:'pipe',env:{SystemRoot:system,WINDIR:system,PATH:join(system,'System32'),
        TEMP:process.env.TEMP,TMP:process.env.TMP,DOTNET_NOLOGO:'1',DOTNET_CLI_TELEMETRY_OPTOUT:'1'}});
      child=owned;buffer='';owned.stderr.on('data',()=>{});
      owned.on('error',rejectAll);owned.on('exit',()=>{if(child===owned)child=undefined;rejectAll();});
      owned.stdout.setEncoding('utf8');owned.stdout.on('data',(chunk:string)=>{
        buffer+=chunk;if(Buffer.byteLength(buffer)>12*1024*1024){rejectAll();owned.kill();return;}
        for(let end=buffer.indexOf('\n');end>=0;end=buffer.indexOf('\n')){
          const line=buffer.slice(0,end);buffer=buffer.slice(end+1);let response:unknown;
          try{response=JSON.parse(line);}catch{rejectAll();owned.kill();return;}
          if(!object(response)||typeof response.id!=='string'||typeof response.ok!=='boolean'){rejectAll();owned.kill();return;}
          const item=pending.get(response.id);if(!item)continue;item.cleanup();pending.delete(response.id);
          if(response.ok)item.resolve(response.result);
          else{
            // This flag originates only in the application-owned native executor.
            item.reject(nativeDesktopResponseError(response.error));
          }
        }
      });
      try{const info=await host.request('initialize',{},context);
        if(!object(info)||info.protocol!=='personal-agent-desktop/1'||info.version!=='1.0.0')throw new ProtocolError('PROTOCOL_MISMATCH','电脑组件版本不兼容');
        ready=true;
      }catch(error){await release().catch(()=>{});throw error;}
    },
    request(method,params,context){
      active(context);if(!child||closed)throw new ProtocolError('UNSUPPORTED_CAPABILITY','电脑组件未连接');
      const owned=child,id=randomUUID();
      return new Promise((resolve,reject)=>{
        let timer:ReturnType<typeof setTimeout>;
        const cleanup=()=>{clearTimeout(timer);context.signal.removeEventListener('abort',abort);};
        const abort=()=>{
          if(!pending.has(id))return;cleanup();pending.delete(id);
          if(method!=='stop')owned.stdin.write(JSON.stringify({id:randomUUID(),method:'stop',params:{},deadline:new Date(Date.now()+5000).toISOString()})+'\n');
          // A UIA provider may never return. Do not reuse a poisoned STA after timeout.
          ready=false;
          // Give the independent native reader a brief chance to release tagged
          // keys/buttons. A hung UIA thread still cannot keep this process reusable.
          const terminate=setTimeout(()=>{if(owned.exitCode===null&&owned.signalCode===null)owned.kill();},250);terminate.unref();
          reject(new ProtocolError(context.signal.aborted?'CANCELLED':'TIMEOUT','原生电脑请求已中断'));
        };
        pending.set(id,{resolve,reject,cleanup});context.signal.addEventListener('abort',abort,{once:true});
        timer=setTimeout(abort,Math.min(2147483647,Math.max(1,Date.parse(context.deadline)-Date.now())));
        owned.stdin.write(JSON.stringify({id,method,params,deadline:context.deadline})+'\n',error=>{
          if(error&&pending.has(id)){cleanup();pending.delete(id);reject(new ProtocolError('EXTERNAL_FAILURE','电脑请求无法发送'));}
        });if(context.signal.aborted)abort();
      });
    },
    async stop(){if(!child)return;
      const result=await host.request('stop',{}, {signal:new AbortController().signal,deadline:new Date(Date.now()+5000).toISOString()});
      if(!object(result)||result.stopped!==true)throw new ProtocolError('EXTERNAL_FAILURE','电脑输入停止未确认');},
    async close(){if(closed)return;try{await host.stop();}finally{closed=true;await release();}},
  };
  return host;
}

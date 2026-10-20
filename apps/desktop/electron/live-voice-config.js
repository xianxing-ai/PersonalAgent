import {existsSync,mkdirSync,readFileSync,renameSync,writeFileSync} from 'node:fs';
import path from 'node:path';
export function createLiveVoiceConfig({userData,safeStorage,competitionMode=false,readAgentArtsState=()=>({configured:false})}){
 const target=path.join(userData,'live-voice-config.json');let saved,failure='';
 const consentValid=v=>v&&/^F([1-9]|1[0-9]|2[0-4])$/.test(v.hotkey)&&v.audioConsent===true;
 const apiValid=v=>v&&/^[A-Za-z0-9-]{1,128}$/.test(v.workspaceId)&&typeof v.apiKey==='string'&&v.apiKey.length>0&&v.apiKey.length<=4096&&!/\s/.test(v.apiKey);
 const startupValid=v=>['startupGreeting','continuousListening'].every(k=>v[k]===undefined||typeof v[k]==='boolean');
 if(existsSync(target)){try{const data=JSON.parse(readFileSync(target,'utf8'));if(![1,2].includes(data.version)||!consentValid(data))throw Error();let apiKey;
   if(data.key!==undefined){if(typeof data.key!=='string'||!safeStorage.isEncryptionAvailable())throw Error();apiKey=safeStorage.decryptString(Buffer.from(data.key,'base64'));}
   const value={...data,...(apiKey===undefined?{}:{apiKey})};if(!startupValid(value)||((data.version===1||apiKey!==undefined)&&!apiValid(value)))throw Error();saved=value;
 }catch{failure='Live 加密配置无法读取，请重新保存';}}
 const snapshot=()=>{const aa=competitionMode?readAgentArtsState():undefined;const configured=consentValid(saved)&&(competitionMode?aa?.configured===true:apiValid(saved));return {configured,startupGreeting:saved?.startupGreeting===true,continuousListening:saved?.continuousListening===true,provider:competitionMode?'agentarts':'qwen',route:competitionMode?'AgentArts WSS → 百炼实时语音':'百炼 API',model:'qwen3.8-omni-flash-realtime',region:'cn-beijing',hotkey:saved?.hotkey??'F8',workspaceId:saved?.workspaceId??'',audioConsent:saved?.audioConsent===true,apiKeyConfigured:Boolean(saved?.apiKey),reason:failure||(competitionMode? !consentValid(saved)?'请确认音频经 AgentArts 发送至百炼的用途并保存快捷键':!aa?.configured?'请先配置 AgentArts 网关与凭据':'AgentArts WSS 实时语音已配置，尚需连接与真实语音验收':configured?'Live 已配置，尚需连接与真实语音验收':'请配置百炼北京业务空间和 API Key')};};
 return {snapshot,current(){if(!snapshot().configured)return undefined;return competitionMode?{route:'agentarts-wss'}:{workspaceId:saved.workspaceId,apiKey:saved.apiKey};},configure(input){
   if(!input||!startupValid(input)||Object.keys(input).some(k=>!['workspaceId','apiKey','hotkey','audioConsent','startupGreeting','continuousListening'].includes(k)))throw Error('Live 配置格式无效');
   const value={...saved,...input,workspaceId:input.workspaceId||saved?.workspaceId,apiKey:input.apiKey||saved?.apiKey};
   if(!consentValid(value)||(!competitionMode&&!apiValid(value)))throw Error(competitionMode?'请填写 F1 至 F24 快捷键并确认音频用途':'请填写北京业务空间、API Key、F1 至 F24 快捷键并确认音频用途');
   if((value.workspaceId||value.apiKey)&&!apiValid(value))throw Error('保留的百炼 API 配置不完整');
   let key;if(value.apiKey){if(!safeStorage.isEncryptionAvailable())throw Error('本机安全存储不可用，未保存密钥');key=safeStorage.encryptString(value.apiKey).toString('base64');}
   mkdirSync(userData,{recursive:true});const temp=target+'.tmp-'+process.pid;writeFileSync(temp,JSON.stringify({version:competitionMode?2:1,...(value.workspaceId?{workspaceId:value.workspaceId}:{}),...(key?{key}:{}),hotkey:value.hotkey,audioConsent:true,startupGreeting:value.startupGreeting===true,continuousListening:value.continuousListening===true}),'utf8');renameSync(temp,target);saved=value;failure='';return snapshot();
 }};
}

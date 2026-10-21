import {createModelThinkingController} from '../src/features/conversation/model-thinking-picker.js';
export const revision='a'.repeat(64);
export const selection=(modelId='a',reasoningEffort)=>({catalogRevision:revision,modelId,...(reasoningEffort?{reasoningEffort}:{})});
export const snapshot=(depth=1,fast=false,extra={})=>({conversationState:{activeId:'conversation-1'},conversationPreference:{depth,fast,...(!extra.modelId&&!extra.executionModel?{modelSelection:'default'}:{}),...extra},thinking:{depth,fast},agentArtsModels:{catalog:{revision,defaultModelId:'a',models:[
  {id:'a',displayName:'A',type:'text',reasoningEfforts:['low','medium','high'],availability:'unverified'},
  {id:'b',displayName:'B',type:'text',reasoningEfforts:['max'],availability:'unverified'},
  {id:'custom-model',displayName:'Custom',type:'text',reasoningEfforts:[],availability:'unverified'},
  {id:'blocked',displayName:'Blocked',type:'text',reasoningEfforts:[],availability:'unavailable'},
  {id:'audio',displayName:'Audio',type:'audio',reasoningEfforts:[],availability:'unverified'},
 ]},preferences:{catalogRevision:revision,defaultModelId:'a',defaultSubmodelId:'b',reasoningEffort:'medium',submodelReasoningEffort:'max'}}});
export const tick=()=>new Promise(resolve=>setImmediate(resolve));
export function fixture(initial=snapshot()){
  const calls=[],errors=[];let state,feedbackRevision=0,cleared=0;
  const controller=createModelThinkingController((name,payload)=>new Promise((resolve,reject)=>calls.push({name,payload,resolve,reject})),error=>{errors.push(error.message);feedbackRevision++;},{onChange:value=>{state=value;},readFeedbackRevision:()=>feedbackRevision,clearFeedback:()=>{cleared++;feedbackRevision++;}});
  controller.update(initial);
  return {controller,calls,errors,get state(){return state;},get cleared(){return cleared;},newerError(){feedbackRevision++;},update:data=>controller.update(data),preview:index=>controller.previewLevel(index),commit(index){controller.previewLevel(index);return controller.commitLevel(index);}};
}

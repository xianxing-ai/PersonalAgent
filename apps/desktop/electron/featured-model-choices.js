/** Explicit reviewed UI picks only. This does not alter the execution catalog. */
export const FEATURED_MODELS=Object.freeze([
 {id:'qwen3.8-flash',vendor:'千问',tier:'fast',displayTier:'快速'},
 {id:'qwen3.8-max',vendor:'千问',tier:'flagship'},
 {id:'deepseek-v4.1-flash',vendor:'DeepSeek',tier:'fast',displayTier:'快速'},
 {id:'deepseek-v4-pro',vendor:'DeepSeek',tier:'flagship'},
 {id:'ZHIPU/GLM-5.3-Flash',vendor:'智谱',tier:'fast',displayTier:'快速'},
 {id:'glm-5.3',vendor:'智谱',tier:'flagship'},
 {id:'kimi/kimi-k2.7-code-highspeed',vendor:'Kimi',tier:'fast',displayTier:'高速部署'},
 {id:'kimi-k3',vendor:'Kimi',tier:'flagship'},
 {id:'MiniMax/MiniMax-M2.7',vendor:'MiniMax',tier:'fast',displayTier:'经济'},
 {id:'MiniMax/MiniMax-M3',vendor:'MiniMax',tier:'flagship'},
 {id:'stepfun/step-3.7-flash',vendor:'阶跃',tier:'fast',displayTier:'快速'},
 {id:'stepfun/step-5-preview',vendor:'阶跃',tier:'flagship',displayTier:'旗舰（预览）'},
 {id:'xiaomi/mimo-v2.5-pro',vendor:'小米',tier:'flagship'},
].map(Object.freeze));
export const FEATURED_MODEL_IDS=Object.freeze(FEATURED_MODELS.map(item=>item.id));
export function featuredModelChoices(models,{selectedId='',featuredIds=FEATURED_MODEL_IDS,featuredModels=FEATURED_MODELS}={}){
 const catalog=Array.isArray(models)?models:[];
 const eligible=m=>m?.type==='text'&&m.availability!=='unavailable'&&m.available!==false;
 const selected=catalog.find(m=>m.id===selectedId);
 const choices=featuredIds.flatMap(id=>{const model=catalog.find(m=>m.id===id);const meta=featuredModels.find(item=>item.id===id);return eligible(model)?[{...model,available:true,...(meta?{displayName:meta.vendor+' · '+(meta.displayTier??(meta.tier==='fast'?'轻量/快速':'旗舰'))+' · '+model.displayName}:{})}]:[];});
 if(selectedId&&!choices.some(m=>m.id===selectedId))choices.push(eligible(selected)?{...selected,available:true,displayName:selected.displayName+'（当前选择）'}:{id:selectedId,displayName:'当前选择（目录未提供可用文本能力）',available:false});
 return choices;
}

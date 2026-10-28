import {readFileSync,mkdirSync,writeFileSync,renameSync} from 'node:fs';
import path from 'node:path';
import {ProtocolError} from '@personal-agent/contracts';

/** Non-secret preferences. Explicit denial is preserved; full-access is evaluated separately. */
export function createComputerControlConfig({userData,onUpdate=()=>{}}){
  const file=path.join(userData,'computer-control.json');let value={version:1,revision:0,enabled:true,allowObservationExport:false,observationExportConfigured:false};
  try{const saved=JSON.parse(readFileSync(file,'utf8'));if(saved?.version===1&&typeof saved.enabled==='boolean'&&typeof saved.allowObservationExport==='boolean')value={version:1,revision:Number.isSafeInteger(saved.revision)&&saved.revision>=0?saved.revision:0,
    enabled:saved.enabled,allowObservationExport:saved.allowObservationExport,observationExportConfigured:saved.observationExportConfigured!==false};}
  catch{/* Missing or incompatible preferences do not grant observation export. */}
  return {snapshot:()=>({...value}),configure(input){
    if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).some(key=>!['enabled','allowObservationExport'].includes(key))
      ||typeof input.enabled!=='boolean'||typeof input.allowObservationExport!=='boolean')throw new ProtocolError('INVALID_ARGUMENT','电脑控制设置格式无效');
    const next={version:1,revision:value.revision+1,enabled:input.enabled,allowObservationExport:input.allowObservationExport,observationExportConfigured:true};
    mkdirSync(userData,{recursive:true});writeFileSync(file+'.next',JSON.stringify(next)+'\n',{mode:0o600});renameSync(file+'.next',file);value=next;onUpdate();return {...value};
  }};
}

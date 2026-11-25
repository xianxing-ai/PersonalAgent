import {supportsPanelAcrylic} from './panel-material.js';

// The maximizable workspace uses DWM material; the small shaped panel owns a separate clipped backdrop.
export function workspaceWindowAppearance(theme, host) {
  const acrylic=process.env.PA_ENABLE_WORKSPACE_ACRYLIC==='1'&&supportsPanelAcrylic(host)&&!theme.prefersReducedTransparency&&!theme.shouldUseHighContrastColors;
  return {transparent:false,thickFrame:true,backgroundMaterial:acrylic?'acrylic':'none',
    backgroundColor:acrylic?'#00000000':theme.shouldUseDarkColors?'#191919':'#f4f4f4'};
}
export function bindWorkspaceMaterial(win,theme,host) {
  let signature;
  const apply=()=>{
    if(win.isDestroyed())return;
    const appearance=workspaceWindowAppearance(theme,host),next=JSON.stringify(appearance);
    if(next===signature)return;signature=next;
    try{if(supportsPanelAcrylic(host))win.setBackgroundMaterial(appearance.backgroundMaterial);win.setBackgroundColor(appearance.backgroundColor);}
    catch{win.setBackgroundColor(theme.shouldUseDarkColors?'#191919':'#f4f4f4');}
  };
  apply();theme.on('updated',apply);win.once('closed',()=>theme.removeListener('updated',apply));
}

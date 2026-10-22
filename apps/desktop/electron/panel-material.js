import {release} from 'node:os';
import {startPanelBackdrop} from './panel-backdrop-host.js';

// DWM system backdrops require Windows 11 22H2. Other hosts keep an opaque,
// readable backing rather than exposing sharp desktop text through the panel.
export function supportsPanelAcrylic({platform = process.platform, version = release()} = {}) {
  const [major, , build] = String(version).split('.').map(Number);
  return platform === 'win32' && major >= 10 && build >= 22621;
}

export function panelWindowAppearance(theme, host) {
  // System backgroundMaterial fills outside setShape on Windows. Keep the HWND
  // transparent and draw a clipped HostBackdropBrush below Chromium instead.
  return {transparent: true, thickFrame: false, backgroundMaterial: 'none',
    backgroundColor:theme.shouldUseDarkColors ? '#181d27' : '#f1f5fc'};
}

export function bindPanelMaterial(win, theme, host, start = startPanelBackdrop) {
  let signature,backdrop,failed=false,ready=false,generation=0,closed=false;
  let stopping,stopped=false,quitWait;
  const instances=new Set(),contents=win.webContents;
  const apply = () => {
    if (closed||win.isDestroyed()) return;
    const appearance = panelWindowAppearance(theme, host);
    const enabled=supportsPanelAcrylic(host)&&!theme.prefersReducedTransparency&&!theme.shouldUseHighContrastColors;
    const next=JSON.stringify([appearance,enabled]);
    if (signature === next) return;
    signature = next;
    if(!enabled){generation++;backdrop?.dispose();backdrop=undefined;failed=false;ready=false;}
    win.setBackgroundColor(enabled&&ready?'#00000000':appearance.backgroundColor);
    if(enabled&&!backdrop&&!failed){
      const owner=++generation;
      backdrop=start(win,{
        onReady(){if(closed||owner!==generation||win.isDestroyed())return;ready=true;if(backdrop){backdrop.update(theme,40*(contents?.getZoomFactor()??1));win.setBackgroundColor('#00000000');}},
        onFailure(){if(closed||owner!==generation)return;ready=false;failed=true;backdrop=undefined;if(!win.isDestroyed())win.setBackgroundColor(theme.shouldUseDarkColors?'#181d27':'#f1f5fc');},
      });
      instances.add(backdrop);
    }
    backdrop?.update(theme,40*(contents?.getZoomFactor()??1));
  };
  const zoom=()=>backdrop?.update(theme,40*(contents?.getZoomFactor()??1));
  const dispose=()=>{
    if(stopping)return stopping;
    closed=true;generation++;theme.removeListener('updated',apply);contents?.removeListener('zoom-changed',zoom);win.removeListener('resize',zoom);
    stopping=Promise.all([...instances].map(instance=>instance.dispose())).then(()=>{stopped=true;instances.clear();});
    return stopping;
  };
  apply();theme.on('updated', apply);
  contents?.on('zoom-changed',zoom);
  win.on('resize',zoom);
  win.once('closed', () => {void dispose();});
  return {
    dispose,
    allowQuit(retry){
      if(stopped)return true;
      quitWait??=dispose().then(retry);
      return false;
    },
  };
}

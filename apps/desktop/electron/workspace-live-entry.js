/** Reuse the panel's single Live lifecycle; never infer audio consent from gateway credentials. */
export function workspaceLiveEntry({sender,workspace,payload,competitionMode,configuration,openSettings,toggle}){
  if(!workspace||sender!==workspace||payload!==undefined||!competitionMode)throw Error('请从正式工作区开启 Live');
  if(!configuration.snapshot().configured){openSettings('voice');return {opened:'voice-settings',active:false};}
  return toggle();
}

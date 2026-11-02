import {createDesktopEgressHost} from './egress-host.js';

/** Native, local-only classification. Sandbox grants never answer these questions. */
export function createNativeEgressHost({dialog}) {
  const current=scope=>!scope.signal.aborted&&Date.parse(scope.deadline)>Date.now()&&scope.isCurrent();
  return createDesktopEgressHost({
    async classifyLocally(scope){
      if(!current(scope))return 'unknown';
      const answer=await dialog.showMessageBox({type:'question',title:'检查即将发送的内容',signal:scope.signal,
        message:'请在本机确认内容类别。密钥、验证码及个人信息不得发送；其他隐私需要单独批准。',
        detail:`目的地：${scope.destination}\n\n完整待发送内容：\n${scope.payload}`,
        buttons:['取消','包含禁止发送的信息','包含其他隐私','确认全部内容可公开'],defaultId:0,cancelId:0,noLink:true});
      if(!current(scope))return 'unknown';
      return ['unknown','forbidden','private','public'][answer.response]??'unknown';
    },
    async approvePrivate(scope){
      if(!current(scope))return false;
      const answer=await dialog.showMessageBox({type:'question',title:'批准本次隐私发送',signal:scope.signal,
        message:'是否仅允许将以下内容发送到这个目的地？此批准不包含密钥及个人信息。',
        detail:`目的地：${scope.destination}\n\n完整待发送内容：\n${scope.payload}`,
        buttons:['不发送','仅允许本次'],defaultId:0,cancelId:0,noLink:true});
      return current(scope)&&answer.response===1;
    },
  });
}

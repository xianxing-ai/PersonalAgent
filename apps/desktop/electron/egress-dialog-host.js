import {createDesktopEgressHost} from './egress-host.js';

/** Native, local-only classification. Used in explicit ask mode when content is not auto-approved by policy. */
export function createNativeEgressHost({dialog,authorizeTaskEgress,authorizeSecretEgress,readPendingWorkflowGraph,isTrustedIdentifier,readTrustedGitHubShas,readTrustedConnectorOutputs,readEgressPolicy}) {
  const current=scope=>!scope.signal.aborted&&Date.parse(scope.deadline)>Date.now()&&scope.isCurrent();
  return createDesktopEgressHost({
    authorizeTaskEgress,authorizeSecretEgress,readPendingWorkflowGraph,isTrustedIdentifier,readTrustedGitHubShas,readTrustedConnectorOutputs,readEgressPolicy,
    async classifyLocally(scope){
      if(!current(scope))return 'unknown';
      const preview=scope.payload.length>4000
        ?`${scope.payload.slice(0,4000)}\n…（内容共 ${scope.payload.length} 字符，已截断预览）`
        :scope.payload;
      const answer=await dialog.showMessageBox({type:'question',title:'确认出机发送内容',signal:scope.signal,
        message:'当前处于「每次都询问」模式。请确认是否允许将以下非敏感内容发送到目标地址？',
        detail:`目的地：${scope.destination}\n\n待发送内容：\n${preview}`,
        buttons:['不发送','允许本次发送'],defaultId:0,cancelId:0,noLink:true});
      if(!current(scope))return 'unknown';
      return answer.response===1?'public':'forbidden';
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

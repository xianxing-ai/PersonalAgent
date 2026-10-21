import {isDeepStrictEqual} from 'node:util';
import {ProtocolError} from '@personal-agent/contracts';

const KEY='desktop-connector-mail-read-origin';
const denied=()=>{throw new ProtocolError('UNAUTHORIZED','邮箱读取的原配置或主对话已失效');};

/** Native-only immutable binding made before the original read. It carries no
 * account address, credential or mail data and grants no connector permission. */
export function createConnectorReadOrigin({getApplication,readSourceAuthorization}) {
  function current(taskId) {
    const runtime=getApplication()?.runtime;if(!runtime)denied();
    const task=runtime.getTask(taskId),authorization=readSourceAuthorization('mail');
    if(task.cancelRequested||['failed','cancelled','cancelling'].includes(task.state)
      ||['private-copy-erasure','private-copy-erasure-binding'].some(key=>runtime.loadCheckpoint(taskId,key)!==undefined)
      ||authorization?.available!==true||typeof authorization.configurationRef!=='string'||!authorization.configurationRef)denied();
    return {runtime,task,configurationRef:authorization.configurationRef};
  }
  return {
    bind({taskId,conversationId}) {
      const {runtime,task,configurationRef}=current(taskId);
      if(!['created','running','waiting_approval'].includes(task.state)||typeof conversationId!=='string'||!conversationId)denied();
      const binding={version:1,source:'mail',configurationRef,conversationId};
      runtime.saveCheckpointOnce(taskId,KEY,binding);
      if(!isDeepStrictEqual(runtime.loadCheckpoint(taskId,KEY),binding))denied();
    },
    read(taskId) {try {
      const {runtime,configurationRef}=current(taskId),binding=runtime.loadCheckpoint(taskId,KEY);
      if(binding?.version!==1||binding.source!=='mail'||binding.configurationRef!==configurationRef
        ||typeof binding.conversationId!=='string'||!binding.conversationId)return undefined;
      return {configurationRef,conversationId:binding.conversationId};
    }catch{return undefined;}},
  };
}

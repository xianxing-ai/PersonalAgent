import test from 'node:test';
import assert from 'node:assert/strict';
import {projectMailStatus} from '../electron/mail-status-projection.js';
const config={configured:true,status:'disabled',sessionAllowed:false,cloudAnalysisAllowed:false,reason:'读取许可不会跨应用重启恢复'};
test('question-mode execution states remain visible without changing consent',()=>{
  for(const status of ['waiting_approval','reading','classifying','complete','classification_unavailable','resync_required']){
    const host={status,reason:status==='classification_unavailable'?'本地分类失败':undefined};
    const result={...host,...config,...projectMailStatus(config,host)};
    assert.equal(result.status,status);
    assert.equal(result.sessionAllowed,false);assert.equal(result.cloudAnalysisAllowed,false);
    if(host.reason)assert.equal(result.reason,host.reason);
  }
});
test('idle configuration does not imply execution authorization',()=>{
  for(const status of ['ready','disabled','unavailable'])assert.deepEqual(projectMailStatus(config,{status}),{status:config.status,reason:config.reason});
  assert.deepEqual(projectMailStatus(config),{status:config.status,reason:config.reason});
  assert.equal(projectMailStatus({...config,sessionAllowed:true},{status:'ready'}).status,'ready');
});
test('stop uncertainty, failures and changed configuration outrank retained host state',()=>{
  const complete={status:'complete',reason:'旧批次已完成'};
  assert.equal(projectMailStatus(config,{status:'stop_unconfirmed'},'故障').status,'stop_unconfirmed');
  assert.deepEqual(projectMailStatus(config,complete,'邮箱处理失败'),{status:'unavailable',reason:'邮箱处理失败'});
  assert.deepEqual(projectMailStatus({...config,requiresRestart:true},complete),{status:'disabled',reason:'邮箱配置将在下次启动应用时接入'});
  assert.deepEqual(projectMailStatus({...config,status:'unavailable',reason:'配置无法解密'},complete),{status:'unavailable',reason:'配置无法解密'});
});

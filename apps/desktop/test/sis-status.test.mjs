import test from 'node:test';import assert from 'node:assert/strict';import {sisStatusLine} from '../src/features/conversation/sis-status.js';
const CLAUSE='经 AgentArts 暂不可用';
test('configured snapshot reports 已配置 without echoing token material',()=>{
  const line=sisStatusLine({hostReady:true},{configured:true,region:'cn-north-4',projectId:'p1',token:'must-not-appear',tokenStatus:'expires_at',reason:'SIS 已配置；真实设备与云端调用尚未验收'});
  assert.match(line,/已配置/);assert.match(line,/(在语音设置中管理)/);assert.match(line,new RegExp(CLAUSE));
  assert.doesNotMatch(line,/must-not-appear/);
});
test('expired token keeps hostReady but requires re-login and shows the host reason without token values',()=>{
  const line=sisStatusLine({hostReady:true},{configured:false,reason:'SIS IAM Token 已过期，请更新',token:'must-not-appear',tokenStatus:'expired'});
  assert.match(line,/配置未就绪/);assert.match(line,/已过期，请更新/);assert.match(line,/重新登录/);assert.match(line,new RegExp(CLAUSE));
  assert.doesNotMatch(line,/must-not-appear/);
});
test('plain unconfigured snapshot keeps the 未配置 guidance',()=>{
  const line=sisStatusLine({hostReady:false},{configured:false,reason:'请配置 SIS 区域、项目 ID 和独立 IAM Token'});
  assert.match(line,/未配置/);assert.match(line,/(在语音设置中管理)/);assert.match(line,new RegExp(CLAUSE));
});
test('missing or malformed snapshot fields degrade to 未配置 without throwing',()=>{
  assert.match(sisStatusLine(undefined,undefined),/未配置/);
  assert.match(sisStatusLine(null,null),/未配置/);
  assert.match(sisStatusLine({hostReady:true},null),/配置未就绪/);assert.doesNotMatch(sisStatusLine({hostReady:true},null),/undefined/);
  assert.match(sisStatusLine(null,{configured:'yes'}),/未配置/,'only boolean true counts as configured');
});

/** Display execution state without turning configuration readiness into a read grant. */
export function projectMailStatus(config,host,failure='') {
  if(host?.status==='stop_unconfirmed')return {status:'stop_unconfirmed',reason:'已撤销新读取；现有邮箱连接退出尚未确认'};
  if(failure)return {status:'unavailable',reason:failure};
  if(config.requiresRestart)return {status:config.status,reason:'邮箱配置将在下次启动应用时接入'};
  if(config.status==='unavailable')return {status:config.status,reason:config.reason};
  const working=host?.status&&!['ready','disabled','unavailable'].includes(host.status);
  if(working||config.sessionAllowed)return {status:host?.status??config.status,reason:host?.reason??config.reason};
  return {status:config.status,reason:config.reason};
}

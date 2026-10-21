// Private Desktop diagnostics. Only fixed codes/fields/messages cross the admin IPC boundary.
const definitions={
  DEV_SETTINGS_INPUT_INVALID:['INVALID_ARGUMENT','configuration','开发配置字段无效，请检查表单格式与可选规则。'],
  DEV_SETTINGS_BUSY:['INVALID_STATE','configuration','开发配置宿主已关闭或正在保存，请稍后重试。'],
  DEV_SETTINGS_ACCESS_DENIED:['SCOPE_DENIED','configuration','请从正式管理后台操作开发设置。'],
  DEV_SETTINGS_WORKSPACE_REQUIRED:['UNSUPPORTED_CAPABILITY','workspace','请先到「开发 → 环境 / Worktrees」选择本地工作区，再重启应用完成装配。仓库字段只填写 GitHub owner/repo。'],
  DEV_SETTINGS_WORKSPACE_RESTART_REQUIRED:['UNSUPPORTED_CAPABILITY','workspace','工作区设置已保存，但原绑定尚未就绪。请到「开发 → 环境 / Worktrees」核对目录，并重启应用完成装配后再保存。'],
  DEV_SETTINGS_WORKSPACE_INVALID:['UNSUPPORTED_CAPABILITY','workspace','原工作区目录或绑定无效，请重新选择工作区并完成装配。'],
  DEV_SETTINGS_WORKSPACE_CHANGED:['REVISION_CONFLICT','workspace','原工作区或开发配置绑定已变化，请刷新设置并重新保存。'],
  DEV_SETTINGS_ALLOWED_PATHS_INVALID:['INVALID_ARGUMENT','allowedPaths','允许提交的文件列表不符合安全要求；请填写工作区内已有文件的相对路径，不使用链接或凭据文件。'],
  DEV_SETTINGS_ALLOWED_FILE_UNAVAILABLE:['UNSUPPORTED_CAPABILITY','allowedPaths','允许提交的文件不存在或无法安全读取，请核对当前选定工作区和允许提交的文件列表。'],
  DEV_SETTINGS_EXECUTABLE_INVALID:['UNSUPPORTED_CAPABILITY','executable','GitHub 可执行文件不可用或不符合安全要求，请选择工作区外的有效 gh 可执行文件。'],
  DEV_SETTINGS_GIT_INVALID:['INVALID_ARGUMENT','git','仓库、源分支、远程或作者配置无效，请检查对应表单字段。'],
  DEV_SETTINGS_ENVIRONMENT_INVALID:['INVALID_ARGUMENT','environment','GitHub 运行目录配置无效，请检查原运行目录设置。'],
  DEV_SETTINGS_CREDENTIAL_REQUIRED:['INVALID_ARGUMENT','token','请填写有效 GitHub 凭据；留空仅保留已保存凭据。'],
  DEV_SETTINGS_CONTENT_INVALID:['INVALID_ARGUMENT','configuration','开发配置过大或包含凭据，未保存。请移除配置字段中的凭据。'],
  DEV_SETTINGS_MODEL_REQUIRED:['UNSUPPORTED_CAPABILITY','modelId','请选择原模型宿主中已启用的精确模型绑定。'],
  DEV_SETTINGS_WORKFLOW_INVALID:['INVALID_ARGUMENT','workflows','原开发工作流参数无效，请检查步骤、Token、审查及可选规则。'],
  DEV_SETTINGS_STORAGE_UNAVAILABLE:['UNSUPPORTED_CAPABILITY','storage','本机安全存储不可用，未保存开发配置。'],
  DEV_SETTINGS_STORAGE_WRITE_FAILED:['EXTERNAL_FAILURE','storage','本机开发设置写入失败，请检查存储权限后重试。'],
  DEV_SETTINGS_HOST_UNAVAILABLE:['UNSUPPORTED_CAPABILITY','configuration','开发宿主尚未装配或校验未通过，请完成应用初始化后重试。'],
  DEV_SETTINGS_CACHE_INVALID:['UNSUPPORTED_CAPABILITY','configuration','开发工具缓存未能安全装配，请重新启动应用后重试。'],
  DEV_SETTINGS_WRITE_PENDING:['RESULT_UNKNOWN','configuration','开发写入仍在进行，请先核实原任务结果。'],
  DEV_SETTINGS_NOT_CONFIGURED:['UNSUPPORTED_CAPABILITY','configuration','请先保存开发配置，再启用开发工具。'],
  DEV_SETTINGS_SAVE_FAILED:['UNSUPPORTED_CAPABILITY','configuration','开发配置校验或保存失败，请刷新设置后重试。'],
};
const issued=new WeakSet();
export function readDeveloperSettingsDiagnostic(value){
  const definition=typeof value?.code==='string'&&Object.hasOwn(definitions,value.code)?definitions[value.code]:undefined;
  return definition?{code:value.code,field:definition[1],message:definition[2]}:undefined;
}
export function developerSettingsError(code,makeError=(errorCode,message)=>Object.assign(Error(message),{code:errorCode})){
  const entry=readDeveloperSettingsDiagnostic({code})??readDeveloperSettingsDiagnostic({code:'DEV_SETTINGS_SAVE_FAILED'});
  const error=makeError(definitions[entry.code][0],entry.message);
  Object.defineProperty(error,'diagnostic',{value:{code:entry.code,field:entry.field}});issued.add(error);return error;
}
export function preserveDeveloperSettingsError(cause,fallback='DEV_SETTINGS_SAVE_FAILED',makeError){
  return cause&&typeof cause==='object'&&issued.has(cause)?cause:developerSettingsError(fallback,makeError);
}
export function developerSettingsErrorResponse(cause){
  const error=preserveDeveloperSettingsError(cause),entry=readDeveloperSettingsDiagnostic(error.diagnostic);
  return {ok:false,error:entry.message,code:definitions[entry.code][0],diagnostic:{code:entry.code,field:entry.field}};
}
export function developerSettingsFeedback(cause){
  const entry=readDeveloperSettingsDiagnostic(cause?.diagnostic)??readDeveloperSettingsDiagnostic({code:'DEV_SETTINGS_SAVE_FAILED'});
  return `${entry.message}（${entry.code}）`;
}

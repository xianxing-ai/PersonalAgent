import {createHash} from 'node:crypto';
import {ProtocolError} from '@personal-agent/contracts';

const digest=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
// A task may reuse reads and ordinary edits inside its already selected local
// workspace. External mutations keep their exact target and proposed changes.
const localTaskTools=new Set([
  'todo.list','todo.create','todo.update','feeds.collect','feeds.subscriptions',
  'workspace.list_entries','workspace.read_text','workspace.preview_text_patch','workspace.stage_text_patch',
  'workspace.apply_text_patch','workspace.git_diff_check','workspace.node_check','workspace.npm_build','workspace.npm_test',
]);
export function taskOperationBinding(source) {
  const readOnly=source.scopes.length>0&&source.scopes.every(scope=>/:(?:read|list|search|query|status)$/u.test(scope));
  return digest({toolName:source.toolName,toolVersion:source.toolVersion,scopes:[...source.scopes].sort(),
    ...(!readOnly&&!localTaskTools.has(source.toolName)?{argumentsDigest:source.argumentsDigest}:{})});
}

// These are the registered connector inputs, not model-selected "important" fields.
// Optional fields remain visible when supplied. Unknown external writes show every
// original argument locally; injected credentials never belong in this projection.
const contentFields={
  'mail.send':['to','subject','text','?account'],
  'mail.archive':['folder','uid','uidValidity','messageId','?account'],
  'github.pr.create':['repo','title','body','head','base','expectedHeadSha','?draft'],
  'github.issue.comment':['repo','number','body'],
  'github.pr.comment':['repo','number','body'],
  'github.pr.review.comment':['repo','number','body','commitId','path','line','?expectedBaseSha','?side'],
  'github.issue.label':['repo','number','labels','expectedUpdatedAt'],
  'github.registered_merge':['repo','prNumber','headSha','baseSha','mergeMethod'],
  'github.registered_close_issue':['repo','prNumber','headSha','baseSha','issueId','mergedSha','expectedUpdatedAt','snapshotDigest'],
  'workspace.git.push':['repository','expectedHeadSha','?publication'],
};
const ordinaryExternalTools=new Set(['calendar.create','calendar.update','calendar.cancel','todo.create','todo.update']);
const desktopWrites=new Set(['activate','click','type','set_value','invoke','select','focus','scroll','move','drag','shortcut','press']
  .map(name=>'computer.desktop.'+name));
const credentialField=/(?:password|passwd|secret|token|credential|api[_-]?key|authorization|private[_-]?key|access[_-]?key)/iu;
const secretText=/(?:-----BEGIN (?:[A-Z]+ )?PRIVATE KEY-----|gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|\bsk-[A-Za-z0-9_-]{16,}|\bBearer\s+[A-Za-z0-9_.~+/-]{8,}|(?:password|passwd|api[_ -]?key|secret[_ -]?key|access[_ -]?token|密码|口令|验证码)\s*[:=]\s*["']?[^\s"',;}]{3,})/iu;
function classifyCredentialHint(hint) {
  if(/-----BEGIN|private|私钥/iu.test(hint))return '私钥';
  if(/password|passwd|密码|口令/iu.test(hint))return '密码/口令';
  if(/verification|otp|验证码/iu.test(hint))return '验证码';
  return '密钥/令牌';
}
function containsCredential(value) {
  return value!==null&&typeof value==='object'&&Object.entries(value).some(([name,item])=>credentialField.test(name)||containsCredential(item));
}
export function detectSecretsInText(text) {
  if(typeof text!=='string')return undefined;
  const globalSecret=new RegExp(secretText.source,'giu');
  const categories=new Set(),fingerprints=new Set();
  for(const match of text.matchAll(globalSecret)){
    categories.add(classifyCredentialHint(match[0]));
    fingerprints.add(digest({kind:'text',match:match[0].trim()}));
  }
  return fingerprints.size?{categories:[...categories],fingerprints:[...fingerprints].sort()}:undefined;
}
function collectArgumentSecrets(value,categories,fingerprints,depth=0) {
  if(depth>24)throw new ProtocolError('UNAUTHORIZED','无法安全校验本次操作参数，未获允许');
  if(typeof value==='string'){
    const detected=detectSecretsInText(value);
    if(detected){
      for(const category of detected.categories)categories.add(category);
      for(const fp of detected.fingerprints)fingerprints.add(fp);
    }
    return;
  }
  if(Array.isArray(value)){
    for(const item of value)collectArgumentSecrets(item,categories,fingerprints,depth+1);
    return;
  }
  if(value&&typeof value==='object'){
    for(const [name,item]of Object.entries(value)){
      if(credentialField.test(name)){
        categories.add(classifyCredentialHint(name));
        const normalized=item===null||item===undefined||typeof item==='object'?'':String(item).trim();
        fingerprints.add(digest({kind:'field',field:name.toLowerCase(),value:normalized}));
      }
      collectArgumentSecrets(item,categories,fingerprints,depth+1);
    }
  }
}
export function detectSecretsInArguments(source,{requireValidArgs=false}={}) {
  const args=source?.arguments;
  if(args===undefined){
    if(requireValidArgs&&requiresContentConfirmation(source))throw new ProtocolError('UNAUTHORIZED','无法安全校验本次操作参数，未获允许');
    return undefined;
  }
  if(args===null||typeof args!=='object'||Array.isArray(args)){
    if(requireValidArgs)throw new ProtocolError('UNAUTHORIZED','无法安全校验本次操作参数，未获允许');
    return undefined;
  }
  const categories=new Set(),fingerprints=new Set();
  collectArgumentSecrets(args,categories,fingerprints,0);
  return fingerprints.size?{categories:[...categories],fingerprints:[...fingerprints].sort()}:undefined;
}
export function assertNoSecretsInText(text) {
  if(detectSecretsInText(text)) {
    throw new ProtocolError('UNAUTHORIZED','检测到操作内容中包含疑似密钥或凭据信息，已阻止自动放行');
  }
}
export function assertNoCredentialsInArguments(source) {
  const detected=detectSecretsInArguments(source,{requireValidArgs:true});
  if(detected) {
    throw new ProtocolError('UNAUTHORIZED','检测到操作参数中包含疑似密钥、口令或凭据信息，已阻止执行');
  }
}
export function requiresContentConfirmation(source) {
  return source.toolName==='workflow.host.f23_n04'||Object.hasOwn(contentFields,source.toolName)||desktopWrites.has(source.toolName)
    ||source.sideEffect==='external_write'&&!ordinaryExternalTools.has(source.toolName)
    ||/(?:^|[.:_])(?:send|publish|delete|remove|pay|transfer|grant|revoke)(?:$|[.:_])/u.test(source.toolName);
}
export function operationContentConfirmation(source) {
  if(!requiresContentConfirmation(source))return undefined;
  const fields=Object.hasOwn(contentFields,source.toolName)?contentFields[source.toolName]:undefined;
  const args=source.arguments;
  if(!args||typeof args!=='object'||Array.isArray(args)||containsCredential(args)
    ||fields&&(fields.some(field=>!field.startsWith('?')&&!Object.hasOwn(args,field))
      ||Object.keys(args).some(name=>!fields.some(field=>field.replace(/^\?/u,'')===name))))
    throw new ProtocolError('UNAUTHORIZED','无法安全完整展示本次操作内容，未获允许');
  const projected=fields?Object.fromEntries(fields.map(field=>field.replace(/^\?/u,''))
    .filter(field=>Object.hasOwn(args,field)).map(field=>[field,args[field]])):args;
  const text=`请确认本次操作 ${source.toolName} 的完整目标与内容（文本中的转义字符按原值保留）：\n${JSON.stringify(projected,null,2)}`;
  return {digest:digest(text),text};
}

const clean=value=>typeof value==='string'?value.replace(/[\x00-\x1f]/gu,' ').trim().slice(0,160):'';
export function operationSummary(source) {
  const args=source.arguments??{},name=source.toolName;
  if(name==='calendar.events')return '查看本任务需要的日程，并将结果用于本次对话。';
  if(name==='calendar.update'){
    const changes=[clean(args.summary)&&`名称改为“${clean(args.summary)}”`,
      clean(args.startUtc)&&`开始时间 ${clean(args.startUtc)}`,clean(args.endUtc)&&`结束时间 ${clean(args.endUtc)}`].filter(Boolean);
    return `修改日程${clean(args.externalId??args.uid)?` ${clean(args.externalId??args.uid)}`:''}${changes.length?'：'+changes.join('，'):''}。`;
  }
  if(name==='calendar.create')return `创建日程${clean(args.summary)?`“${clean(args.summary)}”`:''}${clean(args.startUtc)?`，开始时间 ${clean(args.startUtc)}`:''}。`;
  if(name==='calendar.cancel')return `取消日程 ${clean(args.externalId??args.uid)}。`;
  if(name==='mail.inbox')return '读取本任务需要的邮件信头。';
  if(name.startsWith('workspace.'))return '在选定工作区完成本任务所需的文件操作或检查。';
  if(name==='todo.list')return '查看本任务需要的待办及提醒编号。';
  if(name==='todo.create')return `创建待办${clean(args.title)?`“${clean(args.title)}”`:''}。`;
  if(name==='todo.update'){
    const target=clean(args.id)?`编号 ${clean(args.id)} 的待办`:'本任务中的待办';
    const changes=[];
    if(args.status==='cancelled')changes.push('取消待办及其尚未触发的提醒');
    else if(args.status==='done')changes.push('标为完成并停止后续提醒');
    if(args.clearReminder===true)changes.push('清除提醒，保留待办记录');
    else if(Number.isSafeInteger(args.remindInMinutes))changes.push(`提醒改为 ${args.remindInMinutes} 分钟后`);
    else if(clean(args.remindUtc??args.remindLocal))changes.push(`提醒改为 ${clean(args.remindUtc??args.remindLocal)}`);
    if(clean(args.title))changes.push(`名称改为“${clean(args.title)}”`);
    return `更新${target}${changes.length?'：'+changes.join('，'):''}。`;
  }
  if(name==='runner.vps.status')return '查询已连接 VPS 主机与云桌面运行状态。';
  if(name==='runner.vps.exec'){
    const cmd=Array.isArray(args.command)?args.command.map(clean).filter(Boolean).join(' '):'';
    const targetLabel=args.target==='desktop'?'云桌面容器':'VPS 主机';
    return `在${targetLabel}执行受控命令${cmd?`：${cmd}`:''}。`;
  }
  if(name==='runner.vps.desktop'){
    const action=clean(args.desktopAction);
    const detail=clean(args.url)||(Array.isArray(args.command)?args.command.map(clean).filter(Boolean).join(' '):'');
    return `操作 VPS 云桌面（${action||'status'}${detail?`：${detail}`:''}）。`;
  }
  return `执行 ${clean(name)}。`;
}

// The trusted Live start already carries the user's explicit audio-purpose
// consent. File/process sandbox modes do not add a second microphone decision.
export const needsMicrophoneApproval=(_mode,purpose)=>purpose!=='live';

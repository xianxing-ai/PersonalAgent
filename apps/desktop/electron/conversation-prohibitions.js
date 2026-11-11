import {ProtocolError} from '@personal-agent/contracts';

export const prohibitionActions=['send','publish','delete','computer','payment','permission'];
export function validateConversationProhibitions(value) {
  if(!value||Object.keys(value).some(key=>!['revision','items'].includes(key))||!Number.isSafeInteger(value.revision)||value.revision<0
    ||!Array.isArray(value.items)||value.items.length>32)throw Error('本对话禁止项格式无效');
  const ids=new Set();
  for(const item of value.items){
    if(!item||Object.keys(item).some(key=>!['id','action','text'].includes(key))||typeof item.id!=='string'
      ||!/^[a-f0-9-]{36}$/u.test(item.id)||ids.has(item.id)||!prohibitionActions.includes(item.action)
      ||typeof item.text!=='string'||!item.text.trim()||item.text.length>4000||item.text.includes('\0'))throw Error('本对话禁止项格式无效');
    ids.add(item.id);
  }
  return structuredClone(value);
}
const ordinary=new Set(['calendar.create','calendar.update','todo.create','todo.update','feeds.collect','feeds.subscriptions',
  'workspace.apply_text_patch','workspace.stage_text_patch','workspace.preview_text_patch','workspace.node_check','workspace.npm_build','workspace.npm_test']);
/** Categories come from registered operations; prose and unclear object names never narrow a prohibition. */
export function conversationToolAction(toolName,sideEffect) {
  if(toolName==='mail.send'||/(?:^|[._])send(?:$|[._])/u.test(toolName))return 'send';
  if(['github.pr.create','github.pr.comment','github.pr.review.comment','github.issue.comment','github.registered_merge',
    'github.actions.repair.link','workspace.git.push','workflow.host.f23_n04'].includes(toolName)
    ||/(?:^|[._])publish(?:$|[._])/u.test(toolName))return 'publish';
  if(['mail.archive','calendar.cancel'].includes(toolName)||/(?:^|[._])(?:delete|remove|purge|trash)(?:$|[._])/u.test(toolName))return 'delete';
  if(/(?:^|[._])(?:pay|payment|transfer|purchase|charge)(?:$|[._])/u.test(toolName))return 'payment';
  if(/(?:^|[._])(?:grant|revoke|permission|permissions)(?:$|[._])/u.test(toolName))return 'permission';
  if(sideEffect==='read')return undefined;
  if(/^(?:computer\.desktop\.|browser\.)/u.test(toolName))return 'computer';
  return ordinary.has(toolName)?undefined:'unknown';
}
export function assertConversationProhibitions({rules,toolName,sideEffect}) {
  const checked=validateConversationProhibitions(rules);
  if(!checked.items.length)return;
  const action=conversationToolAction(toolName,sideEffect);
  if(action==='unknown'||checked.items.some(item=>item.action===action))
    throw new ProtocolError('UNAUTHORIZED',action==='unknown'?'本对话存在禁止项，无法确定本次操作类别或对象，未执行':'本对话禁止此类操作，请在侧边栏查看禁止项');
}

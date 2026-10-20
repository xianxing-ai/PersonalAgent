import {createHash} from 'node:crypto';

/** Same-conversation, public history only; the original reader retains cutoff/withheld filters. */
export function createConversationHistoryTool({readContext}) {
  const descriptor={name:'conversation.read_history',version:'1.0.0',sideEffect:'read',requiredScopes:['conversation:read'],
    requiresPresence:false,idempotencySupport:true,recoverySupport:true,
    inputSchema:{type:'object',additionalProperties:false,required:['messageIds'],properties:{messageIds:{type:'array',minItems:1,maxItems:8,uniqueItems:true,
      items:{type:'string',minLength:1,maxLength:256},description:'仅取回当前会话上下文中已有来源标识的原文；例如被省略的 omittedAssistantIds，不查询其他会话。'}}},
    outputSchema:{type:'object'}};
  const select=({taskId,signal},args)=>{
    if(signal?.aborted)throw Error('对话历史读取已取消');
    if(!Array.isArray(args?.messageIds)||!args.messageIds.length||args.messageIds.length>8
      ||new Set(args.messageIds).size!==args.messageIds.length||args.messageIds.some(id=>typeof id!=='string'||!id||id.length>256))throw Error('历史消息引用无效');
    const context=readContext({taskId,signal}),byId=new Map(context.map(message=>[message.id,message]));
    const messages=args.messageIds.map(id=>{
      const message=byId.get(id);
      if(!message||message.withheld)throw Error('历史来源不在本次会话的可读范围');
      return {id:message.id,role:message.role,content:message.content,
        ...(message.taskState?{taskState:message.taskState}:{}),
        contentDigest:createHash('sha256').update(message.content).digest('hex')};
    });
    const result={source:'conversation_history',treatment:'untrusted_data',messages};
    if(Buffer.byteLength(JSON.stringify(result),'utf8')>64*1024)throw Error('历史原文超过本次读取预算，请减少消息数量');
    return result;
  };
  const tool={descriptor,execute:(args,context)=>select(context,args)};
  const binding={toolName:descriptor.name,toolVersion:descriptor.version,exportPolicyVersion:'conversation-history-v1',
    accepts:({taskId,signal,arguments:args,phase,projection})=>{
      try{const selected=select({taskId,signal},args);return phase!=='final'||JSON.stringify(selected)===JSON.stringify(projection);}catch{return false;}
    },project:({result,signal})=>{if(signal?.aborted)throw Error('对话历史导出已取消');return result;}};
  return {tool,availability:{toolName:descriptor.name,toolVersion:descriptor.version,available:()=>true},binding};
}

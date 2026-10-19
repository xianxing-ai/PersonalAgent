import {toolArgumentsDigest} from '@personal-agent/tool-gateway';

const terminal=new Set(['succeeded','failed','cancelled','cancelling']);
const titles={
  'workspace.apply_text_patch':'应用文件修改','workspace.stage_text_patch':'准备文件修改',
  'workspace.git.commit':'提交本地代码','workspace.git.push':'推送代码',
  'goals.create':'创建目标','goals.revise':'修改目标',
  'proactive.workflow.start':'开始持续任务','proactive.workflow.control':'调整持续任务',
  'coding.repair.start':'准备本次编码工作区',
  'workflow.host.f15_n04':'预览本次代码修改','workflow.host.f15_n05':'核对本次代码验证结果',
  'workflow.host.f15_n06':'将本次代码修改交付到工作区',
  'computer.system.observe':'读取本机 CPU、内存和运行时间',
  'computer.desktop.observe':'查看本次电脑操作的当前界面',
  'computer.desktop.click':'点击已绑定的界面目标','computer.desktop.type':'在已绑定的界面输入文字',
  'computer.desktop.scroll':'滚动已绑定的界面','computer.desktop.move':'移动本次操作的鼠标',
  'computer.desktop.shortcut':'执行本次键盘快捷键',
};

/** Public health only; global native prompts and other conversations are not context. */
export function projectComputerConversationStatus(snapshot) {
  if(!snapshot)return {state:'unavailable',available:false};
  const states=new Set(['ready','unavailable','waiting_confirmation','blocked','disposed']);
  return {state:states.has(snapshot.state)?snapshot.state:'unavailable',available:snapshot.available===true,
    providerAvailable:snapshot.providerAvailable===true,
    observationExportAllowed:snapshot.observationExportAllowed===true,
    verification:'not_device_verified'};
}

function spokenArguments(value) {
  let omitted=false;
  const visit=(input,depth=0)=>{
    if(depth>4){omitted=true;return '嵌套参数未逐项播报';}
    if(typeof input==='string'){
      if(/(?:bearer\s+\S+|\bsk-[\w-]{12,}|(?:password|api[_-]?key|secret)\s*[:=])/i.test(input))return '凭据已隐藏';
      if(input.length>240){omitted=true;return `${input.slice(0,200)}…（共${input.length}字符）`;}
      return input;
    }
    if(Array.isArray(input)){if(input.length>8)omitted=true;return input.slice(0,8).map(item=>visit(item,depth+1));}
    if(input&&typeof input==='object'){
      if(Object.keys(input).length>20)omitted=true;
      return Object.fromEntries(Object.entries(input).slice(0,20).map(([key,item])=>[
      key,/(?:password|secret|authorization|credential|api[_-]?key|access[_-]?token|private[_-]?key|proof|signature|guard)/i.test(key)
        ?'凭据已隐藏':/^(?:content|text|patch|diff|body|sourceText)$/i.test(key)&&typeof item==='string'
          ?(omitted=true,`正文共${item.length}字符`):visit(item,depth+1),
    ]));
    }
    return input;
  };
  const text=JSON.stringify(visit(value));
  return `参数摘要：${text.slice(0,2400)}${omitted||text.length>2400?'；部分内容未逐项播报':''}`;
}

/** Trusted reads only. Conversation ownership does not grant tool or cloud access. */
export function createConversationToolAccess({getApplication,getConversations,now=Date.now}) {
  const resolveConversation=taskId=>{
    try {
      const id=getApplication()?.readToolConversation?.(taskId);
      return typeof id==='string'&&getConversations()?.containsConversation(id)===true?id:undefined;
    } catch {return undefined;}
  };
  const authorizeTaskRead=({taskId,conversationId})=>Boolean(conversationId)
    &&resolveConversation(taskId)===conversationId;
  const isConversationAllowed=(conversationId,taskId)=>{
    if(taskId===undefined)return getConversations()?.containsConversation(conversationId)===true;
    try {
      const resolved=resolveConversation(taskId),task=getApplication().runtime.getTask(taskId);
      return Boolean(resolved)&&(conversationId===resolved||conversationId===task.conversationId);
    } catch {return false;}
  };
  function readApproval(approvalId) {
    try {
      const application=getApplication(),runtime=application.runtime;
      const approval=runtime.getApproval(approvalId),task=runtime.getTask(approval.taskId);
      const conversationId=resolveConversation(task.taskId);
      if(!conversationId)return;
      if(approval.state!=='pending')return {...approval,conversationId,taskState:task.state};
      if(task.state!=='waiting_approval'||task.cancelRequested||!(Date.parse(approval.expiresAt)>now()))return;
      let proposal;
      if(typeof application.readPendingToolInvocation==='function') {
        proposal=application.readPendingToolInvocation(task.taskId,approvalId);
      } else {
        const loop=runtime.loadCheckpoint(task.taskId,'competition-loop');
        if(!Number.isSafeInteger(loop?.step)||approvalId!==`competition-tool-${task.taskId}-${loop.step}`
          ||loop?.pending?.kind!=='tool_proposal')return;
        proposal=loop.pending;
      }
      if(!proposal||proposal.toolName!==approval.toolName
        ||toolArgumentsDigest(proposal.arguments)!==approval.argumentsDigest)return;
      return {...approval,conversationId,taskState:task.state,
        summary:`${titles[approval.toolName]??'执行当前工具操作'}：${spokenArguments(proposal.arguments)}`};
    } catch {return undefined;}
  }
  function readPendingApproval({taskId,conversationId,deadline,signal}) {
    if(signal?.aborted||!(Date.parse(deadline)>now())||!authorizeTaskRead({taskId,conversationId}))return;
    try {
      const application=getApplication(),queue=[taskId],seen=new Set(),matches=[];
      for(let index=0;index<queue.length&&index<32;index++) {
        const id=queue[index];if(seen.has(id))continue;seen.add(id);
        if(!authorizeTaskRead({taskId:id,conversationId}))continue;
        const task=application.runtime.getTask(id);
        if(task.cancelRequested||terminal.has(task.state))continue;
        if(task.state==='waiting_approval') {
          const page=application.runtime.listApprovals({taskId:id,state:'pending',limit:10});
          for(const item of page.items) {
            const approval=readApproval(item.approvalId);
            if(approval?.state==='pending')matches.push({...approval,requestTaskId:taskId});
          }
        }
        for(const child of application.readSubagentTasks?.(id)??[]) {
          if(child.parentTaskId!==id||typeof child.taskId!=='string')continue;
          if(queue.length>=32)return;
          queue.push(child.taskId);
        }
        // F15 host operations are original Runtime host tasks, not Agent subtasks.
        const hostTask=application.readPendingOwnedWorkflowHostTask?.(id);
        if(hostTask&&typeof hostTask.taskId==='string'&&!seen.has(hostTask.taskId)){
          if(queue.length>=32)return;
          queue.push(hostTask.taskId);
        }
      }
      return matches.length===1?matches[0]:undefined;
    } catch {return undefined;}
  }
  return {resolveConversation,authorizeTaskRead,isConversationAllowed,readApproval,readPendingApproval};
}

import {ProtocolError,ToolNotStartedError,isToolNotStartedError,validateToolValue} from '@personal-agent/contracts';

const OBSERVE='computer.desktop.observe';
const reads=new Set([OBSERVE,'computer.desktop.list_windows','computer.desktop.screenshot','computer.desktop.wait','computer.desktop.suggest_control',
  'browser.observe','browser.screenshot','browser.wait']);
const controlled=name=>name==='computer.notepad.replace_text'||/^computer\.desktop\.[a-z_]+$/.test(name)||/^browser\.[a-z_]+$/.test(name);
const isWrite=name=>controlled(name)&&!reads.has(name);
export {isWrite as isComputerControlWrite};
// Native orchestration can end while its original tool outcome stays unknown.
// Normal running tasks include the current Gateway's not-yet-dispatched started record.
export const computerControlRecoveryTaskStates=Object.freeze(['waiting_reconciliation','failed','cancelled']);
const fail=(code,message)=>{throw new ProtocolError(code,message);};

/** One main-process input lease shared by the native Notepad and Windows-MCP
 * tools. It never grants permission, schedules work, persists state or replays a run.
 * getRuntime returns the original Runtime after main composition has bound it. */
export function createComputerControlLease({getRuntime,now=Date.now}={}) {
  let active,settling,closed=false;
  const wrappers=new WeakMap();
  const runtime=()=>{
    let value;
    try{value=getRuntime?.();}catch{/* No raw host errors in diagnostics. */}
    if(!value||typeof value.listTasks!=='function'||typeof value.readToolExecutions!=='function'
      ||typeof value.matchesToolExecutionInput!=='function')fail('UNSUPPORTED_CAPABILITY','原电脑操作记录读取尚不可用');
    return value;
  };
  function check(context) {
    if(closed||context.signal?.aborted)fail('CANCELLED','电脑操作已取消或宿主已关闭');
    if(!Number.isFinite(Date.parse(context.deadline))||now()>=Date.parse(context.deadline))fail('TIMEOUT','电脑操作期限已过');
  }
  function refreshSettling(source) {
    if(!settling)return;
    const record=source.readToolExecutions(settling.taskId).find(item=>item.evidenceId===settling.runId);
    if(!record||record.taskId!==settling.taskId||record.toolName!==settling.toolName||record.toolVersion!==settling.toolVersion
      ||!source.matchesToolExecutionInput(record,{arguments:settling.arguments,scopeRef:settling.authorizationRef}))return;
    const resolved=record.state==='confirmed'&&record.policyDecision==='allow'&&record.executionStarted===true
      &&(!settling.uncertain||record.reconciliationOutcome==='applied');
    const notApplied=record.state==='failed'&&record.reconciliationOutcome==='not_applied';
    if(resolved||notApplied)settling=undefined;
  }
  function originalUnknown(source) {
    let beforeSequence;
    do {
      const page=source.listTasks({states:computerControlRecoveryTaskStates,limit:100,
        ...(beforeSequence===undefined?{}:{beforeSequence})});
      if(!page||!Array.isArray(page.items))fail('UNSUPPORTED_CAPABILITY','原电脑操作记录读取无效');
      for(const task of page.items) {
        const records=source.readToolExecutions(task.taskId);
        if(!Array.isArray(records))fail('UNSUPPORTED_CAPABILITY','原电脑操作记录读取无效');
        if(records.some(record=>isWrite(record.toolName)&&record.policyDecision==='allow'&&record.executionStarted===true
          &&['started','unknown'].includes(record.state)))return true;
      }
      const next=page.nextBeforeSequence;
      if(next!==undefined&&(!Number.isSafeInteger(next)||next<0||(beforeSequence!==undefined&&next>=beforeSequence)))fail('UNSUPPORTED_CAPABILITY','原电脑操作记录分页无效');
      beforeSequence=next;
    }while(beforeSequence!==undefined);
    return false;
  }
  function wrap(tool) {
    if(!controlled(tool?.descriptor?.name??''))return tool;
    if(wrappers.has(tool))return wrappers.get(tool);
    const wrapped={...tool,descriptor:tool.descriptor,async execute(input,context){
      const write=isWrite(tool.descriptor.name);let source;
      try{
        check(context);
        if(active)fail('REVISION_CONFLICT','另一个电脑控制引擎正在执行；本次尚未调用设备');
        source=runtime();refreshSettling(source);
        if(write&&(settling||originalUnknown(source)))fail('RESULT_UNKNOWN','原电脑操作尚未核实；禁止新的电脑写入，不会重放原操作');
      }catch(error){
        // Only this trusted wrapper knows the driver has not been called.
        if(write)throw new ToolNotStartedError(error instanceof ProtocolError?error.code:'EXTERNAL_FAILURE',
          error instanceof ProtocolError?error.message:'原电脑操作记录读取失败，本次没有分派新输入');
        throw error;
      }
      const owner={taskId:context.taskId,runId:context.runId,toolName:tool.descriptor.name,toolVersion:tool.descriptor.version,
        authorizationRef:context.authorizationRef,arguments:structuredClone(input),uncertain:false};
      // There is no await between testing ownership and acquiring this lease.
      active=owner;
      try {
        const result=await tool.execute(input,context);
        check(context);
        validateToolValue(tool.descriptor.outputSchema,result);
        if(write&&(result?.state==='unknown'||result?.state==='result_unknown'))fail('RESULT_UNKNOWN','原电脑操作返回未知状态');
        // Runtime commits confirmed only after the tool promise returns. Retain
        // this one lease identity until that original commit or reconciliation.
        if(write)settling=owner;
        return result;
      }catch(error){
        if(write&&!isToolNotStartedError(error)){owner.uncertain=true;settling=owner;}
        throw error;
      }finally{if(active===owner)active=undefined;}
    }};
    wrappers.set(tool,wrapped);wrappers.set(wrapped,wrapped);return wrapped;
  }
  return {
    wrap,wrapTools:tools=>tools.map(wrap),
    snapshot(){
      try{const source=runtime();refreshSettling(source);return {state:closed?'closed':active?'active':settling||originalUnknown(source)?'blocked':'idle',
        busy:!!active,writeBlocked:closed||!!active||!!settling||originalUnknown(source)};}
      catch{return {state:closed?'closed':'unavailable',busy:!!active,writeBlocked:true};}
    },
    close(){closed=true;},
  };
}

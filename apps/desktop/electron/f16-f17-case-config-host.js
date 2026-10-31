import {closeSync,constants,existsSync,fstatSync,lstatSync,mkdirSync,openSync,readFileSync,readSync,realpathSync,renameSync,writeFileSync} from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {ProtocolError,validateToolValue} from '@personal-agent/contracts';
import {F16_F17_CONFIGURATIONS} from './f16-f17-workflow-ports.js';

const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const fail=()=>{throw new ProtocolError('UNSUPPORTED_CAPABILITY','F16/F17 原生 case 选择或工作区固定命令不可用');};
const samePath=(a,b)=>process.platform==='win32'?a.toLowerCase()===b.toLowerCase():a===b;
function assertNativeCasePath(selected){
  if(!samePath(realpathSync.native(selected),path.resolve(selected)))fail();
  for(let directory=path.dirname(selected);;directory=path.dirname(directory)){
    const stat=lstatSync(directory);if(!stat.isDirectory()||stat.isSymbolicLink())fail();
    if(directory===path.dirname(directory))break;
  }
}
const f17Schema={type:'object',additionalProperties:false,required:['selectionRef','repository','recipeId'],
  properties:Object.fromEntries(['selectionRef','repository','recipeId'].map(key=>[key,F16_F17_CONFIGURATIONS.F17.inputSchema.properties[key]]))};

/** Main-only selection, not authorization. No output, TaskRuntime task/run IDs,
 * stack or approval is accepted from JSON. F17 obtains these solely from TaskRuntime. */
export function createF16F17CaseConfiguration({userData,safeStorage,readWorkspace,selectFile}) {
  const file=path.join(userData,'f16-f17-workflow-cases.json');let saved={};
  try{
    if(existsSync(file)&&safeStorage.isEncryptionAvailable()){
      const record=JSON.parse(readFileSync(file,'utf8'));
      if(record.version===1&&typeof record.encrypted==='string')saved=JSON.parse(safeStorage.decryptString(Buffer.from(record.encrypted,'base64')));
    }
  }catch{/* Unreadable configuration stays unavailable. */}
  function checked(workflow,value,workspace){
    if(!['F16','F17'].includes(workflow)||!workspace?.bindingId||!path.isAbsolute(workspace.rootPath??'')
      ||!Array.isArray(workspace.command?.recipeIds)||!workspace.command.recipeIds.includes(value?.recipeId))fail();
    validateToolValue(workflow==='F17'?f17Schema:F16_F17_CONFIGURATIONS.F16.inputSchema,value);
  }
  function current(workflow){
    try{
      const workspace=readWorkspace(),record=saved[workflow];
      if(!record||record.workspaceBinding!==workspace?.bindingId)return;
      checked(workflow,record.selection,workspace);
      return {workspace,selection:structuredClone(record.selection),configurationRef:hash(record)};
    }catch{return undefined;}
  }
  const host={
    setFromNativeSelection(workflow,value){
      const workspace=readWorkspace();checked(workflow,value,workspace);
      if(!safeStorage.isEncryptionAvailable())fail();
      const next={...saved,[workflow]:{workspaceBinding:workspace.bindingId,selection:structuredClone(value)}};
      const encrypted=safeStorage.encryptString(JSON.stringify(next)).toString('base64');
      mkdirSync(userData,{recursive:true});writeFileSync(file+'.tmp',JSON.stringify({version:1,encrypted}),'utf8');renameSync(file+'.tmp',file);
      saved=next;return host.snapshot(workflow);
    },
    async selectFromNativeDialog(workflow){
      if(!['F16','F17'].includes(workflow)||typeof selectFile!=='function')fail();
      const binding=readWorkspace()?.bindingId;if(!binding)fail();
      const selected=await selectFile(workflow);if(selected===undefined)return host.snapshot(workflow);
      if(readWorkspace()?.bindingId!==binding||typeof selected!=='string'||!path.isAbsolute(selected))fail();
      assertNativeCasePath(selected);
      const stat=lstatSync(selected);
      if(!stat.isFile()||stat.isSymbolicLink()||stat.size>256*1024)fail();
      const fd=openSync(selected,constants.O_RDONLY|(constants.O_NOFOLLOW??0)|(constants.O_NONBLOCK??0));
      try{
        const opened=fstatSync(fd);
        if(!opened.isFile()||opened.dev!==stat.dev||opened.ino!==stat.ino)fail();
        const bytes=Buffer.alloc(256*1024+1);let size=0,count;
        while(size<bytes.length&&(count=readSync(fd,bytes,size,bytes.length-size,null))>0)size+=count;
        const after=fstatSync(fd);
        if(size>256*1024||after.size!==opened.size||after.mtimeMs!==opened.mtimeMs||after.ctimeMs!==opened.ctimeMs)fail();
        assertNativeCasePath(selected);const current=lstatSync(selected);
        if(!current.isFile()||current.isSymbolicLink()||current.dev!==after.dev||current.ino!==after.ino
          ||current.size!==after.size||current.mtimeMs!==after.mtimeMs||current.ctimeMs!==after.ctimeMs)fail();
        return host.setFromNativeSelection(workflow,JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes.subarray(0,size))));
      }finally{closeSync(fd);}
    },
    snapshot(workflow){const value=current(workflow);return value?{configured:true,selectionRef:value.selection.selectionRef}:{configured:false};},
    read(workflow,scope){
      const value=current(workflow);
      if(!value||!scope?.signal||scope.signal.aborted||!Number.isFinite(Date.parse(scope.deadline))||Date.now()>=Date.parse(scope.deadline)
        ||value.workspace.available(scope)!==true)return undefined;
      return {selection:value.selection,configurationRef:value.configurationRef};
    },
  };return host;
}

import {existsSync,lstatSync,mkdirSync,readFileSync,realpathSync,renameSync,statSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {ProtocolError} from '@personal-agent/contracts';

const digest=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const reference=/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u;
function relative(value) {
  return typeof value==='string'&&value.length>0&&value.length<=1024&&!path.isAbsolute(value)
    &&!/[\\:\u0000-\u001f\u007f]/u.test(value)&&value.split('/').every(part=>part&&part!=='.'&&part!=='..');
}
function sourceFile(root,value) {
  if(!relative(value))throw new ProtocolError('INVALID_ARGUMENT','F20 source must be a relative workspace file');
  let current=root;
  for(const segment of value.split('/')) {
    current=path.join(current,segment);
    if(lstatSync(current).isSymbolicLink())throw new ProtocolError('UNAUTHORIZED','F20 source cannot use a link');
  }
  const target=realpathSync.native(current),within=path.relative(root,target);
  if(!within||within==='..'||within.startsWith(`..${path.sep}`)||path.isAbsolute(within)||!statSync(target).isFile())
    throw new ProtocolError('UNAUTHORIZED','F20 source is outside the selected workspace');
}
function shape(value) {
  return value&&typeof value==='object'&&!Array.isArray(value)
    &&Object.keys(value).sort().join(',')==='codeFile,docTemplate,inputRef,recipeId,schemaFile,targetDoc'
    &&reference.test(value.inputRef)&&relative(value.schemaFile)&&relative(value.codeFile)&&relative(value.targetDoc)
    &&typeof value.recipeId==='string'&&/^[a-z][a-z0-9._-]{0,63}$/u.test(value.recipeId)
    &&typeof value.docTemplate==='string'&&value.docTemplate.length>0&&value.docTemplate.length<=4096&&!value.docTemplate.includes('\0');
}

/** Main-process configuration only. This stores no authorization, frontier proof or
 * completion claim. Call setFromNativeSelection only for an explicit user selection. */
export function createF20CaseConfiguration({userData,safeStorage,readWorkspace}) {
  const file=path.join(userData,'f20-workflow-case.json');let saved;
  try {
    if(existsSync(file)&&safeStorage.isEncryptionAvailable()) {
      const record=JSON.parse(readFileSync(file,'utf8'));
      if(record.version===1&&typeof record.encrypted==='string')saved=JSON.parse(safeStorage.decryptString(Buffer.from(record.encrypted,'base64')));
    }
  }catch{/* An unreadable configuration remains unavailable. */}
  function checked(value,workspace) {
    if(!shape(value)||!workspace||typeof workspace.bindingId!=='string'||!workspace.bindingId
      ||typeof workspace.rootPath!=='string'||!path.isAbsolute(workspace.rootPath)
      ||!Array.isArray(workspace.recipeIds)||!workspace.recipeIds.includes(value.recipeId))
      throw new ProtocolError('UNSUPPORTED_CAPABILITY','F20 case or fixed recipe is unavailable');
    if(value.recipeId==='node-check'&&workspace.checkFile!==value.codeFile)
      throw new ProtocolError('UNAUTHORIZED','F20 Node recipe must check the selected code file');
    sourceFile(workspace.rootPath,value.schemaFile);sourceFile(workspace.rootPath,value.codeFile);
  }
  function current() {
    try {
      const workspace=readWorkspace();
      if(!saved||saved.version!==1||saved.workspaceBinding!==workspace?.bindingId||!shape(saved.case))return;
      checked(saved.case,workspace);return {workspace,configuration:saved.case};
    }catch{return undefined;}
  }
  return {
    setFromNativeSelection(value) {
      const workspace=readWorkspace();checked(value,workspace);
      if(!safeStorage.isEncryptionAvailable())throw new ProtocolError('UNSUPPORTED_CAPABILITY','Secure F20 configuration storage is unavailable');
      const record={version:1,workspaceBinding:workspace.bindingId,case:structuredClone(value)};
      const encrypted=safeStorage.encryptString(JSON.stringify(record)).toString('base64');
      mkdirSync(userData,{recursive:true});writeFileSync(file+'.tmp',JSON.stringify({version:1,encrypted}),'utf8');renameSync(file+'.tmp',file);
      saved=record;return {configured:true,inputRef:value.inputRef};
    },
    snapshot(){const value=current();return value?{configured:true,inputRef:value.configuration.inputRef}:{configured:false};},
    resolveInput(inputRef,scope) {
      const value=current();if(!value||inputRef!==value.configuration.inputRef||!scope?.signal||scope.signal.aborted
        ||!Number.isFinite(Date.parse(scope.deadline))||Date.now()>=Date.parse(scope.deadline)
        ||typeof value.workspace.available!=='function'||!value.workspace.available(scope))return undefined;
      const {inputRef:_inputRef,...fixed}=value.configuration;
      // This identifies the fixed configuration, not the contents of either source.
      return {...structuredClone(fixed),sourceVersion:digest({version:1,workspaceBinding:value.workspace.bindingId,configuration:value.configuration})};
    },
  };
}

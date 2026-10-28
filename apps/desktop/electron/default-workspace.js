import {existsSync,linkSync,lstatSync,mkdirSync,readFileSync,realpathSync,statSync,unlinkSync,writeFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import path from 'node:path';

// This is a configuration readback only, not proof that tools are assembled.
// Never expose the saved path or encrypted value to the renderer.
export function readSavedWorkspaceStatus({userData,safeStorage}) {
  const unavailable={configured:false,selectionAvailable:false,reason:'工作文件夹配置无法读取；原配置已保留，连接 AI 后可检查'};
  try {
    const record=JSON.parse(readFileSync(path.join(userData,'coding-workspace.json'),'utf8'));
    if(record.version!==1||typeof record.encrypted!=='string'||!safeStorage.isEncryptionAvailable())return unavailable;
    const saved=safeStorage.decryptString(Buffer.from(record.encrypted,'base64'));
    if(typeof saved!=='string'||!path.isAbsolute(saved)||saved.startsWith('\\\\')||lstatSync(saved).isSymbolicLink())return unavailable;
    const root=realpathSync.native(saved);
    if(root===path.parse(root).root||!statSync(root).isDirectory())return unavailable;
    return {configured:true,selectionAvailable:false,displayName:path.basename(root),
      reason:'已保存；连接 AI 后装配工具，写入仍需原授权'};
  } catch {return unavailable;}
}

// Create only an app-owned default. Never replace a selected or unreadable
// configuration, and never turn the folder itself into an execution grant.
export function initializeDefaultWorkspace({userData,workspace,safeStorage}) {
  const target=path.join(userData,'coding-workspace.json');
  if(existsSync(target))return false;
  if(!safeStorage.isEncryptionAvailable())throw Error('本机安全存储不可用');
  if(!path.isAbsolute(userData)||!path.isAbsolute(workspace)
    || path.dirname(path.resolve(workspace))!==path.resolve(userData))throw Error('默认工作文件夹路径无效');
  mkdirSync(userData,{recursive:true});
  mkdirSync(workspace,{recursive:true});
  if(lstatSync(workspace).isSymbolicLink())throw Error('默认工作文件夹不能是链接');
  const parent=realpathSync.native(userData),root=realpathSync.native(workspace),relative=path.relative(parent,root);
  if(!relative || relative==='..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)
    || !statSync(root).isDirectory())throw Error('默认工作文件夹不在应用目录内');

  const probe=path.join(root,`.personal-agent-probe-${randomUUID()}`),contents='PersonalAgent workspace probe';
  let createdProbe=false;
  try {
    writeFileSync(probe,contents,{encoding:'utf8',flag:'wx',mode:0o600});createdProbe=true;
    if(readFileSync(probe,'utf8')!==contents)throw Error('默认工作文件夹读写核对失败');
  } finally {if(createdProbe)unlinkSync(probe);}

  const record={version:1,encrypted:safeStorage.encryptString(root).toString('base64')};
  const temporary=path.join(userData,`.coding-workspace-default-${randomUUID()}.tmp`);
  let createdTemporary=false;
  try {
    writeFileSync(temporary,JSON.stringify(record),{encoding:'utf8',flag:'wx',mode:0o600});createdTemporary=true;
    // A hard link publishes the complete record only if no other selection has
    // appeared since the initial check. It cannot overwrite existing bytes.
    try {linkSync(temporary,target);} catch(error) {if(error?.code==='EEXIST')return false;throw error;}
    return true;
  } finally {if(createdTemporary)unlinkSync(temporary);}
}

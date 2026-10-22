import {execFileSync} from 'node:child_process';
import {AsyncLocalStorage} from 'node:async_hooks';
import {createHash, randomUUID} from 'node:crypto';
import {existsSync, lstatSync, mkdirSync, readFileSync, realpathSync, renameSync, statSync, writeFileSync} from 'node:fs';
import path from 'node:path';
import {openReadOnlyVault} from '@personal-agent/knowledge/filesystem';
import {createWikiPort} from '@personal-agent/knowledge/wiki';
import {localVaultPairingIdentity} from '@personal-agent/knowledge/pairing';
import {openControlledVaultWriter} from '@personal-agent/knowledge/write';
import {verifyWindowsRecoveryAcl} from './coding-tool-host.js';

function directory(value) {
  if (typeof value !== 'string' || !path.isAbsolute(value) || value.startsWith('\\\\')) throw Error('请选择本机普通知识库目录');
  const full = path.resolve(value), volume = path.parse(full).root;
  if (full === volume) throw Error('不能选择整个磁盘');
  let cursor = volume;
  for (const part of path.relative(volume, full).split(path.sep)) {
    cursor = path.join(cursor, part);
    if (lstatSync(cursor).isSymbolicLink()) throw Error('知识库路径不能包含链接');
  }
  const root = realpathSync.native(full);
  if (!statSync(root).isDirectory()) throw Error('知识库目录不可用');
  return root;
}
function identity(root) {
  const stat = statSync(root, {bigint: true});
  return {dev: String(stat.dev), ino: String(stat.ino), birthtimeNs: String(stat.birthtimeNs)};
}
function sameIdentity(left, right) {
  return left && ['dev', 'ino', 'birthtimeNs'].every(key => left[key] === right[key]);
}
function canonicalProcessIdentityHelper(value) {
  if (typeof value !== 'string' || !path.isAbsolute(value)) throw Error('Process identity helper must be an absolute path');
  const full = path.resolve(value);
  if (lstatSync(full).isSymbolicLink()) throw Error('Process identity helper must not be a link');
  const canonical = realpathSync.native(full);
  if (!statSync(canonical).isFile() || path.basename(canonical).toLowerCase() !== 'windowsjobprocesshost.exe') {
    throw Error('Process identity helper must be WindowsJobProcessHost.exe');
  }
  return canonical;
}
function executableIdentity(file) {
  const stat = statSync(file, {bigint: true});
  return {dev: String(stat.dev), ino: String(stat.ino), birthtimeNs: String(stat.birthtimeNs),
    size: String(stat.size), mtimeNs: String(stat.mtimeNs)};
}
function sameExecutableIdentity(left, right) {
  return left && right && Object.keys(left).length === Object.keys(right).length
    && Object.keys(left).every(key => left[key] === right[key]);
}
function note(root, selected) {
  if (typeof selected !== 'string' || !path.isAbsolute(selected)) throw Error('请选择知识库内的 Markdown 笔记');
  const full = path.resolve(selected), relative = path.relative(root, full).split(path.sep).join('/');
  if (!relative || relative.startsWith('../') || path.isAbsolute(relative) || !/\.md$/i.test(relative)
    || relative.includes(':') || relative.split('/').some(part => !part || part.startsWith('.') || /[. ]$/.test(part))) {
    throw Error('整理范围必须是已选知识库内的笔记');
  }
  let cursor = root;
  for (const part of relative.split('/')) {
    cursor = path.join(cursor, part);
    if (lstatSync(cursor).isSymbolicLink()) throw Error('整理范围不能包含链接');
  }
  const stat = statSync(full);
  if (!stat.isFile() || stat.nlink !== 1 || realpathSync.native(full) !== full) throw Error('请选择普通笔记文件');
  return relative;
}
function validateSaved(record, namespace, hostIdentity) {
  if (!record || record.version !== 1 || record.namespace !== namespace || record.hostIdentity !== hostIdentity
    || !/^[a-f0-9-]{36}$/.test(record.sourceId) || !Number.isSafeInteger(record.configRevision)
    || record.configRevision < 1 || typeof record.enabled !== 'boolean'
    || !['private', 'public'].includes(record.dataLevel) || !Array.isArray(record.allowedNotePaths)
    || record.allowedNotePaths.length > 32) throw Error('知识源配置无效');
  const root = directory(record.rootPath);
  if (root !== record.rootPath || !sameIdentity(identity(root), record.rootIdentity)) throw Error('知识库身份已改变');
  for (const relative of record.allowedNotePaths) {
    if (typeof relative !== 'string' || note(root, path.join(root, relative)) !== relative) throw Error('笔记范围已改变');
  }
  return record;
}
function prepareRecovery(userData, sourceId, powerShellPath) {
  if (process.platform !== 'win32' || typeof powerShellPath !== 'string'
    || path.basename(powerShellPath).toLowerCase() !== 'pwsh.exe') throw Error('安全整理需要可信 PowerShell 7');
  const target = path.join(userData, 'knowledge-recovery', sourceId);
  if (!existsSync(target)) {
    mkdirSync(target, {recursive: true});
    const script = String.raw`$ErrorActionPreference='Stop'
$target=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${Buffer.from(target,'utf8').toString('base64')}'))
$self=[System.Security.Principal.WindowsIdentity]::GetCurrent().User
$acl=[System.Security.AccessControl.DirectorySecurity]::new()
$acl.SetOwner($self)
$acl.SetAccessRuleProtection($true,$false)
$acl.AddAccessRule([System.Security.AccessControl.FileSystemAccessRule]::new($self,'FullControl','ContainerInherit,ObjectInherit','None','Allow'))
Set-Acl -LiteralPath $target -AclObject $acl`;
    execFileSync(powerShellPath, ['-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand',
      Buffer.from(script, 'utf16le').toString('base64')],
    {encoding: 'utf8', timeout: 10000, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe']});
  }
  verifyWindowsRecoveryAcl(target, powerShellPath);
  return directory(target);
}

/** Main-process only. Native pickers supply paths; snapshots never expose roots or host identity.
 * No environment/default-directory fallback. Write/export consent always expires on restart.
 */
export async function createKnowledgeSourceConfig({userData, safeStorage, namespace, hostIdentity,
  selectDirectory, selectNoteFiles, confirmPermissions = async () => false, powerShellPath, processIdentityHelperPath,
  question, confirmCatalog=async()=>false,
  prepareRecoveryDirectory = prepareRecovery}) {
  if (!/^[A-Za-z0-9_.:-]{1,128}$/.test(namespace ?? '') || typeof hostIdentity !== 'string' || !hostIdentity) {
    throw Error('缺少受信知识源身份');
  }
  const file = path.join(userData, 'knowledge-source-config.json');
  let saved, vault, writer, busy = false, closed = false, failure = '';
  let writerBindingCurrent = () => false;
  const writerCurrent = () => { try { return writerBindingCurrent(); } catch { return false; } };
  let writeAllowed = false, cloudExportAllowed = false, publicQueries = [];
  const inflight = new Set();
  const executionContext=new AsyncLocalStorage();
  const authorizationKey='knowledge-source';
  const assertAuthorization=context=>{
    if(!context||!question||context.signal?.aborted||!(Date.parse(context.deadline)>Date.now()))throw Error('原知识操作授权不可用或已失效');
    question.currentRequirement(context,authorizationKey);
  };
  const invalidate = () => {
    for (const controller of inflight) controller.abort();
    vault?.clearIndex();
    vault = undefined; writer = undefined; writerBindingCurrent = () => false; writeAllowed = false; cloudExportAllowed = false; publicQueries = [];
  };
  const current = () => {
    try {return !closed && Boolean(saved?.enabled && vault)
      && directory(saved.rootPath) === saved.rootPath && sameIdentity(identity(saved.rootPath), saved.rootIdentity);}
    catch {return false;}
  };
  const snapshot = () => ({configured: Boolean(saved), enabled: saved?.enabled === true,
    available: current(), sourceId: saved?.sourceId ?? '', namespace,
    configRevision: saved?.configRevision ?? 0, dataLevel: saved?.dataLevel ?? 'private',
    displayName: saved ? path.basename(saved.rootPath) : '',
    allowedNotePaths: [...(saved?.allowedNotePaths ?? [])], writeAvailable: current() && writeAllowed && Boolean(writer) && writerCurrent(),
    cloudExportAllowed: current() && cloudExportAllowed && saved.dataLevel === 'public',
    publicQueries: cloudExportAllowed ? [...publicQueries] : [],
    reason: failure || (!saved ? '请选择知识库；尚未配置' : !saved.enabled ? '知识源已停用'
      : !current() ? '知识库身份已改变，请重新选择' : writeAllowed ? '已连接；整理仍需逐次 Policy 审批' : '已连接，只读；私人内容仅留本机')});
  const persist = record => {
    if (!safeStorage.isEncryptionAvailable()) throw Error('本机安全存储不可用，未保存知识源');
    const encrypted = safeStorage.encryptString(JSON.stringify(record)).toString('base64');
    mkdirSync(userData, {recursive: true});
    writeFileSync(file + '.tmp', JSON.stringify({version: 1, encrypted}), {encoding: 'utf8', mode: 0o600});
    renameSync(file + '.tmp', file);
  };
  async function bind(record, permissions = {}) {
    const port = record.enabled ? await openReadOnlyVault({vaultId: record.sourceId, rootPath: record.rootPath}) : undefined;
    saved = record; vault = port; failure = '';
    if (record.enabled && record.allowedNotePaths.length && powerShellPath) {
      try {
        // Same physical Vault always uses the same durable note locks, across selection and source-ID changes.
        const recoveryKey = createHash('sha256').update(JSON.stringify([namespace, hostIdentity, record.rootPath, record.rootIdentity])).digest('hex');
        const recoveryRootPath = prepareRecoveryDirectory(userData, recoveryKey, powerShellPath);
        const helperPath = processIdentityHelperPath === undefined
          ? undefined : canonicalProcessIdentityHelper(processIdentityHelperPath);
        const helperId = helperPath === undefined ? undefined : executableIdentity(helperPath);
        const helperCurrent = () => {
          if (helperPath === undefined) return true;
          try {
            const currentHelper = canonicalProcessIdentityHelper(processIdentityHelperPath);
            return currentHelper === helperPath && sameExecutableIdentity(executableIdentity(currentHelper), helperId);
          } catch { return false; }
        };
        const bindingCurrent = () => {
          const context=executionContext.getStore();if(context)assertAuthorization(context);
          return current() && saved === record && helperCurrent()
            && (verifyWindowsRecoveryAcl(recoveryRootPath, powerShellPath), true);
        };
        writerBindingCurrent = bindingCurrent;
        writer = openControlledVaultWriter({rootPath: record.rootPath, recoveryRootPath, powerShellPath,
          ...(helperPath === undefined ? {} : {processIdentityHelperPath: helperPath}),
          sourceId: record.sourceId, configRevision: record.configRevision, allowedNotePaths: record.allowedNotePaths,
          bindingCurrent});
        writeAllowed = permissions.writeAllowed === true;
      } catch {
        writerBindingCurrent = () => false;
        writer = undefined;
        if (permissions.writeAllowed) failure = '只读已连接；安全整理宿主不可用，写入未启用';
      }
    }
    if (permissions.writeAllowed && !writer) failure = '只读已连接；安全整理宿主不可用，写入未启用';
    cloudExportAllowed = permissions.cloudExportAllowed === true && record.enabled && record.dataLevel === 'public';
    publicQueries = cloudExportAllowed ? [...permissions.publicQueries] : [];
  }
  try {
    if (existsSync(file)) {
      const stored = JSON.parse(readFileSync(file, 'utf8'));
      if (stored.version === 1 && stored.revoked === true && Object.keys(stored).length === 2) {
        failure = '知识源已撤销，请重新选择';
      } else {
        if (stored.version !== 1 || typeof stored.encrypted !== 'string' || !safeStorage.isEncryptionAvailable()) throw Error();
        await bind(validateSaved(JSON.parse(safeStorage.decryptString(Buffer.from(stored.encrypted, 'base64'))), namespace, hostIdentity));
      }
    }
  } catch {invalidate(); saved = undefined; failure = '已保存知识源不可用，请重新选择；不会使用旧目录';}
  async function mutate(action) {
    if (closed || busy) throw Error('知识源正在变更，请稍后重试');
    busy = true;
    try {return await action();}
    catch {failure = '知识源操作未完成，请检查配置或冲突后重试'; throw Error(failure);}
    finally {busy = false;}
  }
  const checkBinding = expected => {
    if (!current() || expected?.sourceId !== saved.sourceId || expected?.configRevision !== saved.configRevision) {
      throw Error('知识源已停用、撤销或版本改变');
    }
  };
  return {
    snapshot,
    prepareAuthorization(scope) {
      if(!['knowledge.search','knowledge.apply_note_patch'].includes(scope.toolName))return;
      if(!current()||!question)throw Error('知识源或原对话授权卡不可用');
      const record=saved,writing=scope.toolName==='knowledge.apply_note_patch';
      if(writing&&!writeAllowed)throw Error('知识源未配置整理能力');
      const bindingDigest=createHash('sha256').update(JSON.stringify({sourceId:record.sourceId,configRevision:record.configRevision,
        rootIdentity:record.rootIdentity,dataLevel:record.dataLevel,allowedNotePaths:record.allowedNotePaths})).digest('hex');
      question.prepare(scope,{requirements:[{requirementId:authorizationKey,kind:'tool',scopes:[writing?'knowledge:write':'knowledge:read'],
        bindingDigest,summary:writing?'按原精确参数整理所选知识笔记；仅本次写入，保留原冲突与恢复记录。':'只读查询所选知识源；仅原查询与本次结果，不自动授权正文出机。'}],
        assertCurrent:()=>current()&&saved===record&&(!writing||writeAllowed)});
    },
    assertAuthorization,
    withAuthorization(context,work) {assertAuthorization(context);return executionContext.run({...context},work);},
    async authorizeCatalog(scope) {
      if(!current()||!cloudExportAllowed||saved.dataLevel!=='public'||scope.signal?.aborted)return false;
      const record=saved,payload={sourceId:record.sourceId,configRevision:record.configRevision,dataLevel:record.dataLevel,
        publicQueries:[...publicQueries],allowedNotePaths:[...record.allowedNotePaths],writeConfigured:writeAllowed};
      const isCurrent=()=>current()&&saved===record&&cloudExportAllowed&&!scope.signal.aborted&&Date.now()<Date.parse(scope.deadline);
      const allowed=await confirmCatalog({payload,scope:{taskId:scope.taskId,sourceId:record.sourceId,configRevision:record.configRevision},
        summary:`向本任务公布已标记PUBLIC的知识查询/笔记范围目录（${publicQueries.length}个查询、${record.allowedNotePaths.length}篇笔记）；实际读写与内容出机仍由原工具卡核对。`,
        deadline:scope.deadline,signal:scope.signal,isCurrent});
      return allowed===true&&isCurrent();
    },
    clearIndex() {
      for (const controller of inflight) controller.abort();
      vault?.clearIndex();
    },
    async select() {return mutate(async () => {
      const selected = await selectDirectory(); if (!selected) return snapshot();
      const rootPath = directory(selected), revision = (saved?.configRevision ?? 0) + 1;
      invalidate();
      const record = {version: 1, namespace, hostIdentity, sourceId: randomUUID(), configRevision: revision,
        rootPath, rootIdentity: identity(rootPath), enabled: true, dataLevel: 'private', allowedNotePaths: []};
      persist(record); await bind(record); return snapshot();
    });},
    async selectNotes(expected) {return mutate(async () => {
      checkBinding(expected);
      const selected = await selectNoteFiles(saved.rootPath); if (!selected?.length) return snapshot();
      checkBinding(expected);
      if (selected.length > 32) throw Error('一次最多选择 32 篇笔记');
      const record = {...saved, configRevision: saved.configRevision + 1,
        allowedNotePaths: [...new Set(selected.map(value => note(saved.rootPath, value)))]};
      invalidate(); persist(record); await bind(record); return snapshot();
    });},
    async configure(input) {return mutate(async () => {
      if (!input || Object.keys(input).some(key => !['sourceId', 'configRevision', 'enabled', 'dataLevel',
        'writeAllowed', 'cloudExportAllowed', 'publicQueries'].includes(key)) || !saved
        || input.sourceId !== saved.sourceId || input.configRevision !== saved.configRevision
        || typeof input.enabled !== 'boolean' || !['private', 'public'].includes(input.dataLevel)
        || typeof input.writeAllowed !== 'boolean' || typeof input.cloudExportAllowed !== 'boolean'
        || !Array.isArray(input.publicQueries) || input.publicQueries.length > 16
        || input.publicQueries.some(value => typeof value !== 'string' || !value.trim() || value.length > 128)) throw Error();
      if (input.writeAllowed && (!input.enabled || !saved.allowedNotePaths.length)
        || input.cloudExportAllowed && (!input.enabled || input.dataLevel !== 'public' || !input.publicQueries.length)) throw Error();
      if ((input.writeAllowed || input.cloudExportAllowed) && !await confirmPermissions({
        sourceId:saved.sourceId,configRevision:saved.configRevision,enabled:input.enabled,dataLevel:input.dataLevel,
        displayName: path.basename(saved.rootPath), noteCount: saved.allowedNotePaths.length,
        allowedNotePaths:[...saved.allowedNotePaths],isCurrent:()=>current()&&input.sourceId===saved.sourceId&&input.configRevision===saved.configRevision,
        writeAllowed: input.writeAllowed, cloudExportAllowed: input.cloudExportAllowed,
        publicQueries: [...input.publicQueries]})) return snapshot();
      const record = {...saved, configRevision: saved.configRevision + 1,
        enabled: input.enabled, dataLevel: input.dataLevel};
      invalidate(); persist(record); await bind(record, input); return snapshot();
    });},
    async revoke() {return mutate(async () => {
      invalidate();
      saved = undefined;
      // Also replace an unreadable old encrypted configuration. Failure is reported, never claimed as persisted.
      mkdirSync(userData, {recursive: true});
      writeFileSync(file + '.tmp', JSON.stringify({version: 1, revoked: true}), {encoding: 'utf8', mode: 0o600});
      renameSync(file + '.tmp', file);
      failure = '知识源已撤销，请重新选择'; return snapshot();
    });},
    /** Trusted local admin consumers use this same binding as the Runtime tool factory. */
    pairingIdentity() {return current() ? localVaultPairingIdentity(saved.rootPath) : undefined;},
    acquire(expected, signal) {
      checkBinding(expected);
      const controller = new AbortController(); inflight.add(controller);
      let released = false;
      const binding = snapshot(), selectedVault = vault;
      const context=executionContext.getStore();if(context)assertAuthorization(context);
      const boundWriter=writer&&writerCurrent()?writer:undefined;
      const selectedWriter = context && writeAllowed ? boundWriter : undefined;
      return {binding, read: selectedVault, write: selectedWriter,
        // Existing accepted-result recovery remains readable; this port cannot grant a new apply.
        reconcileWrite: boundWriter ? (input, context) => boundWriter.reconcile(input, context) : undefined,
        finalizeWrite: boundWriter ? (accepted, context) => boundWriter.finalize(accepted, context) : undefined,
        signal: AbortSignal.any([signal, controller.signal]),
        assertCurrent() {checkBinding(expected);if(context)assertAuthorization(context); if (released || controller.signal.aborted) throw Error('知识源调用已撤销');},
        release() {released = true; inflight.delete(controller);}};
    },
    /** Host-only Wiki lease, using the exact same root/configuration as Knowledge tools. */
    acquireWiki(expected, context) {
      const lease = this.acquire({...expected}, context?.signal);
      try {
        const wiki = createWikiPort({reader: lease.read, vaultId: lease.binding.sourceId,
          sourceId: lease.binding.sourceId, namespace: lease.binding.namespace,
          configRevision: lease.binding.configRevision, dataLevel: lease.binding.dataLevel,
          validUntil: context.deadline,
          isCurrent: () => {lease.assertCurrent(); return !lease.signal.aborted;}});
        return {...lease, wiki};
      } catch (error) {lease.release(); throw error;}
    },
    async readSelectedNote(input) {
      if (!input || Object.keys(input).some(key => !['sourceId', 'configRevision', 'path'].includes(key))) throw Error('无效的笔记请求');
      checkBinding(input);
      if (!saved.allowedNotePaths.includes(input.path)) throw Error('请先通过本机选择器选定笔记');
      const lease = this.acquire(input, new AbortController().signal);
      try {
        const result = await lease.read.readNote({path: input.path, signal: lease.signal,
          deadline: new Date(Date.now() + 30000).toISOString()});
        lease.assertCurrent();
        return {sourceId: input.sourceId, configRevision: input.configRevision,
          path: input.path, revision: result.revision, content: result.content};
      } finally {lease.release();}
    },
    close() {closed = true; invalidate();}
  };
}

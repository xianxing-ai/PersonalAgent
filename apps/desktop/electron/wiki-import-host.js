import {createHash, randomUUID} from 'node:crypto';
import {closeSync, existsSync, fstatSync, lstatSync, mkdirSync, openSync, readFileSync, readSync, realpathSync, renameSync, statSync, writeFileSync} from 'node:fs';
import {open, readdir} from 'node:fs/promises';
import path from 'node:path';

export const WIKI_IMPORT_LIMITS = Object.freeze({files:512, fileBytes:64 * 1024 * 1024, totalBytes:128 * 1024 * 1024});
const formats = new Set(['md','markdown','txt','html','htm','pdf','docx','pptx','xlsx','csv','png','jpg','jpeg']);
const activeStates = new Set(['created','pending','planning','running','verifying','waiting_approval','cancelling']);
const digest = value => createHash('sha256').update(value).digest('hex');
const identity = value => ({dev:String(value.dev),ino:String(value.ino),birthtimeNs:String(value.birthtimeNs)});
const version = value => ({...identity(value),size:String(value.size),mtimeNs:String(value.mtimeNs)});
const equal = (left, right) => left && right && Object.keys(left).every(key => left[key] === right[key]);
const within = (root, target) => {const relative = path.relative(root, target); return relative === '' || !relative.startsWith('..' + path.sep) && relative !== '..' && !path.isAbsolute(relative);};

function canonical(value, kind) {
  if (typeof value !== 'string' || !path.isAbsolute(value) || value.startsWith('\\\\')) throw Error('请选择本机普通文件或目录');
  const full = path.resolve(value), volume = path.parse(full).root;
  if (full === volume || full.includes('\0')) throw Error('不能选择整个磁盘');
  let cursor = volume;
  for (const part of path.relative(volume, full).split(path.sep)) {
    if (!part || part === '..' || part.includes(':')) throw Error('文件路径无效');
    cursor = path.join(cursor, part);
    if (lstatSync(cursor).isSymbolicLink()) throw Error('Wiki 资料和保存目录不能包含链接');
  }
  const target = realpathSync.native(full), stat = statSync(target, {bigint:true});
  if (kind === 'directory' ? !stat.isDirectory() : !stat.isFile() || stat.nlink !== 1n) throw Error('请选择普通文件或目录');
  return {path:target,stat};
}
function checkObject(value, keys) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(key => !keys.includes(key))) throw Error('Wiki 请求参数无效');
}
function checkContext(context) {
  if (!context?.signal || context.signal.aborted) throw Error('Wiki 操作已取消');
  if (!Number.isFinite(Date.parse(context.deadline)) || Date.now() >= Date.parse(context.deadline)) throw Error('Wiki 操作已超时');
}
async function readBoundFile(file, context) {
  checkContext(context);
  const current = canonical(file.path, 'file');
  if (!equal(file.identity, version(current.stat))) throw Error('源文件已改变，请重新选择资料');
  const handle = await open(current.path, 'r');
  try {
    const before = await handle.stat({bigint:true});
    if (!equal(file.identity, version(before)) || before.size > BigInt(WIKI_IMPORT_LIMITS.fileBytes)) throw Error('源文件身份或大小已改变');
    // Bound allocation even if a selected file grows while it is being read.
    const buffer = Buffer.alloc(file.size + 1); let offset = 0;
    while (offset < buffer.length) {
      checkContext(context);
      const {bytesRead} = await handle.read(buffer, offset, buffer.length - offset, offset);
      if (!bytesRead) break;
      offset += bytesRead;
    }
    const bytes = buffer.subarray(0, offset);
    const after = await handle.stat({bigint:true});
    checkContext(context);
    if (bytes.length !== file.size || !equal(version(before), version(after)) || !equal(file.identity, version(canonical(file.path, 'file').stat))) throw Error('读取期间源文件已改变');
    return bytes;
  } finally {await handle.close();}
}
function assertFileCurrent(file) {
  const current = canonical(file.path, 'file');
  if (!equal(file.identity, version(current.stat)) || file.size > WIKI_IMPORT_LIMITS.fileBytes) throw Error('源文件已改变，当前批次停止');
  const fd = openSync(current.path, 'r');
  try {
    if (!equal(file.identity, version(fstatSync(fd, {bigint:true})))) throw Error('源文件身份已改变');
    const bytes = Buffer.alloc(file.size + 1); let offset = 0;
    while (offset < bytes.length) {
      const count = readSync(fd, bytes, offset, bytes.length - offset, offset);
      if (!count) break;
      offset += count;
    }
    if (offset !== file.size || digest(bytes.subarray(0,offset)) !== file.sha256
      || !equal(file.identity, version(fstatSync(fd, {bigint:true})))) throw Error('源文件已改变，当前批次停止');
  } finally {closeSync(fd);}
}

/** Native picker paths stay in this trusted host. Renderer receives opaque IDs and metadata only. */
export async function createWikiImportHost({userData, safeStorage, namespace, hostIdentity,
  selectFiles, selectFolder, selectLibrary, changed = () => {}}) {
  if (typeof namespace !== 'string' || !namespace || typeof hostIdentity !== 'string' || !hostIdentity) throw Error('缺少 Wiki 宿主身份');
  const configPath = path.join(userData, 'wiki-import-config.json');
  let library, selection, runtime, task, questionTask, removalTask, progress, published, busy = false, closed = false, reason = '', maintenanceEnabled = false;
  let registries = {};
  const leases = new Set();
  const save = () => {
    if (!safeStorage?.isEncryptionAvailable()) throw Error('安全存储不可用，未保存 Wiki 配置');
    const value = {version:1,namespace,hostIdentity,library,selection,registries,taskId:task?.taskId};
    mkdirSync(userData, {recursive:true});
    writeFileSync(configPath + '.tmp', JSON.stringify({version:1,encrypted:safeStorage.encryptString(JSON.stringify(value)).toString('base64')}), {mode:0o600});
    renameSync(configPath + '.tmp', configPath);
  };
  const libraryCurrent = candidate => {
    try {const current = canonical(candidate.path, 'directory'); return !closed && equal(candidate.identity, identity(current.stat));}
    catch {return false;}
  };
  try {
    if (existsSync(configPath)) {
      if (statSync(configPath).size > 2 * 1024 * 1024 || !safeStorage?.isEncryptionAvailable()) throw Error();
      const outer = JSON.parse(readFileSync(configPath, 'utf8'));
      if (outer.version !== 1 || typeof outer.encrypted !== 'string') throw Error();
      const saved = JSON.parse(safeStorage.decryptString(Buffer.from(outer.encrypted, 'base64')));
      if (saved.version !== 1 || saved.namespace !== namespace || saved.hostIdentity !== hostIdentity) throw Error();
      if (saved.library && !libraryCurrent(saved.library)) throw Error();
      if (saved.selection && (!Array.isArray(saved.selection.files) || saved.selection.files.length > WIKI_IMPORT_LIMITS.files
        || typeof saved.selection.selectionId !== 'string' || !Number.isSafeInteger(saved.selection.revision))) throw Error();
      if (saved.registries && (typeof saved.registries !== 'object' || Array.isArray(saved.registries)
        || Object.entries(saved.registries).some(([key,files])=>!/^[a-f0-9]{64}$/.test(key)
          || !Array.isArray(files) || files.length > WIKI_IMPORT_LIMITS.files))) throw Error();
      registries = saved.registries ?? {};
      library = saved.library; selection = saved.selection;
      if (typeof saved.taskId === 'string') task = {taskId:saved.taskId,state:'interrupted',canResume:true};
      reason = task ? '上次批次需核实；继续生成前重新确认授权' : '';
    }
  } catch {library = undefined; selection = undefined; task = undefined; registries = {}; reason = '已保存的 Wiki 目录不可用，请重新选择';}
  const selectedSources = () => {
    const files = new Map((registries[library?.libraryId] ?? []).map(file=>[file.sourceId,file]));
    for (const file of selection?.files ?? []) files.set(file.sourceId,file);
    return [...files.values()].sort((a,b)=>a.sourceId.localeCompare(b.sourceId));
  };
  const notify = () => {if (!closed) changed();};
  function snapshot() {
    const capability = runtime?.capabilities?.();
    return {available:Boolean(capability?.available && library && libraryCurrent(library)),selectionAvailable:true,
      reason:reason || capability?.reason || (!runtime ? '生成服务尚未连接' : !library ? '请选择 Wiki 保存目录' : 'Wiki 生成已配置，实际结果以任务读回为准'),
      ...(capability?.modelLabel ? {modelLabel:capability.modelLabel} : {}),
      automaticUpdate:capability?.automaticUpdate===true,
      ...(library ? {library:{libraryId:library.libraryId,displayName:path.basename(library.path)}} : {}),
      ...(library ? {librarySources:(registries[library.libraryId]??[]).map(({sourceId,name,sha256})=>({sourceId,name,revision:sha256}))} : {}),
      ...(selection ? {selection:{selectionId:selection.selectionId,revision:selection.revision,totalBytes:selection.totalBytes,
        batchSourceCount:selectedSources().length,existingSourceCount:selectedSources().filter(file=>!selection.files.some(item=>item.sourceId===file.sourceId)).length,
        files:selection.files.map(({sourceId,name,size,format,reason:issue}) => ({sourceId,name,size,format,...(issue ? {reason:issue} : {})}))}} : {}),
      ...(task ? {batch:{...task,...progress}} : {}), ...(questionTask ? {question:structuredClone(questionTask)} : {}),
      ...(removalTask ? {removal:structuredClone(removalTask)} : {}),
      ...(published ? {published:structuredClone(published)} : {})};
  }
  function acceptReadback(readback) {
    const current = readback?.task ?? readback;
    if (!current || typeof current.taskId !== 'string' || typeof current.state !== 'string') throw Error('Wiki 任务读回无效');
    if (task && task.taskId !== current.taskId) return;
    task = {taskId:current.taskId,state:current.state,revision:current.revision,autoUpdate:maintenanceEnabled && activeStates.has(current.state),
      canResume:current.state === 'waiting_reconciliation' || current.state === 'failed' || current.state === 'cancelled',
      ...(readback.usage ? {usage:readback.usage} : {}),
      ...(current.error ? {issues:[{message:current.error.message ?? current.error.code}]} : {})};
    const result = readback.confirmed?.result ?? readback.result;
    if (current.state === 'succeeded' && result) {
      if (result.generationId && Array.isArray(result.pages)) published = {generationId:result.generationId,pages:result.pages.map(page => ({pageId:page.pageId,title:page.title,path:page.path}))};
      if (Array.isArray(result.issues)) task.issues = result.issues;
      if (result.usage) task.usage = result.usage;
      if (result.complete === false) task.completion = 'partial';
    }
  }
  async function refresh() {
    if (runtime && task) acceptReadback(await runtime.read(task.taskId));
    if (runtime?.readAnswer && questionTask) {
      try {acceptQuestion(await runtime.readAnswer(questionTask.taskId));}
      catch {questionTask={taskId:questionTask.taskId,state:'failed',error:'来源或 Wiki 版本已变化，请重新提问'};}
    }
    if(runtime?.readRemoval && removalTask)acceptRemoval(await runtime.readRemoval(removalTask.taskId));
    if (runtime?.libraryStatus && library && libraryCurrent(library)) {
      try {
        const current = await runtime.libraryStatus({libraryId:library.libraryId});
        if (current?.generationId && Array.isArray(current.pages)) published = current;
        else published = undefined;
        if(reason==='来源已变化或不可访问，请重新导入或移除失效来源')reason='';
      } catch {published=undefined;reason='来源已变化或不可访问，请重新导入或移除失效来源';}
    }
    notify(); return snapshot();
  }
  function acceptQuestion(readback) {
    const current=readback?.task;
    if (!current || typeof current.taskId!=='string') throw Error('Wiki 问答任务读回无效');
    if (questionTask && questionTask.taskId!==current.taskId) return;
    questionTask={taskId:current.taskId,state:current.state,revision:current.revision,
      ...(current.error?{error:current.error.message??current.error.code}:{}),
      ...(readback.answer?{answer:readback.answer}:{})};
  }
  function acceptRemoval(readback){
    const current=readback?.task;if(!current||typeof current.taskId!=='string')throw Error('Wiki 来源移除任务读回无效');
    if(removalTask&&removalTask.taskId!==current.taskId)return;
    removalTask={taskId:current.taskId,state:current.state,revision:current.revision,
      ...(current.error?{error:current.error.message??current.error.code}:{})};
  }
  async function mutate(work) {
    if (closed || busy) throw Error('Wiki 正在处理请求，请稍后重试');
    busy = true;
    try {return await work();} finally {busy = false; notify();}
  }
  async function ensureIdle() {
    if (task && runtime) acceptReadback(await runtime.read(task.taskId));
    if (task?.state === 'waiting_reconciliation' || task?.state === 'interrupted') throw Error('请先核实原 Wiki 批次的执行结果');
    if (task && activeStates.has(task.state)) throw Error('请先停止或等待当前 Wiki 批次');
    if (questionTask && activeStates.has(questionTask.state)) throw Error('请先等待当前 Wiki 问答');
    if (removalTask && activeStates.has(removalTask.state)) throw Error('请先等待当前来源移除');
    if (leases.size) throw Error('当前 Wiki 批次仍在释放资源，请稍后重试');
  }
  async function selectInput(folder) {
    await ensureIdle();
    const picked = folder ? await selectFolder() : await selectFiles();
    if (!picked || Array.isArray(picked) && !picked.length) return snapshot();
    const items = []; let folderRoot;
    if (folder) {
      const root = canonical(picked, 'directory').path;
      folderRoot = root;
      const walk = async current => {
        for (const entry of await readdir(current, {withFileTypes:true})) {
          const full = path.join(current, entry.name);
          if (entry.isSymbolicLink()) throw Error('所选文件夹包含链接，请移出链接后重试');
          if (entry.isDirectory()) {
            if (library && canonical(full, 'directory').path === library.path) throw Error('资料目录包含 Wiki 保存目录，请选择其他位置');
            await walk(full);
          } else if (entry.isFile()) items.push({path:full,name:path.relative(root, full).split(path.sep).join('/')});
          else throw Error('资料目录包含不支持的文件类型');
          if (items.length > WIKI_IMPORT_LIMITS.files) throw Error(`单批最多 ${WIKI_IMPORT_LIMITS.files} 个文件，请拆分导入`);
        }
      };
      if (library && root === library.path) throw Error('资料目录与 Wiki 保存目录不能相同');
      await walk(root);
    } else {
      if (!Array.isArray(picked) || picked.length > WIKI_IMPORT_LIMITS.files) throw Error('选中文件数量超过本批上限');
      for (const file of picked) items.push({path:file,name:path.basename(file)});
    }
    if (!items.length) throw Error('所选目录中没有文件');
    const controller = new AbortController(), context = {signal:controller.signal,deadline:new Date(Date.now() + 120000).toISOString()};
    const files = [], seen = new Set(); let totalBytes = 0;
    for (const item of items.sort((a,b) => a.name.localeCompare(b.name))) {
      const current = canonical(item.path, 'file');
      if (seen.has(current.path)) continue;
      seen.add(current.path);
      const size = Number(current.stat.size), format = path.extname(item.name).slice(1).toLowerCase();
      totalBytes += size;
      if (size > WIKI_IMPORT_LIMITS.fileBytes || totalBytes > WIKI_IMPORT_LIMITS.totalBytes) throw Error('资料超过单文件 64 MB 或单批 128 MB 上限，请拆分导入');
      const file = {path:current.path,name:item.name,size,format,identity:version(current.stat)};
      const bytes = await readBoundFile(file, context), sha256 = digest(bytes);
      const registered = (registries[library?.libraryId] ?? []).find(item=>item.path === current.path);
      files.push({...file,sourceId:registered?.sourceId ?? digest(JSON.stringify([namespace,current.path,identity(current.stat)])),sha256,
        ...(!formats.has(format) ? {reason:'此格式暂不支持；会在覆盖报告中列出'} : {})});
    }
    const previous = selection, previousTask = task;
    selection = {selectionId:randomUUID(),revision:(previous?.revision ?? 0) + 1,totalBytes,files,...(folderRoot ? {folderRoot} : {})};
    task = undefined;
    try {save();} catch (error) {selection = previous; task = previousTask; throw error;}
    progress = undefined; reason = ''; return snapshot();
  }
  function openLibrary(libraryId) {
    if (!library || libraryId !== library.libraryId || !libraryCurrent(library)) throw Error('Wiki 保存目录已失效，请重新选择');
    const bound = library, binding = digest(JSON.stringify([namespace,hostIdentity,bound.libraryId,bound.path,bound.identity]));
    return {rootPath:bound.path,binding,isCurrent:() => library === bound && libraryCurrent(bound)};
  }
  const source = {
    openLibrary,
    assertSourcesCurrent(libraryId, expected) {
      openLibrary(libraryId);
      if (!Array.isArray(expected) || expected.length > WIKI_IMPORT_LIMITS.files) throw Error('Wiki 来源清单无效');
      const registry = registries[libraryId] ?? [];
      for (const item of expected) {
        const file = registry.find(file=>file.sourceId === item.sourceId);
        if (!file || file.sha256 !== item.revision) throw Error('Wiki 来源未登记或版本已改变，请重新导入');
        assertFileCurrent(file);
      }
    },
    forgetSource(input, context) {
      checkObject(input,['libraryId','sourceId','revision']);checkContext(context);openLibrary(input.libraryId);
      if(typeof context.taskId!=='string'||context.runId!==`host-tool-${context.taskId}`||!context.argumentsDigest)
        throw Error('来源移除仅允许原授权任务执行');
      const before=registries[input.libraryId]??[],file=before.find(item=>item.sourceId===input.sourceId);
      if(!file||file.sha256!==input.revision)throw Error('待移除的 Wiki 来源版本已变化');
      const oldSelection=selection;
      registries={...registries,[input.libraryId]:before.filter(item=>item.sourceId!==input.sourceId)};
      if(selection?.files.some(item=>item.sourceId===input.sourceId)){
        const files=selection.files.filter(item=>item.sourceId!==input.sourceId);
        selection={...selection,revision:selection.revision+1,files,totalBytes:files.reduce((sum,item)=>sum+item.size,0)};
      }
      try{save();reason='';published=undefined;questionTask=undefined;}
      catch(error){registries={...registries,[input.libraryId]:before};selection=oldSelection;throw error;}
      notify();
    },
    async refreshMaintenance(input, context) {
      checkObject(input,['selectionId','revision','libraryId']);checkContext(context);
      if (typeof context.taskId!=='string'||context.runId!==`host-tool-${context.taskId}`||!context.argumentsDigest)
        throw Error('自动维护仅允许原授权任务执行');
      const selected=selection,target=openLibrary(input.libraryId);
      if(!selected||selected.selectionId!==input.selectionId||selected.revision!==input.revision||!target.isCurrent()) throw Error('Wiki 维护范围已变化');
      const previous=registries[input.libraryId],files=selectedSources();
      if(digest(JSON.stringify(files.map(file=>file.sourceId).sort()))!==context.sourceIdsDigest) throw Error('Wiki 来源范围已变化');
      const next=[];let changed=false,metadataChanged=false,totalBytes=0;
      for(const file of files){
        checkContext(context);const actual=canonical(file.path,'file');
        if(!equal(identity(file.identity),identity(actual.stat))) throw Error('源文件已被替换或删除，请重新选择');
        const freshIdentity=version(actual.stat),size=Number(actual.stat.size);totalBytes+=size;
        if(size>WIKI_IMPORT_LIMITS.fileBytes||totalBytes>WIKI_IMPORT_LIMITS.totalBytes) throw Error('自动更新后的资料超过大小上限');
        if(equal(file.identity,freshIdentity)){next.push(file);continue;}
        const candidate={...file,size,identity:freshIdentity};
        const bytes=await readBoundFile(candidate,context),sha256=digest(bytes);
        next.push({...candidate,sha256});metadataChanged=true;changed ||= sha256!==file.sha256;
      }
      if(metadataChanged){
        const byId=new Map(next.map(file=>[file.sourceId,file]));
        const nextSelection={...selected,files:selected.files.map(file=>byId.get(file.sourceId)??file),
          totalBytes:selected.files.reduce((sum,file)=>sum+(byId.get(file.sourceId)?.size??file.size),0)};
        registries={...registries,[input.libraryId]:next};selection=nextSelection;
        try{save();}catch(error){registries={...registries,[input.libraryId]:previous};selection=selected;throw error;}
      }
      return changed;
    },
    async acquire(input, context) {
      checkObject(input, ['selectionId','revision','libraryId']); checkContext(context);
      const selected = selection, target = openLibrary(input.libraryId);
      if (!selected || input.selectionId !== selected.selectionId || input.revision !== selected.revision) throw Error('资料选择已改变，请重新检查');
      const files = selectedSources();
      if (files.length > WIKI_IMPORT_LIMITS.files || files.reduce((total,file)=>total + file.size,0) > WIKI_IMPORT_LIMITS.totalBytes) throw Error('本库和本批资料合计超过 512 个文件或 128 MB，请使用另一个 Wiki 库');
      const registry = registries[input.libraryId], sources = [];
      for (const file of files) {
        const bytes = await readBoundFile(file, context);
        if (digest(bytes) !== file.sha256) throw Error('源文件内容已改变，请重新选择资料');
        sources.push({sourceId:file.sourceId,name:file.name,bytes:new Uint8Array(bytes)});
      }
      let released = false, registered = false;
      const assertCurrent = () => {
        checkContext(context);
        if (closed || released || selection !== selected || !target.isCurrent()) throw Error('Wiki 批次范围已失效');
        if (!registered && registries[input.libraryId] !== registry) throw Error('Wiki 来源登记已改变，请重新授权');
        for (const file of files) assertFileCurrent(file);
      };
      const release = () => {released = true; leases.delete(release);};
      leases.add(release);
      try {assertCurrent();} catch (error) {release(); throw error;}
      return {libraryPath:target.rootPath,libraryBinding:target.binding,sources,
        manifestDigest:digest(JSON.stringify(files.map(file => ({sourceId:file.sourceId,name:file.name,size:file.size,revision:file.sha256})))),
        registerSources() {
          assertCurrent();
          if (typeof context.taskId !== 'string' || context.runId !== `host-tool-${context.taskId}` || !context.argumentsDigest) throw Error('来源登记仅允许原 Wiki 授权任务执行');
          if (registered) return;
          registries = {...registries,[input.libraryId]:files};
          try {save(); registered = true;} catch (error) {registries = {...registries,[input.libraryId]:registry};throw error;}
        },assertCurrent,release};
    }
  };
  return {
    runtimeOptions:{source,onProgress(event) {
      if (!event || closed || typeof event.taskId !== 'string' || task && task.taskId !== event.taskId) return;
      progress = {stage:event.stage,completed:event.completed,total:event.total};
      notify();
      if (runtime && task) void refresh().catch(() => {});
    }},
    bind(value) {runtime = value; notify();}, snapshot,
    async action(name, payload) {
      if (closed) throw Error('Wiki 宿主已关闭');
      if (name === 'status') {if (payload !== undefined) throw Error('状态请求无需参数'); return refresh();}
      if (name === 'selectFiles' || name === 'selectFolder') {
        if (payload !== undefined) throw Error('文件只能从本机选择器选择');
        return mutate(() => selectInput(name === 'selectFolder'));
      }
      if (name === 'selectLibrary') {
        if (payload !== undefined) throw Error('保存目录只能从本机选择器选择');
        return mutate(async () => {
          await ensureIdle(); const picked = await selectLibrary(); if (!picked) return snapshot();
          const current = canonical(picked, 'directory'), previous = library, previousTask = task;
          if (selection?.folderRoot && within(selection.folderRoot, current.path)) throw Error('Wiki 保存目录不能位于所选资料目录内');
          library = {libraryId:digest(JSON.stringify([namespace,current.path,identity(current.stat)])),path:current.path,identity:identity(current.stat)};
          task = undefined; questionTask = undefined;
          try {save();} catch (error) {library = previous; task = previousTask; throw error;}
          progress = undefined; published = undefined; reason = ''; return snapshot();
        });
      }
      if (!runtime) throw Error('Wiki 运行时尚未连接');
      if(name==='removeSource')return mutate(async()=>{
        checkObject(payload,['sourceId','revision']);await ensureIdle();
        const file=(registries[library?.libraryId]??[]).find(item=>item.sourceId===payload.sourceId);
        if(!file||file.sha256!==payload.revision||typeof runtime.removeSource!=='function')throw Error('待移除来源不存在或已变化');
        const result=await runtime.removeSource({libraryId:library.libraryId,sourceId:file.sourceId,revision:file.sha256,
          deadline:new Date(Date.now()+180000).toISOString()});
        removalTask=undefined;acceptRemoval(result);return snapshot();
      });
      if (name === 'ask') return mutate(async () => {
        checkObject(payload,['question','generationId']);
        if (typeof payload.question!=='string'||!payload.question.trim()||payload.question.length>1000
          ||payload.generationId!==published?.generationId) throw Error('请填写问题并确认当前 Wiki 版本');
        if (questionTask && activeStates.has(questionTask.state)) throw Error('请等待上一条 Wiki 问答');
        if (typeof runtime.ask!=='function') throw Error('Wiki 问答尚未接通');
        const result=await runtime.ask({libraryId:library.libraryId,generationId:payload.generationId,
          question:payload.question.trim(),maxTokens:64000,deadline:new Date(Date.now()+180000).toISOString()});
        questionTask=undefined;acceptQuestion(result);return snapshot();
      });
      if (name === 'cancelAnswer') return mutate(async () => {
        checkObject(payload,['taskId']);
        if (!questionTask || payload.taskId!==questionTask.taskId || typeof runtime.cancelAnswer!=='function') throw Error('Wiki 问答任务无效');
        acceptQuestion(await runtime.cancelAnswer(questionTask.taskId));return snapshot();
      });
      if (name === 'start') return mutate(async () => {
        checkObject(payload, ['selectionId','revision','maxCalls','maxTokens','maxInputCharacters','timeoutMinutes','autoUpdate']);
        await ensureIdle();
        if (!selection || payload.selectionId !== selection.selectionId || payload.revision !== selection.revision) throw Error('资料选择已改变，请刷新后重试');
        for (const [key,min,max] of [['maxCalls',1,256],['maxTokens',1000,2000000],['timeoutMinutes',1,120]]) {
          if (!Number.isSafeInteger(payload[key]) || payload[key] < min || payload[key] > max) throw Error('Wiki 预算或期限无效');
        }
        if(payload.maxInputCharacters!==undefined&&(!Number.isSafeInteger(payload.maxInputCharacters)
          ||payload.maxInputCharacters<1000||payload.maxInputCharacters>64000000))throw Error('输入字符预算无效');
        if(payload.autoUpdate!==undefined&&typeof payload.autoUpdate!=='boolean')throw Error('自动更新设置无效');
        if(payload.autoUpdate&&runtime.capabilities?.().automaticUpdate!==true)throw Error('当前运行时未接通自动更新');
        const target = openLibrary(library?.libraryId); if (!target.isCurrent()) throw Error('保存目录已改变');
        if (!runtime.capabilities?.().available) throw Error(runtime.capabilities?.().reason ?? 'Wiki 模型工作流未连接');
        const previousTask = task; task = undefined; progress = undefined;
        try {
          const readback = await runtime.start({selectionId:selection.selectionId,revision:selection.revision,libraryId:library.libraryId,
            budget:{maxCalls:payload.maxCalls,maxTokens:payload.maxTokens,maxInputCharacters:payload.maxInputCharacters??2000000,
              maxOutputCharacters:Math.min(16000000,payload.maxCalls*48000)},
            autoUpdate:payload.autoUpdate===true,deadline:new Date(Date.now() + payload.timeoutMinutes * 60000).toISOString()});
          maintenanceEnabled=payload.autoUpdate===true;acceptReadback(readback); save(); return snapshot();
        } catch (error) {if (!task) task = previousTask; throw error;}
      });
      if (name === 'cancel' || name === 'recover') return mutate(async () => {
        checkObject(payload, ['taskId']);
        if (!task || payload.taskId !== task.taskId) throw Error('只能操作当前已绑定的 Wiki 任务');
        const readback = await runtime[name](task.taskId);
        if (readback) acceptReadback(readback);
        return refresh();
      });
      if(name==='stopMaintenance')return mutate(async()=>{
        checkObject(payload,['taskId']);
        if(!task||payload.taskId!==task.taskId||typeof runtime.stopMaintenance!=='function')throw Error('Wiki 自动维护任务无效');
        acceptReadback(await runtime.stopMaintenance(task.taskId));maintenanceEnabled=false;return refresh();
      });
      if (name === 'search' || name === 'readPage' || name === 'openSource') {
        checkObject(payload, name === 'search' ? ['query','generationId'] : name === 'readPage' ? ['pageId','generationId'] : ['sourceId','revision','unitId','generationId']);
        openLibrary(library?.libraryId);
        if (name === 'search' && (typeof payload.query !== 'string' || !payload.query.trim() || payload.query.length > 500)) throw Error('请输入 1–500 字的查询');
        const method = name === 'openSource' ? 'readSource' : name;
        if (typeof runtime[method] !== 'function') throw Error('此 Wiki 阅读能力尚未接通');
        return runtime[method]({...payload,libraryId:library.libraryId});
      }
      throw Error('不支持的 Wiki 操作');
    },
    close() {closed = true; questionTask = undefined; removalTask = undefined; for (const release of [...leases]) release(); runtime = undefined;}
  };
}

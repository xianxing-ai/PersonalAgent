const labels = {created:'已创建', pending:'排队中', planning:'准备生成', running:'正在生成', verifying:'核实结果', waiting_approval:'等待本批授权',
  waiting_reconciliation:'等待结果核实', succeeded:'任务已完成', failed:'处理失败', cancelled:'已取消',
  partial:'部分完成', needs_attention:'有项目需要处理', ready:'预检完成'};
const stages = {preflight:'检查文件', parsing:'解析文件', extracting:'提取知识', synthesizing:'整理关联',
  validating:'检查引用与覆盖', publishing:'发布 Wiki', complete:'发布完成',watching:'自动维护中'};
const activeStates = new Set(['created','pending','planning','running','verifying','waiting_approval','cancelling']);
const bytes = value => Number.isFinite(value) ? value < 1024 * 1024
  ? `${Math.ceil(value / 1024)} KB` : `${(value / 1024 / 1024).toFixed(1)} MB` : '大小待检查';

/** Render only text and links to known pages. Document/model HTML is never interpreted. */
export function renderWikiDocument(root, page, pages, openPage) {
  root.replaceChildren();
  const doc = root.ownerDocument;
  const known = new Map(pages.flatMap(item => [[item.path ?? item.pageId, item.pageId], [item.pageId, item.pageId]]));
  const resolve = value => {
    if (/^[a-z][a-z0-9+.-]*:|^[\\/]|[\u0000-\u001f]/i.test(value)) return undefined;
    if (known.has(value)) return known.get(value);
    const parts = String(page?.path ?? '').split('/').slice(0, -1);
    for (const part of value.split('/')) {
      if (part === '..') {if (!parts.length) return undefined; parts.pop();}
      else if (part && part !== '.') parts.push(part);
    }
    return known.get(parts.join('/'));
  };
  const inline = (element, value) => {
    let offset = 0;
    for (const match of value.matchAll(/\[([^\]\n]{1,200})\]\(([^)\s]{1,512})\)/g)) {
      element.append(doc.createTextNode(value.slice(offset, match.index)));
      const id = resolve(match[2]);
      if (id) {
        const button = doc.createElement('button'); button.type = 'button'; button.className = 'btn btn-sm';
        button.textContent = match[1]; button.addEventListener('click', () => openPage(id)); element.append(button);
      } else element.append(doc.createTextNode(match[0]));
      offset = match.index + match[0].length;
    }
    element.append(doc.createTextNode(value.slice(offset)));
  };
  let code, list, fenceLength = 0;
  for (const line of String(page?.content ?? page?.markdown ?? '').split(/\r?\n/)) {
    const fence = /^(`{3,})/.exec(line);
    if (code) {
      if (fence && fence[1].length >= fenceLength && /^`+\s*$/.test(line)) {code = undefined; fenceLength = 0; continue;}
      code.append(doc.createTextNode(line + '\n')); continue;
    }
    if (fence) {
      list = undefined; fenceLength = fence[1].length;
      code = doc.createElement('pre'); root.append(code); continue;
    }
    if (!line.trim()) {list = undefined; continue;}
    const heading = /^(#{1,4})\s+(.+)$/.exec(line);
    if (heading) {
      list = undefined; const element = doc.createElement(`h${Math.min(heading[1].length + 1, 6)}`);
      inline(element, heading[2]); root.append(element); continue;
    }
    const bullet = /^\s*[-*]\s+(.+)$/.exec(line);
    if (bullet) {
      if (!list) {list = doc.createElement('ul'); root.append(list);}
      const item = doc.createElement('li'); inline(item, bullet[1]); list.append(item); continue;
    }
    list = undefined; const element = doc.createElement('p'); inline(element, line); root.append(element);
  }
}

/** Renderer facade. Native selection, authorization and execution remain in trusted hosts. */
export function mountWikiImportControls(root, invoke) {
  const doc = root.ownerDocument;
  const section = doc.createElement('section');
  section.className = 'sheet wiki-import-settings'; section.setAttribute('aria-label', 'LLM Wiki');
  section.innerHTML = `
    <h2>LLM Wiki</h2>
    <p>导入资料，自动整理主题、关联页面和原文引用。原文件保留。</p>
    <p class="notice" data-wiki="availability" role="status"></p>
    <div class="form-actions">
      <button class="btn" type="button" data-wiki="files">选择文件</button>
      <button class="btn" type="button" data-wiki="folder">选择文件夹</button>
      <button class="btn" type="button" data-wiki="library">选择 Wiki 保存目录</button>
    </div>
    <p class="notice" data-wiki="library-name"></p>
    <p>已导入的来源（撤销后停止使用，历史快照仍保留）</p><ul data-wiki="library-sources"></ul><p data-wiki="removal-status" role="status"></p>
    <p data-wiki="selection"></p>
    <ul data-wiki="files-list"></ul>
    <details><summary>本批处理预算</summary>
      <label class="setting-row">最多模型调用<input data-wiki="max-calls" type="number" min="1" max="256" value="32"></label>
      <label class="setting-row">最多 Token<input data-wiki="max-tokens" type="number" min="1000" max="2000000" value="128000" step="1000"></label>
      <label class="setting-row">最多输入字符<input data-wiki="max-input" type="number" min="1000" max="64000000" value="2000000" step="1000"></label>
      <label class="setting-row">任务期限（分钟）<input data-wiki="timeout" type="number" min="1" max="120" value="60"></label>
    </details>
    <p class="notice">生成前将确认：本批资料及本库已导入资料会发送到已选 AgentArts，以整理跨文件关联。同一批次的分块共用这次授权。</p>
    <label class="setting-row"><input data-wiki="auto-update" type="checkbox" checked> 在本次期限和预算内自动更新已选来源</label>
    <p class="notice">资料更改后会重新整理，并可能发送本批和本库资料；新增文件或文件被替换时需要重新选择。</p>
    <div class="form-actions">
      <button class="btn btn-primary" type="button" data-wiki="start">授权并生成 Wiki</button>
      <button class="btn" type="button" data-wiki="cancel">停止本批</button>
      <button class="btn" type="button" data-wiki="recover">核实并恢复</button>
      <button class="btn" type="button" data-wiki="stop-maintenance">结束自动维护</button>
      <button class="btn" type="button" data-wiki="refresh">刷新状态</button>
    </div>
    <p data-wiki="progress" role="status" aria-live="polite"></p>
    <progress data-wiki="meter" aria-label="Wiki 处理进度" hidden></progress>
    <p class="notice" data-wiki="usage"></p>
    <ul data-wiki="issues"></ul>
    <p class="error" data-wiki="error" role="alert"></p>
    <div data-wiki="browser" hidden>
      <h3>已发布 Wiki</h3>
      <p class="notice" data-wiki="generation"></p>
      <div class="setting-row"><label>页面 <select data-wiki="page"></select></label>
        <button class="btn" type="button" data-wiki="read">打开页面</button></div>
      <form data-wiki="search-form"><label>搜索 Wiki <input data-wiki="query" maxlength="500" type="search" placeholder="主题、术语或关键词"></label>
        <button class="btn" type="submit" data-wiki="search">搜索</button></form>
      <p data-wiki="search-status" role="status"></p>
      <ul data-wiki="results"></ul>
      <form data-wiki="ask-form"><label>基于 Wiki 提问 <input data-wiki="question-input" maxlength="1000" placeholder="输入有关资料的问题"></label>
        <button class="btn" type="submit" data-wiki="ask">授权并提问</button>
        <button class="btn" type="button" data-wiki="stop-answer">停止回答</button></form>
      <p class="notice">问答会将相关来源片段发送给已配置的 AgentArts 模型，需要确认本次问答。</p>
      <p data-wiki="answer-status" role="status" aria-live="polite"></p>
      <p data-wiki="answer"></p><div data-wiki="answer-citations"></div>
      <article data-wiki="content" aria-label="Wiki 页面"></article>
      <div data-wiki="citations"></div>
    </div>`;
  root.append(section);
  const field = name => section.querySelector(`[data-wiki="${name}"]`);
  let state = {}, busy = false, disposed = false, responseRevision = 0, viewedGeneration, poll;
  const pages = () => state.published?.pages ?? [];
  const batch = () => state.batch;
  const active = () => activeStates.has(batch()?.state);
  const unresolved = () => batch()?.state === 'waiting_reconciliation' || batch()?.state === 'interrupted';
  const answering = () => activeStates.has(state.question?.state);
  const removing = () => activeStates.has(state.removal?.state);
  const binding = () => ({selectionId: state.selection?.selectionId, revision: state.selection?.revision});
  function buttons() {
    for (const name of ['files','folder','library']) field(name).disabled = busy || active() || unresolved() || answering() || removing() || state.selectionAvailable===false;
    field('start').disabled = busy || active() || unresolved() || !state.available || !state.library || !state.selection?.files?.length;
    field('cancel').disabled = busy || !active() || !batch()?.taskId;
    field('recover').disabled = busy || !batch()?.taskId || !(batch().canResume || batch().state === 'waiting_reconciliation');
    field('auto-update').disabled = busy || active() || unresolved() || !state.automaticUpdate;
    field('stop-maintenance').disabled = busy || !batch()?.autoUpdate || batch()?.stage!=='watching' || !batch()?.taskId;
    field('refresh').disabled = busy;
    field('read').disabled = busy || !field('page').value;
    field('search').disabled = busy || !state.published?.generationId;
    field('ask').disabled = busy || answering() || !state.published?.generationId || !state.available;
    field('stop-answer').disabled = busy || !answering();
  }
  function list(target, entries, text) {
    target.replaceChildren(...entries.map(entry => {const item = doc.createElement('li'); item.textContent = text(entry); return item;}));
  }
  function update(next = {}) {
    if (disposed) return;
    state = next?.wikiImport ?? next;
    field('availability').textContent = (state.reason ?? (state.available ? '已连接生成服务' : '生成服务尚未连接'))
      + (state.modelLabel ? ` · 本批云端接收方：${state.modelLabel}` : '');
    field('library-name').textContent = state.library ? `保存位置：${state.library.displayName}` : '请选择 Wiki 保存目录';
    field('library-sources').replaceChildren(...(state.librarySources??[]).map(source=>{
      const item=doc.createElement('li'),button=doc.createElement('button');item.append(doc.createTextNode(source.name+' '));
      button.type='button';button.className='btn btn-sm';button.textContent='撤销来源';button.disabled=busy||active()||unresolved()||answering()||removing();
      button.addEventListener('click',()=>act('wiki.import.removeSource',{sourceId:source.sourceId,revision:source.revision}));
      item.append(button);return item;
    }));
    field('removal-status').textContent=state.removal ? `${labels[state.removal.state]??state.removal.state}${state.removal.error?'：'+state.removal.error:''}` : '';
    const selected = state.selection;
    field('selection').textContent = selected?.files?.length ? `已选择 ${selected.files.length} 个文件，共 ${bytes(selected.totalBytes)}` : '请选择需要整理的资料';
    if (selected?.existingSourceCount) field('selection').textContent += `；同时核对本库已有 ${selected.existingSourceCount} 个来源，共 ${selected.batchSourceCount} 个来源参与本批整理`;
    list(field('files-list'), selected?.files ?? [], item => `${item.name} · ${bytes(item.size)}${item.reason ? ' · ' + item.reason : ''}`);
    const task = batch();
    field('progress').textContent = task ? `${task.state === 'succeeded' && task.completion === 'partial' ? '部分完成' : labels[task.state] ?? task.state} · ${stages[task.stage] ?? task.stage ?? '等待处理'}${Number.isSafeInteger(task.completed) && Number.isSafeInteger(task.total) ? ` · ${task.completed}/${task.total}` : ''}` : '';
    field('meter').hidden = !active();
    if (Number.isFinite(task?.total) && task.total > 0 && Number.isFinite(task.completed)) {
      field('meter').max = task.total; field('meter').value = Math.min(task.total, Math.max(0, task.completed));
    } else field('meter').removeAttribute('value');
    const usage = task?.usage;
    field('usage').textContent = usage ? `模型调用 ${usage.calls ?? 0} 次 · 已确认 Token ${(usage.inputTokens ?? 0) + (usage.outputTokens ?? 0)}${usage.reservedTokens ? ` · 待核实预留 ${usage.reservedTokens}` : ''}${usage.unmeasuredTokens ? ` · 未提供用量的调用预留 ${usage.unmeasuredTokens}` : ''}` : '';
    list(field('issues'), task?.issues ?? [], item => typeof item === 'string' ? item : [item.name, item.message ?? item.reason ?? item.code].filter(Boolean).join('：'));
    const generation = state.published?.generationId;
    field('browser').hidden = !generation;
    field('generation').textContent = generation ? `当前发布版本：${generation} · ${pages().length} 页` : '';
    const question=state.question;
    field('answer-status').textContent = question ? labels[question.state] ?? question.state : '';
    if(question?.error) field('answer-status').textContent += `：${question.error}`;
    field('answer').textContent = question?.answer?.answer ?? '';
    field('answer-citations').replaceChildren(...(question?.answer?.citations ?? []).map((citation,index)=>{
      const button=doc.createElement('button');button.type='button';button.className='btn btn-sm';button.textContent=`来源 ${index+1}`;
      button.addEventListener('click',()=>act('wiki.import.openSource',{sourceId:citation.sourceId,revision:citation.revision,
        unitId:citation.unitId,generationId:generation},source=>{field('content').replaceChildren();const pre=doc.createElement('pre');
        pre.textContent=source.text;field('content').append(pre);}));return button;
    }));
    const previousPage = field('page').value;
    field('page').replaceChildren(...pages().map(item => {
      const option = doc.createElement('option'); option.value = item.pageId; option.textContent = item.title; return option;
    }));
    if (pages().some(item => item.pageId === previousPage)) field('page').value = previousPage;
    if (viewedGeneration && viewedGeneration !== generation) {
      responseRevision++; viewedGeneration = undefined;
      field('content').replaceChildren(); field('results').replaceChildren(); field('citations').replaceChildren();
      field('search-status').textContent = 'Wiki 版本已更新，请重新打开页面或搜索';
    }
    buttons(); schedulePoll();
  }
  function schedulePoll() {
    clearTimeout(poll);
    if (disposed || section.hidden || !active() && !answering() && !removing()) return;
    poll = setTimeout(async () => {
      if (busy || disposed || section.hidden) {schedulePoll(); return;}
      try {update(await invoke('wiki.import.status'));} catch {field('error').textContent = '状态刷新失败，可点击“刷新状态”重试'; schedulePoll();}
    }, 1500);
  }
  async function act(action, payload, receive = update) {
    if (busy || disposed) return;
    busy = true; field('error').textContent = ''; buttons();
    try {const result = await invoke(action, payload); if (!disposed) receive(result);}
    catch (error) {if (!disposed) field('error').textContent = error?.message ?? 'Wiki 操作未完成';}
    finally {busy = false; if (!disposed) {buttons(); schedulePoll();}}
  }
  const openPage = pageId => {
    const generationId = state.published?.generationId, revision = ++responseRevision;
    return act('wiki.import.readPage', {pageId, generationId}, page => {
      if (revision !== responseRevision || generationId !== state.published?.generationId) return;
      viewedGeneration = generationId;
      renderWikiDocument(field('content'), page, pages(), openPage);
      field('citations').replaceChildren(...(page.citations ?? []).map(citation => {
        const button = doc.createElement('button'); button.className = 'btn btn-sm'; button.type = 'button';
        button.textContent = citation.label ?? '查看原文';
        button.addEventListener('click', () => act('wiki.import.openSource', {
          sourceId: citation.sourceId, revision: citation.revision, unitId: citation.unitId, generationId
        }, source => {field('content').replaceChildren(); const pre = doc.createElement('pre'); pre.textContent = source.text; field('content').append(pre);}));
        return button;
      }));
    });
  };
  field('files').addEventListener('click', () => act('wiki.import.selectFiles'));
  field('folder').addEventListener('click', () => act('wiki.import.selectFolder'));
  field('library').addEventListener('click', () => act('wiki.import.selectLibrary'));
  field('refresh').addEventListener('click', () => act('wiki.import.status'));
  field('start').addEventListener('click', () => {
    const limits = {maxCalls:Number(field('max-calls').value), maxTokens:Number(field('max-tokens').value),
      maxInputCharacters:Number(field('max-input').value),timeoutMinutes:Number(field('timeout').value)};
    if (!Object.values(limits).every(Number.isSafeInteger) || limits.maxCalls < 1 || limits.maxCalls > 256 || limits.maxTokens < 1000 || limits.maxTokens > 2000000 || limits.maxInputCharacters<1000 || limits.maxInputCharacters>64000000 || limits.timeoutMinutes < 1 || limits.timeoutMinutes > 120) {
      field('error').textContent = '请填写有效的调用次数、Token 上限和任务期限'; return;
    }
    void act('wiki.import.start', {...binding(), ...limits,autoUpdate:Boolean(state.automaticUpdate && field('auto-update').checked)});
  });
  for (const name of ['cancel','recover']) field(name).addEventListener('click', () => {
    if (batch()?.taskId) void act(`wiki.import.${name}`, {taskId:batch().taskId});
  });
  field('stop-maintenance').addEventListener('click',()=>{
    if(batch()?.taskId)void act('wiki.import.stopMaintenance',{taskId:batch().taskId});
  });
  field('read').addEventListener('click', () => openPage(field('page').value));
  field('ask-form').addEventListener('submit',event=>{
    event.preventDefault();const question=field('question-input').value.trim();if(!question)return;
    void act('wiki.import.ask',{question,generationId:state.published?.generationId});
  });
  field('stop-answer').addEventListener('click',()=>{
    if(state.question?.taskId)void act('wiki.import.cancelAnswer',{taskId:state.question.taskId});
  });
  field('search-form').addEventListener('submit', event => {
    event.preventDefault(); const query = field('query').value.trim(); if (!query) return;
    const generationId = state.published?.generationId, revision = ++responseRevision;
    void act('wiki.import.search', {query, generationId}, result => {
      if (revision !== responseRevision || generationId !== state.published?.generationId) return;
      viewedGeneration = generationId;
      field('search-status').textContent = result.hits?.length ? `找到 ${result.hits.length} 条${result.truncated ? '，可缩小查询范围' : ''}` : '当前 Wiki 中没有匹配内容';
      field('results').replaceChildren(...(result.hits ?? []).map(hit => {
        const item = doc.createElement('li'), button = doc.createElement('button');
        button.type = 'button'; button.className = 'btn btn-sm'; button.textContent = hit.title ?? hit.pageId;
        button.addEventListener('click', () => openPage(hit.pageId)); item.append(button, doc.createTextNode(' ' + (hit.excerpt ?? ''))); return item;
      }));
    });
  });
  update();
  return {element:section, update, show(value) {section.hidden = !value; schedulePoll();},
    dispose() {disposed = true; clearTimeout(poll); responseRevision++; section.remove();}};
}

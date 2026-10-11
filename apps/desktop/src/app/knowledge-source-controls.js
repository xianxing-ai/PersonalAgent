// Renderer-only bridge UI.
export function mountKnowledgeSourceControls(root, invoke) {
  const section = document.createElement('section');
  section.className = 'sheet knowledge-source-settings';
  section.setAttribute('aria-label', '知识源与笔记整理');
  section.innerHTML = `
    <h2>知识源与笔记整理</h2>
    <p class="notice" data-knowledge-source="name"></p>
    <p class="notice">切换或撤销会停止当前调用。</p>
    <button class="btn" type="button" data-knowledge-source="select">选择知识库</button>
    <button class="btn" type="button" data-knowledge-source="notes">选择可整理的笔记</button>
    <label class="setting-row"><input type="checkbox" data-knowledge-source="enabled">启用所选知识源</label>
    <label class="setting-row">数据范围 <select data-knowledge-source="level"><option value="private">私人，仅本机</option><option value="public">我确认这是公开演示资料</option></select></label>
    <label class="setting-row"><input type="checkbox" data-knowledge-source="write">允许本会话整理笔记（每次需审批）</label>
    <label class="setting-row"><input type="checkbox" data-knowledge-source="cloud">允许发送公开结果到 AgentArts</label>
    <label class="setting-row">公开查询（一行一条）<textarea rows="2" maxlength="2048" data-knowledge-source="queries"></textarea></label>
    <button class="btn" type="button" data-knowledge-source="save">保存所选权限</button>
    <button class="btn" type="button" data-knowledge-source="revoke">撤销知识源</button>
    <h3>Obsidian 本机配对</h3>
    <p>先选择并启用同一个 Vault，再从插件生成一次性配对码。配对会切换检索来源，仅私人、只读。</p>
    <button class="btn" type="button" data-knowledge-source="pair">配对 Obsidian</button>
    <button class="btn" type="button" data-knowledge-source="unpair">撤销配对并返回文件源</button>
    <p class="notice" data-knowledge-source="pair-status" role="status"></p>
    <p class="notice" data-knowledge-source="status" role="status"></p>
    <p class="notice" data-knowledge-source="monitor" role="status"></p>
    <h3>整理选定笔记</h3>
    <label class="setting-row">笔记 <select data-knowledge-source="note"></select></label>
    <button class="btn" type="button" data-knowledge-source="read">读取当前版本</button>
    <pre class="knowledge-source-preview" data-knowledge-source="preview"></pre>
    <label class="setting-row">要替换的唯一原文<textarea rows="3" maxlength="16384" data-knowledge-source="old"></textarea></label>
    <label class="setting-row">替换后的段落<textarea rows="3" maxlength="16384" data-knowledge-source="new"></textarea></label>
    <p class="notice">仅整理所选段落；文件改动后重新读取。备份留在本机。</p>
    <button class="btn" type="button" data-knowledge-source="submit">提交整理并请求审批</button>
    <button class="btn" type="button" data-knowledge-source="reconcile">核实原整理任务</button>
    <p class="notice" data-knowledge-source="write-status" role="status"></p>`;
  root.append(section);
  const field = name => section.querySelector(`[data-knowledge-source="${name}"]`);
  let state = {}, busy = false, noteVersion, settingsDirty = false, lastSubmittedTaskId;
  const binding = () => ({sourceId: state.sourceId, configRevision: state.configRevision});
  function buttons() {
    for (const button of section.querySelectorAll('button')) button.disabled = busy;
    const paired = state.pairing?.mode === 'plugin';
    field('save').textContent = paired ? '保存文件源权限并退出配对' : '保存所选权限';
    field('select').textContent = paired ? '选择文件源并退出配对' : '选择知识库';
    field('pair').disabled = busy || state.pairing?.busy || !state.available;
    field('unpair').disabled = busy || !paired && !state.pairing?.busy;
    field('notes').disabled = busy || paired || !state.available;
    field('read').disabled = busy || paired || !state.available || !field('note').value;
    field('submit').disabled = busy || paired || !state.writeAvailable || !noteVersion;
    field('reconcile').disabled = busy || !state.available || !lastSubmittedTaskId;
    field('cloud').disabled = field('level').value !== 'public';
  }
  function clearNote() {noteVersion = undefined; field('preview').textContent = ''; field('old').value = ''; field('new').value = '';}
  function render(next) {
    if (state.sourceId !== next.sourceId || state.configRevision !== next.configRevision) {clearNote(); settingsDirty = false;}
    state = next;
    field('pair-status').textContent = state.pairing?.reason ?? '';
    field('name').textContent = state.configured ? `${state.displayName} · 配置版本 ${state.configRevision}` : '';
    if (!settingsDirty) {
      field('enabled').checked = state.enabled === true;
      field('level').value = state.dataLevel === 'public' ? 'public' : 'private';
      field('write').checked = state.writeAvailable === true;
      field('cloud').checked = state.cloudExportAllowed === true;
      field('queries').value = (state.publicQueries ?? []).join('\n');
    }
    const selected = field('note').value;
    field('note').replaceChildren(...(state.allowedNotePaths ?? []).map(value => {
      const option = document.createElement('option'); option.value = value; option.textContent = value; return option;
    }));
    if ((state.allowedNotePaths ?? []).includes(selected)) field('note').value = selected;
    field('status').textContent = state.reason === '请选择知识库；尚未配置' ? '' : state.reason ?? '';
    const monitor = state.monitor;
    field('monitor').textContent = !state.available || !monitor ? '' : monitor.state === 'ready'
      ? `已检查 ${monitor.pageCount} 页；后台仅核对旧记忆，新摘录仍需确认`
      : monitor.state === 'retry_pending' ? '来源检查待重试；不会删除记忆或笔记'
      : '正在核对来源；后台不会自动保存新摘录';
    buttons();
  }
  async function act(action, payload, receive = render) {
    if (busy) return;
    busy = true; buttons();
    try {receive(await invoke(action, payload));}
    catch (error) {field('status').textContent = error?.message ?? '知识源操作失败';}
    finally {busy = false; buttons();}
  }
  field('select').addEventListener('click', () => act('knowledge.source.select'));
  field('pair').addEventListener('click', () => act('knowledge.pair'));
  field('unpair').addEventListener('click', () => act('knowledge.pair.revoke'));
  field('notes').addEventListener('click', () => act('knowledge.source.selectNotes', binding()));
  field('revoke').addEventListener('click', () => act('knowledge.source.revoke'));
  field('save').addEventListener('click', () => act('knowledge.source.configure', {...binding(),
    enabled: field('enabled').checked, dataLevel: field('level').value, writeAllowed: field('write').checked,
    cloudExportAllowed: field('level').value === 'public' && field('cloud').checked,
    publicQueries: field('queries').value.split(/\r?\n/).map(value => value.trim()).filter(Boolean)}));
  for (const name of ['enabled', 'level', 'write', 'cloud', 'queries']) {
    field(name).addEventListener('input', () => {settingsDirty = true;});
  }
  field('level').addEventListener('change', () => {settingsDirty = true; if (field('level').value !== 'public') field('cloud').checked = false; buttons();});
  field('note').addEventListener('change', () => {clearNote(); buttons();});
  field('read').addEventListener('click', () => act('knowledge.source.readNote', {...binding(), path: field('note').value}, result => {
    if (result.sourceId !== state.sourceId || result.configRevision !== state.configRevision || result.path !== field('note').value) return;
    noteVersion = result; field('preview').textContent = result.content; field('write-status').textContent = '已读取当前版本；填写要整理的段落';
  }));
  field('submit').addEventListener('click', () => {
    if (!noteVersion || !field('old').value) return;
    const payload = {...binding(), path: noteVersion.path, expectedSha256: noteVersion.revision,
      edits: [{oldText: field('old').value, newText: field('new').value}]};
    void act('knowledge.source.submitPatch', payload, result => {
      // Use Runtime readback for task status.
      const taskId = result?.taskId ?? result?.task?.taskId;
      if (typeof taskId === 'string' && taskId) lastSubmittedTaskId = taskId;
      clearNote();
      const taskState = result?.state ?? result?.task?.state ?? 'pending';
      field('write-status').textContent = taskState === 'waiting_approval' ? '已提交，等待审批'
        : taskState === 'waiting_reconciliation' ? '写入结果待核实，请查看任务状态'
          : `已受理整理任务：${taskState}；以任务读回为准`;
    });
  });
  field('reconcile').addEventListener('click', () => {
    if (!lastSubmittedTaskId) return;
    void act('knowledge.source.reconcile', {taskId: lastSubmittedTaskId}, result => {
      if (result?.taskId !== lastSubmittedTaskId) throw Error('原整理任务读回不一致');
      field('write-status').textContent = result.state === 'waiting_reconciliation'
        ? '原写入结果仍待核实，已保留现场；请稍后再次核实'
        : result.projection?.pending > 0 ? '原写入已核实，记忆来源更新仍待恢复；再次核实只更新记忆，不重复写笔记'
        : `原整理任务状态：${result.state ?? 'pending'}；以任务读回为准`;
    });
  });
  return {element: section, update(snapshot) {render(snapshot?.knowledgeSource ?? snapshot ?? {});},
    dispose() {section.remove();}};
}

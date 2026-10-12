/** Renderer controls only; the trusted host selects and binds the workspace. */
export function mountWorkspaceControls(root, invoke) {
  const section = document.createElement('section');
  section.className = 'sheet coding-workspace';
  section.setAttribute('aria-label', '编程工作区');
  section.innerHTML = `
    <h2>编程工作区</h2>
    <p class="notice">选择目录时由本机宿主打开系统选择器；此页面不读取或传递目录路径。</p>
    <p class="notice" data-workspace="name"></p>
    <p class="notice" data-workspace="capabilities"></p>
    <button class="btn" type="button" data-workspace="select">选择工作区</button>
    <p class="notice" data-workspace="node-status"></p>
    <button class="btn" type="button" data-workspace="select-node">选择本机 Node</button>
    <button class="btn" type="button" data-workspace="select-file">选择要做语法检查的 JS 文件</button>
    <p class="notice">Node --check 只检查所选文件的语法，不运行项目脚本；可执行文件和文件路径由本机宿主固定，Agent 无法指定。</p>
    <p class="notice" data-workspace="project-status"></p>
    <button class="btn" type="button" data-workspace="select-npm">找不到 npm 时选择本机 npm 文件</button>
    <label class="setting-row"><input type="checkbox" data-workspace="cloud">允许将此工作区的工具结果发送给 AgentArts</label>
    <label class="setting-row"><input type="checkbox" data-workspace="write">额外允许写入工作区</label>
    <label class="setting-row"><input type="checkbox" data-workspace="command">额外允许执行受限命令</label>
    <label class="setting-row"><input type="checkbox" data-workspace="project-code" disabled><span data-workspace="project-label">允许执行项目构建/测试（尚未准备好）</span></label>
    <p class="notice">项目构建和测试会执行工作区中的代码，可读写当前用户有权访问的内容。这不是隔离沙箱；只有本机执行组件就绪且你在本会话单独勾选后才会开放，每次执行仍需本地审批。</p>
    <p class="notice">发送范围与写入、命令许可由宿主保存；每次实际执行仍须经过本地 Policy 校验与必要审批。</p>
    <button class="btn" type="button" data-workspace="authorize">授权本地读取及所选权限</button>
    <button class="btn" type="button" data-workspace="revoke">撤销工作区授权</button>
    <p class="notice" data-workspace="status" role="status"></p>`;
  root.append(section);

  const field = name => section.querySelector(`[data-workspace="${name}"]`);
  let state = {};
  let busy = false;
  let consentDirty = false;
  let feedback = '';
  let unconfirmed = false;
  let originatingFocus,restoreFocus=false;
  const trackFocus=event=>{if(!section.contains(event.target) && event.target!==document.body) restoreFocus=false;};

  function projectCommandNames() {
    const commands = state.projectCommands;
    if (!Array.isArray(commands)
      || !commands.length || [...commands].some(command => !['build','test'].includes(command))
      || new Set(commands).size !== commands.length) return [];
    return ['build','test'].filter(command => commands.includes(command));
  }

  function updateStatus() {
    const hostReason = (typeof state.reason === 'string' ? state.reason : '')
      || (state.configured === true ? '请按需选择授权范围；设置状态以宿主读回为准。' : '请先由本机宿主选择工作区。');
    field('status').textContent = feedback || (consentDirty && !busy && !unconfirmed
      ? `权限选择尚未生效。点击“授权本地读取及所选权限”应用；要停止当前权限，请撤销授权。当前生效状态：${hostReason}`
      : hostReason);
  }

  function updateButtons() {
    const configured = state.configured === true;
    field('select').disabled = busy;
    field('select-node').disabled = busy || !configured;
    field('select-file').disabled = busy || !configured;
    field('select-npm').disabled = busy || !configured || state.nodeConfigured !== true;
    field('cloud').disabled = busy || !configured;
    field('write').disabled = busy || !configured;
    field('command').disabled = busy || !configured;
    field('project-code').disabled = busy || !configured || state.projectScriptsAvailable !== true || !field('command').checked;
    field('authorize').disabled = busy || !configured || state.authorizationAvailable !== true;
    field('revoke').disabled = busy || (!configured && state.cloudExportAllowed !== true);
    updateStatus();
  }

  function render(snapshot = {}, {keepFeedback = false} = {}) {
    if (!keepFeedback && !busy && !unconfirmed) feedback = '';
    const next = snapshot?.coding ?? {};
    const previousName = state.displayName;
    const previouslyAllowed = state.cloudExportAllowed === true;
    state = next && typeof next === 'object' && !Array.isArray(next) ? next : {};
    const configured = state.configured === true;
    const displayName = configured && typeof state.displayName === 'string' && state.displayName.trim()
      ? state.displayName : configured ? '已选择工作区' : '未选择工作区';
    field('name').textContent = `当前工作区：${displayName}`;
    field('capabilities').textContent = configured
      ? `读取：${state.readAvailable === true ? '可用' : '不可用'} · 写入：${state.writeAvailable === true ? '可用' : '不可用'} · 受限命令：${state.commandAvailable === true ? '可用' : '不可用'} · AgentArts 结果发送：${state.cloudExportAllowed === true ? '已允许' : '未允许'}`
      : '读取、写入和受限命令均未启用';
    field('node-status').textContent = configured
      ? `Node：${state.nodeConfigured === true ? '已选择' : '未选择'} · 检查文件：${state.checkFileConfigured === true && typeof state.checkFileName === 'string' ? state.checkFileName : '未选择'} · Node 语法检查：${state.nodeCheckAvailable === true ? '可用' : '不可用'}${typeof state.commandReason === 'string' && state.commandReason ? ` · ${state.commandReason}` : ''}`
      : '先选择工作区，再由本机宿主选择 Node 与工作区内 JS 文件。';
    const projectCommands = projectCommandNames();
    const projectReady = configured && state.projectScriptsAvailable === true;
    const projectDescription = projectCommands.map(command => command === 'build' ? '构建' : '测试').join('/');
    field('project-status').textContent = configured
      ? `npm 文件：${state.npmCliConfigured === true ? '已确定' : '未找到，可手动选择'} · ${projectReady && !projectCommands.length ? '项目命令信息待读回' : `项目${projectDescription || '命令'}：${projectReady ? '可授权' : '暂不可用'}`}${typeof state.projectReason === 'string' && state.projectReason ? ` · ${state.projectReason}` : ''}`
      : '选择工作区后才会检查项目构建和测试是否可用。';
    field('project-label').textContent = projectReady
      ? `单独允许本会话执行项目${projectDescription || '命令'}（先勾选受限命令）`
      : '允许执行项目构建/测试（尚未准备好）';
    if (!projectReady) field('project-code').checked = false;
    if (!configured || previousName !== state.displayName || (previouslyAllowed && state.cloudExportAllowed !== true)) {
      field('write').checked = false;
      field('command').checked = false;
      field('project-code').checked = false;
      consentDirty = false;
    }
    if (!consentDirty) {
      field('cloud').checked = configured && state.cloudExportAllowed === true;
      field('write').checked = configured && state.writeAllowed === true;
      field('command').checked = configured && state.commandAllowed === true;
      field('project-code').checked = projectReady && field('command').checked && state.projectCodeAllowed === true;
    }
    updateButtons();
  }

  async function run(action, payload) {
    if (busy) return;
    originatingFocus=section.contains?.(document.activeElement)?document.activeElement:undefined;
    restoreFocus=Boolean(originatingFocus);
    document.addEventListener?.('focusin',trackFocus,true);
    busy = true;
    unconfirmed = false;
    feedback = '正在等待本机宿主读回…';
    section.setAttribute('aria-busy', 'true');
    field('status').textContent = feedback;
    updateButtons();
    try {
      const result = payload === undefined ? await invoke(action) : await invoke(action, payload);
      if (result && typeof result === 'object' && result.coding && typeof result.coding === 'object'
        && !Array.isArray(result.coding) && typeof result.coding.configured === 'boolean') {
        feedback = '';
        const cancelledSelection = ['coding.select','coding.selectNode','coding.selectCheckFile','coding.selectNpmCli'].includes(action)
          && result.codingSelectionCancelled === true;
        if (!cancelledSelection) consentDirty = false;
        render(result);
      } else {
        unconfirmed = true;
        feedback = '操作结果未获确认，请检查本机工作区状态后再操作。';
        render({coding: state}, {keepFeedback: true});
      }
    } catch {
      unconfirmed = true;
      feedback = '工作区操作未完成，可重试或查看本机状态。';
      render({coding: state}, {keepFeedback: true});
    } finally {
      busy = false;
      section.setAttribute('aria-busy', 'false');
      updateButtons();
      document.removeEventListener?.('focusin',trackFocus,true);
      if(restoreFocus && document.activeElement===document.body && section.isConnected && !section.hidden
        && section.getClientRects().length && originatingFocus?.isConnected && section.contains(originatingFocus)
        && !originatingFocus.disabled) originatingFocus.focus();
      originatingFocus=undefined;restoreFocus=false;
    }
  }

  field('cloud').addEventListener('change', () => { consentDirty = true; updateButtons(); });
  field('write').addEventListener('change', () => { consentDirty = true; updateButtons(); });
  field('command').addEventListener('change', () => {
    consentDirty = true;
    if (!field('command').checked) field('project-code').checked = false;
    updateButtons();
  });
  field('project-code').addEventListener('change', () => { consentDirty = true; updateButtons(); });
  field('select').addEventListener('click', () => run('coding.select'));
  field('select-node').addEventListener('click', () => run('coding.selectNode'));
  field('select-file').addEventListener('click', () => run('coding.selectCheckFile'));
  field('select-npm').addEventListener('click', () => run('coding.selectNpmCli'));
  field('authorize').addEventListener('click', () => {
    if (state.configured !== true || state.authorizationAvailable !== true) return;
    run('coding.authorize', {
      cloudExportAllowed: field('cloud').checked,
      writeAllowed: field('write').checked,
      commandAllowed: field('command').checked,
      projectCodeAllowed: state.projectScriptsAvailable === true && field('project-code').checked,
    });
  });
  field('revoke').addEventListener('click', () => run('coding.revoke'));

  render();
  return {render,show:visible=>{section.hidden=!visible;if(!visible) restoreFocus=false;}};
}

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
    <p class="notice">选择目录和运行组件只保存配置。读取、写入、受限命令和结果出机的具体范围，会在执行请求的对话提问卡一次确认，无需在设置重复允许。</p>
    <p class="notice">项目构建和测试会运行工作区代码。是否具备隔离能力以可信宿主报告的沙箱为准；组件未就绪不能通过卡片放行，每次执行仍经原 Policy 校验。</p>
    <button class="btn" type="button" data-workspace="revoke">撤销工作区授权</button>
    <p class="notice" data-workspace="status" role="status"></p>`;
  root.append(section);

  const field = name => section.querySelector(`[data-workspace="${name}"]`);
  let state = {};
  let busy = false;
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
      || (state.configured === true ? '配置状态以宿主读回为准；操作授权在当前对话提问卡确认。' : '请先由本机宿主选择工作区。');
    field('status').textContent = feedback || hostReason;
  }

  function updateButtons() {
    const configured = state.configured === true;
    field('select').disabled = busy;
    field('select-node').disabled = busy || !configured;
    field('select-file').disabled = busy || !configured;
    field('select-npm').disabled = busy || !configured || state.nodeConfigured !== true;
    field('revoke').disabled = busy || (!configured && state.cloudExportAllowed !== true);
    updateStatus();
  }

  function render(snapshot = {}, {keepFeedback = false} = {}) {
    if (!keepFeedback && !busy && !unconfirmed) feedback = '';
    const next = snapshot?.coding ?? {};
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

  field('select').addEventListener('click', () => run('coding.select'));
  field('select-node').addEventListener('click', () => run('coding.selectNode'));
  field('select-file').addEventListener('click', () => run('coding.selectCheckFile'));
  field('select-npm').addEventListener('click', () => run('coding.selectNpmCli'));
  field('revoke').addEventListener('click', () => run('coding.revoke'));

  render();
  return {render,show:visible=>{section.hidden=!visible;if(!visible) restoreFocus=false;}};
}

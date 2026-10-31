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
    <h3>CI 修复与测试失败定位</h3>
    <p class="notice">由本机选择 F16 / F17 案例 JSON，绑定当前工作区和已有固定命令。选择案例不授予执行或结果发送权限；任务仍须读取原失败回执并逐项确认。</p>
    <p class="notice" data-workspace="f16-state"></p>
    <button class="btn" type="button" data-workspace="f16-select">选择 CI 修复案例</button>
    <p class="notice" data-workspace="f17-state"></p>
    <button class="btn" type="button" data-workspace="f17-select">选择测试定位案例</button>
    <h3>API 文档检查</h3>
    <p class="notice">选择 TypeScript 契约、实现和目标文档。示例在隔离目录进行类型检查，结果为待审文档候选；每次读取、执行与发送仍在原任务确认。</p>
    <p class="notice" data-workspace="f20-state"></p>
    <label>案例标识 <input data-workspace="f20-ref" autocomplete="off" maxlength="128" placeholder="api-docs"></label>
    <label>文档模板 <textarea data-workspace="f20-template" rows="3" maxlength="4096" placeholder="描述参数、返回值和与实现一致的示例"></textarea></label>
    <button class="btn" type="button" data-workspace="f20-configure">选择契约、实现和文档</button>
    <h3>独立补丁审核</h3>
    <p class="notice">由本机选择独立审核者的公钥与签名目录。确认独立性只表示用户确认，不证明审核者身份；补丁不会自动发送。</p>
    <p class="notice" data-workspace="review-state"></p>
    <label>审核者标识 <input data-workspace="reviewer-id" autocomplete="off" maxlength="128"></label>
    <label>审核策略标识 <input data-workspace="review-policy" autocomplete="off" maxlength="128"></label>
    <button class="btn" type="button" data-workspace="review-configure">选择公钥与签名目录</button>
    <button class="btn" type="button" data-workspace="review-revoke">撤销独立审核配置</button>
    <div data-workspace="review-pending"></div>
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
    const unavailable=state.selectionAvailable===false;
    field('select').disabled = busy || unavailable;
    field('select-node').disabled = busy || unavailable || !configured;
    field('select-file').disabled = busy || unavailable || !configured;
    field('select-npm').disabled = busy || unavailable || !configured || state.nodeConfigured !== true;
    field('revoke').disabled = busy || unavailable || (!configured && state.cloudExportAllowed !== true);
    field('review-configure').disabled=busy||unavailable||state.independentReview?.canConfigure!==true;
    field('review-revoke').disabled=busy||unavailable||state.independentReview?.configured!==true;
    field('f20-configure').disabled=busy||unavailable||!configured||state.nodeConfigured!==true;
    for(const workflow of ['F16','F17'])field(workflow.toLowerCase()+'-select').disabled=
      busy||unavailable||!configured||!state.f16f17;
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
    const review=state.independentReview??{};
    for(const workflow of ['F16','F17']){
      const value=state.f16f17?.[workflow];
      const selected=value?.configured===true&&typeof value.selectionRef==='string'&&value.selectionRef.trim();
      const reasons=Array.isArray(state.f16f17?.unavailable)?state.f16f17.unavailable.filter(reason=>typeof reason==='string'
        &&(!/^f(?:16|17)_/u.test(reason)||reason.startsWith(workflow.toLowerCase()+'_')||reason.startsWith('f16_f17_')))
        .map(reason=>reason==='f16_ci_publication_tool_chain_unavailable'?'提交并推送修复以触发 GitHub CI 的流程尚未就绪。':
          /^[a-z0-9_]+$/u.test(reason)?'工作区、固定命令或运行服务尚未就绪。':reason):[];
      field(workflow.toLowerCase()+'-state').textContent=`${workflow}：${selected?`案例 ${value.selectionRef}；执行时核对原失败来源与许可`:'尚未配置案例'}${reasons.length?` · 宿主报告不可用：${reasons.join('；')}`:''}`;
    }
    field('f20-state').textContent=state.f20?.configured===true?`已配置案例：${state.f20.inputRef}；运行条件会在任务执行时核对。`:'文档检查案例尚未配置。';
    field('review-state').textContent=review.installed===true
      ? `审核者：${review.reviewerId} · 策略：${review.policyId} · 独立性：用户确认 · 签名验证已接入`
      : review.configured===true?'已配置，但原任务绑定或本机展示尚不可用。':'独立审核尚未配置或当前不可用。';
    const pending=field('review-pending');pending.replaceChildren();
    for(const item of Array.isArray(review.pending)?review.pending:[]) {
      const row=document.createElement('div'),description=document.createElement('p'),button=document.createElement('button');
      description.className='notice';description.textContent=`待审核任务 ${item.taskId} · 补丁 ${item.patchDigest} · 签名文件 ${item.recordFileName}`;
      button.className='btn';button.type='button';button.textContent='在本机查看原补丁';button.disabled=busy;
      button.addEventListener('click',()=>run('coding.review.show',{operationId:item.recordFileName.slice(0,-5)}));
      row.append(description,button);pending.append(row);
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
        feedback = action==='coding.review.show'?(result.reviewShown===true?'原补丁窗口已关闭；审核结论以独立签名为准。':'未完成本机展示。'):'';
        render(result,{keepFeedback:!!feedback});
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
  for(const workflowId of ['F16','F17'])field(workflowId.toLowerCase()+'-select')
    .addEventListener('click',()=>run('coding.f16f17.select',{workflowId}));
  field('review-configure').addEventListener('click',()=>run('coding.review.configure',{
    reviewerId:field('reviewer-id').value,policyId:field('review-policy').value}));
  field('review-revoke').addEventListener('click',()=>run('coding.review.revoke'));
  field('f20-configure').addEventListener('click',()=>run('coding.f20.configure',{
    inputRef:field('f20-ref').value.trim(),docTemplate:field('f20-template').value,recipeId:'f20-typescript-sample'}));

  render();
  return {render,show:visible=>{section.hidden=!visible;if(!visible) restoreFocus=false;}};
}

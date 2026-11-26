export function mountGitHubControls(root, invoke) {
  const settings = document.createElement('details');
  settings.className = 'sis-settings';
  settings.innerHTML = [
    '<summary>GitHub 连接器</summary>',
    '<div class="sis-fields">',
    '<p class="notice">凭据仅在本机使用系统安全存储加密保存。支持读取仓库/代码/Issue/PR/Actions/提交与创建评论/Issue/PR/Review/合并；所有仓库写入与首次访问均在对话提问卡内逐次确认。</p>',
    '<div class="sis-actions">',
    '<button data-github="detect" type="button">一键读取并连接本机 gh 登录</button>',
    '</div>',
    '<label>Personal Access Token（或留空保留已存凭据仅改仓库范围）<input data-github="token" type="password" autocomplete="off" maxlength="4096" placeholder="ghp_... / github_pat_..."></label>',
    '<label>仓库访问范围（留空或 * 表示Token 可见全部仓库；可用逗号/换行分隔多个 owner/repo）<input data-github="repos" autocomplete="off" maxlength="2048" placeholder="* 或 owner/repo1, owner/repo2"></label>',
    '<div class="sis-actions">',
    '<button data-github="save" type="button">保存配置</button>',
    '<button data-github="revoke" type="button">断开并清除凭据</button>',
    '</div>',
    '<p data-github="status" class="notice" role="status"></p>',
    '</div>',
  ].join('');
  const anchor = root.querySelector('#error');
  if (anchor) anchor.before(settings);
  else root.append(settings);

  const field = name => settings.querySelector(`[data-github="${name}"]`);
  let busy = false;
  let state = {};

  const buttons = () => {
    field('detect').disabled = busy;
    field('save').disabled = busy;
    field('revoke').disabled = busy || (!state.configured && state.status !== 'unavailable');
  };

  const formatRepos = value => (Array.isArray(value?.repositories) && value.repositories.length ? value.repositories.join(', ') : '*');

  function render(value = {}) {
    state = value ?? {};
    if (document.activeElement !== field('repos') && !busy) {
      field('repos').value = formatRepos(state);
    }
    const modeLabel = state.authMode === 'gh_cli' ? 'gh CLI' : 'PAT';
    const accountLabel = state.configured ? `@${state.login || 'authenticated'} (${modeLabel})` : '未连接';
    field('status').textContent = `GitHub · ${accountLabel} · ${state.reason ?? '请导入本机 gh 登录或填写 PAT'}`;
    buttons();
  }

  field('detect').onclick = async () => {
    busy = true;
    buttons();
    field('status').textContent = 'GitHub · 正在检测本机 gh 登录并验证账号…';
    try {
      const repos = field('repos').value.trim();
      const result = await invoke('github.detectGh', {
        importToken: true,
        ...(repos ? {repositories: repos} : {}),
      });
      if (result?.snapshot) {
        field('token').value = '';
        render(result.snapshot);
      } else {
        field('status').textContent = `GitHub · ${result?.message || '未检测到可用 gh 登录'}`;
      }
    } catch (error) {
      field('status').textContent = `GitHub · ${error?.message || '读取本机 gh 登录失败，请尝试粘贴 PAT'}`;
    } finally {
      busy = false;
      buttons();
    }
  };

  field('save').onclick = async () => {
    const token = field('token').value.trim();
    const repositories = field('repos').value.trim();
    field('token').value = '';
    busy = true;
    buttons();
    field('status').textContent = 'GitHub · 正在验证并加密保存凭据…';
    try {
      const next = await invoke('github.configure', {
        ...(token ? {token} : {}),
        repositories: repositories || '*',
      });
      render(next);
    } catch (error) {
      field('status').textContent = `GitHub · ${error?.message || '保存 GitHub 配置失败，请检查 Token 与仓库格式'}`;
    } finally {
      busy = false;
      buttons();
    }
  };

  field('revoke').onclick = async () => {
    busy = true;
    buttons();
    try {
      const next = await invoke('github.revoke');
      field('token').value = '';
      field('repos').value = '*';
      render(next);
    } catch (error) {
      field('status').textContent = `GitHub · ${error?.message || '清除 GitHub 配置失败'}`;
    } finally {
      busy = false;
      buttons();
    }
  };

  return {
    render,
    show(show) {
      settings.hidden = !show;
      if (!show) field('token').value = '';
    },
    close() {
      field('token').value = '';
      settings.remove();
    },
  };
}

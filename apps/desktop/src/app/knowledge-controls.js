const escape = str => String(str ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const safeCitation = value => {
  try { const url = new URL(value); return ['http:', 'https:'].includes(url.protocol) ? url.href : null; }
  catch { return null; }
};
const citationHtml = value => safeCitation(value)
  ? `<a href="${escape(safeCitation(value))}" target="_blank" rel="noopener noreferrer">${escape(value)}</a>`
  : `<code>${escape(value)}</code>`;

// Keep citations tied to source items.
export function knowledgeFeedCitationHtml(answer = {}) {
  if (Array.isArray(answer.items) && answer.items.length) {
    return answer.items.map(item => `<div class="source-item" data-source-item="${escape(item.itemKey)}">
      <strong>${escape(item.title)}</strong>
      <p class="source-excerpt">${escape(item.excerpt)}</p>
      <p class="source-cite">引用：${citationHtml(item.citation)} · 来源版本：<code>${escape(item.sourceRevision)}</code></p>
    </div>`).join('');
  }
  return answer.citation && !String(answer.citation).startsWith('knowledge-feed-citations:')
    ? `<p class="source-cite">引用：${citationHtml(answer.citation)}</p>` : '';
}

export function mountKnowledgeControls(container, invoke) {
  const section = document.createElement('section');
  section.className = 'feature-page';
  section.setAttribute('aria-label', '知识库与关注监控');
  section.innerHTML = `
    <header class="settings-heading"><h2>本地知识库与笔记</h2><p>知识检索只读；笔记内容不会自动外发。</p></header>
    <div class="settings-list">
      <div class="setting-row">
        <span>知识库状态</span>
        <strong data-vault-status>检测中…</strong>
      </div>
      <div class="setting-row">
        <span>目录路径</span>
        <code data-vault-path></code>
      </div>
    </div>
    <form class="knowledge-search-form memory-search">
      <input type="text" name="query" placeholder="输入关键词检索本地笔记…" required>
      <button class="btn" type="submit">检索笔记</button>
    </form>
    <p class="notice" data-search-status role="status"></p>
    <div class="knowledge-results" data-results></div>
    <header class="settings-heading"><h2>知识关注与增量更新</h2><p>只使用已绑定的当前事实。</p></header>
    <div class="settings-list">
      <div class="setting-row">
        <span>关注宿主状态</span>
        <strong data-watch-status>未装配</strong>
      </div>
      <div class="setting-row">
        <span>关注命名空间</span>
        <code data-watch-namespace>未配置</code>
      </div>
    </div>
    <div class="memory-actions">
      <button class="btn" data-action-refresh-watch type="button">检查关注更新</button>
    </div>
    <p class="notice" data-watch-op-status role="status"></p>
    <h3 class="memory-subhead">已跟踪关注事项与事实状态</h3>
    <div data-watch-list class="knowledge-results">
      <p class="notice">暂无跟踪中的关注事项。</p>
    </div>
    <h3 class="memory-subhead">待确认提醒与投递回执</h3>
    <div data-notice-list class="knowledge-results">
      <p class="notice">暂无待确认提醒。</p>
    </div>
  `;
  container.append(section);

  const vaultStatus = section.querySelector('[data-vault-status]');
  const vaultPath = section.querySelector('[data-vault-path]');
  const vaultStatusRow = vaultStatus.closest('.setting-row');
  const vaultPathRow = vaultPath.closest('.setting-row');
  const form = section.querySelector('form');
  const searchStatus = section.querySelector('[data-search-status]');
  const resultsContainer = section.querySelector('[data-results]');
  const searchButton = form.querySelector('button');

  const watchStatus = section.querySelector('[data-watch-status]');
  const watchNamespace = section.querySelector('[data-watch-namespace]');
  const watchOpStatus = section.querySelector('[data-watch-op-status]');
  const refreshWatchBtn = section.querySelector('[data-action-refresh-watch]');
  const watchList = section.querySelector('[data-watch-list]');
  const noticeList = section.querySelector('[data-notice-list]');

  let current = null;
  let currentWatch = null;
  let searching = false;
  let operating = false;
  const trackedSources = () => [...new Set(Object.values(currentWatch?.watches ?? {})
    .filter(watch => watch.state === 'tracked').map(watch => watch.boundSource?.sourceId).filter(Boolean))];

  form.addEventListener('submit', async event => {
    event.preventDefault();
    if (searching) return;
    const query = form.elements.query.value.trim();
    if (!query) return;
    searching = true;
    searchButton.disabled = true;
    searchStatus.textContent = `正在检索 "${query}"…`;
    resultsContainer.innerHTML = '';
    try {
      const res = await invoke('knowledge.search', {query, limit: 10});
      const hits = Array.isArray(res?.hits) ? res.hits : [];
      if (hits.length === 0) {
        searchStatus.textContent = `未找到与 "${query}" 相关的笔记内容。`;
      } else {
        searchStatus.textContent = `检索到 ${hits.length} 条相关结果${res.truncated ? '（已截断展示）' : ''}：`;
        resultsContainer.innerHTML = hits.map(hit => `
          <article class="task watch-card">
            <p class="watch-meta"><strong>${escape(hit.source?.path || '未知文件')}</strong> <span class="notice">第 ${Number(hit.source?.line || 1)} 行</span></p>
            <p class="source-excerpt">${escape(hit.excerpt || '')}</p>
          </article>
        `).join('');
      }
    } catch (err) {
      searchStatus.textContent = `检索失败：${err.message || '未知错误'}`;
    } finally {
      searching = false;
      searchButton.disabled = !current?.available;
    }
  });

  refreshWatchBtn.addEventListener('click', async () => {
    if (operating) return;
    operating = true;
    refreshWatchBtn.disabled = true;
    watchOpStatus.textContent = '正在检查关注来源增量…';
    try {
      const responses = [];
      for (const subscriptionId of trackedSources()) responses.push(await invoke('knowledge.watch.refresh', {subscriptionId}));
      if (responses.some(res => res?.notified)) {
        watchOpStatus.textContent = `已观察到来源变化，重评状态以任务读回为准。`;
      } else if (responses.length) {
        watchOpStatus.textContent = `检查完成：${responses.map(res => res?.reason === 'unchanged' ? '来源未发生改变' : res?.reason || '状态未确认').join('；')}。`;
      } else {
        watchOpStatus.textContent = '当前没有已授权且正在跟踪的来源。';
      }
    } catch (err) {
      watchOpStatus.textContent = `检查失败：${err.message || '未知错误'}`;
    } finally {
      operating = false;
      await refreshWatchState();
    }
  });

  async function refreshWatchState() {
    try { render(current, await invoke('knowledge.watch.status')); }
    catch { render(current, currentWatch); }
  }

  async function handleRead(noticeId) {
    if (operating) return;
    operating = true;
    watchOpStatus.textContent = '正在标记提醒为已读…';
    try {
      const res = await invoke('knowledge.watch.read', {id: noticeId});
      if (res?.accepted) {
        watchOpStatus.textContent = '提醒已标记为已读；系统投递与来源版本绑定保持各自的状态。';
      } else {
        watchOpStatus.textContent = `已读记录失败：${res?.reason || '未知原因'}`;
      }
    } catch (err) {
      watchOpStatus.textContent = `已读记录失败：${err.message || '未知错误'}`;
    } finally {
      operating = false;
      await refreshWatchState();
    }
  }

  async function handleBind(topicId) {
    if (operating) return;
    operating = true;
    watchOpStatus.textContent = '正在读回重评结果并绑定新版本…';
    try {
      const res = await invoke('knowledge.watch.bind', {topicId});
      if (res?.accepted) {
        watchOpStatus.textContent = `新版本绑定成功！版本已更新为 ${res.revision}，现可作为正式当前事实消费。`;
      } else {
        watchOpStatus.textContent = `无法绑定新版本：${res?.reason || '未确认'}（任务状态：${res?.taskState || '未知'}；未提前修改绑定版本）。`;
      }
    } catch (err) {
      watchOpStatus.textContent = `绑定失败：${err.message || '未知错误'}`;
    } finally {
      operating = false;
      await refreshWatchState();
    }
  }

  async function handleRevoke(topicId) {
    if (operating) return;
    operating = true;
    watchOpStatus.textContent = `正在撤销关注 (${topicId})…`;
    try {
      const res = await invoke('knowledge.watch.revoke', {topicId, id: `user-revoke-${Date.now()}`});
      if (res?.state === 'revoked') {
        watchOpStatus.textContent = `主题 "${topicId}" 已成功撤销关注。`;
      } else {
        watchOpStatus.textContent = `撤销失败：${res?.reason || '未知错误'}`;
      }
    } catch (err) {
      watchOpStatus.textContent = `撤销失败：${err.message || '未知错误'}`;
    } finally {
      operating = false;
      await refreshWatchState();
    }
  }

  async function handleTracking(topicId, action) {
    if (operating) return;
    operating = true;
    watchOpStatus.textContent = action === 'pause' ? '正在暂停关注…' : '正在恢复关注…';
    try {
      const res = await invoke(`knowledge.watch.${action}`, {topicId});
      watchOpStatus.textContent = res?.state === 'tracked' ? '已恢复关注。'
        : res?.state === 'paused' ? '已暂停关注。' : `关注状态：${res?.reason || res?.state || '未确认'}。`;
    } catch (err) { watchOpStatus.textContent = `操作失败：${err.message || '未知错误'}`; }
    finally { operating = false; await refreshWatchState(); }
  }

  function render(vaultValue = {}, watchValue = null) {
    current = vaultValue;
    currentWatch = watchValue;

    const isAvailable = vaultValue.available === true;
    const vaultReason = vaultValue.reason === '请选择知识库；尚未配置' ? '' : vaultValue.reason;
    vaultStatus.textContent = isAvailable ? `${vaultValue.name || '本地知识库'}（就绪）` : (vaultReason || '');
    vaultPath.textContent = vaultValue.rootPath || '';
    vaultStatusRow.hidden = !isAvailable && !vaultReason;
    vaultPathRow.hidden = !vaultValue.rootPath;
    searchButton.disabled = !isAvailable || searching;

    if (!watchValue || watchValue.state === 'unavailable') {
      watchStatus.textContent = watchValue?.reason || '知识关注宿主尚未装配';
      watchNamespace.textContent = '无';
      refreshWatchBtn.disabled = true;
      watchList.innerHTML = '<p class="notice">知识关注宿主尚未装配。</p>';
      noticeList.innerHTML = '<p class="notice">无提醒。</p>';
      return;
    }

    watchStatus.textContent = watchValue.health?.status === 'ready'
      ? (watchValue.running ? '正常运行中' : '已停止') : (watchValue.health?.reason || watchValue.health?.status || '未就绪');
    watchNamespace.textContent = watchValue.namespace || '未指定';
    refreshWatchBtn.disabled = operating || watchValue.running !== true || watchValue.health?.status !== 'ready'
      || !trackedSources().length;

    const dialogueItems = Array.isArray(watchValue.dialogue?.items) ? watchValue.dialogue.items : [];
    const watches = watchValue.watches ? Object.values(watchValue.watches) : [];

    if (watches.length === 0 && dialogueItems.length === 0) {
      watchList.innerHTML = '<p class="notice">暂无跟踪中的关注事项。</p>';
    } else {
      const renderedTopics = new Set();
      const cards = [];

      for (const item of dialogueItems) {
        renderedTopics.add(item.topicId);
        const ans = item.answer || {};
        let kindLabel = '未就绪';
        if (ans.kind === 'current_fact') kindLabel = '已确认当前事实';
        else if (ans.kind === 'latest_observation') kindLabel = '最新观察待重评';
        else if (ans.kind === 'withheld') kindLabel = `已扣留/待重评 (${ans.reason || 'withheld'})`;

        cards.push(`
          <article class="task watch-card">
            <div class="watch-card-head">
              <strong>${escape(item.topicId)}</strong>
              <span class="watch-badge" data-kind="${escape(ans.kind || '')}">${escape(kindLabel)}</span>
            </div>
            <p class="watch-meta">
              当前绑定版本：<code>${escape(item.boundSource?.revision || '无')}</code> |
              当前事实可用性：<strong>${item.usableAsCurrentFact ? '可用' : '不可作为当前事实'}</strong>
            </p>
            ${knowledgeFeedCitationHtml(ans)}
            ${ans.kind === 'latest_observation' ? `
              <div class="watch-alert">
                <p>已观察到来源新版本：<code>${escape(ans.sourceRevision || '最新')}</code>。需经本地 Runtime 重评任务确认方可接受。</p>
                <div class="watch-actions">
                  <button class="btn btn-sm" data-bind-topic="${escape(item.topicId)}" type="button" ${!item.binding?.ready ? 'disabled' : ''}>绑定已重评的新版本</button>
                </div>
                <p>重评状态：${escape(item.binding?.reason || 'reevaluation_unavailable')}${item.binding?.taskState ? `（${escape(item.binding.taskState)}）` : ''}</p>
              </div>
            ` : ''}
            <div class="watch-actions">
              ${['tracked', 'paused'].includes(item.state) ? `<button class="btn btn-sm" data-track-topic="${escape(item.topicId)}" data-track-action="${item.state === 'paused' ? 'resume' : 'pause'}" type="button">${item.state === 'paused' ? '恢复关注' : '暂停关注'}</button>` : ''}
              <button class="btn btn-sm btn-danger" data-revoke-topic="${escape(item.topicId)}" type="button">撤销关注</button>
            </div>
          </article>
        `);
      }

      for (const watch of watches) {
        if (renderedTopics.has(watch.topicId)) continue;
        cards.push(`
          <article class="task watch-card">
            <div class="watch-card-head">
              <strong>${escape(watch.topicId)}</strong>
              <span class="watch-badge">${escape(watch.state)}</span>
            </div>
            <p class="watch-meta">状态：${escape(watch.reason || '无')} | 版本：${Number(watch.revision || 1)}</p>
            <div class="watch-actions">
              <button class="btn btn-sm btn-danger" data-revoke-topic="${escape(watch.topicId)}" type="button">撤销关注</button>
            </div>
          </article>
        `);
      }

      watchList.innerHTML = cards.join('');
    }

    const notices = Array.isArray(watchValue.notices) ? watchValue.notices : [];
    if (notices.length === 0) {
      noticeList.innerHTML = '<p class="notice">暂无待确认提醒。</p>';
    } else {
      noticeList.innerHTML = notices.map(notice => `
        <article class="task watch-card">
          <div class="watch-card-head">
            <strong>提醒 ID: ${escape(notice.id?.slice(0, 12))}…</strong>
            <span class="watch-badge">${notice.delivered ? '系统已投递' : '系统投递未确认'} · ${notice.readAt ? '用户已读' : '用户未读'}</span>
          </div>
          <p class="watch-meta">${escape(notice.text || notice.summary || '关注来源更新提醒')}</p>
          ${!notice.readAt ? `
            <div class="watch-actions">
              <button class="btn btn-sm" data-read-notice="${escape(notice.id)}" type="button">标记已读</button>
            </div>
          ` : ''}
        </article>
      `).join('');
    }

    watchList.querySelectorAll('[data-bind-topic]').forEach(btn => {
      btn.addEventListener('click', () => handleBind(btn.dataset.bindTopic));
    });
    watchList.querySelectorAll('[data-revoke-topic]').forEach(btn => {
      btn.addEventListener('click', () => handleRevoke(btn.dataset.revokeTopic));
    });
    watchList.querySelectorAll('[data-track-topic]').forEach(btn => {
      btn.addEventListener('click', () => handleTracking(btn.dataset.trackTopic, btn.dataset.trackAction));
    });
    noticeList.querySelectorAll('[data-read-notice]').forEach(btn => {
      btn.addEventListener('click', () => handleRead(btn.dataset.readNotice));
    });
  }

  return {
    render,
    show(visible) { section.hidden = !visible; },
  };
}

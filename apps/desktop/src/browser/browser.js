const svgNs = 'http://www.w3.org/2000/svg';
const remoteKeys = new Set(['Enter', 'Tab', 'Escape', 'ArrowUp', 'ArrowDown', 'Space']);
const textInputs = new Set(['', 'text', 'email', 'url', 'search', 'tel', 'number', 'date', 'datetime-local', 'time', 'month', 'week']);
const layout = `<div class="shell">
  <header>
    <div class="mast">
      <span class="browser-mark" aria-hidden="true">◎</span><h1>内置浏览器</h1>
      <button id="dismiss" class="quiet last" aria-label="收起内置浏览器" title="收起内置浏览器">收起</button>
    </div>
    <nav aria-label="网页导航">
      <button id="back" class="icon" title="后退（Alt + ←）" aria-label="后退" disabled>←</button>
      <button id="forward" class="icon" title="前进（Alt + →）" aria-label="前进" disabled>→</button>
      <button id="reload" class="icon" title="重新加载网页（Ctrl + R）" aria-label="重新加载网页" disabled>↻</button>
      <form id="location">
        <span class="url-mark" aria-hidden="true">◎</span>
        <input id="address" aria-label="网页地址" placeholder="输入网址" type="text" inputmode="url" autocomplete="off" autocapitalize="off" spellcheck="false" maxlength="4096">
        <button id="go" type="submit" class="go" aria-label="打开输入的网址" title="打开网址">前往</button>
      </form>
      <button id="delegate" class="primary" disabled>交给工人</button>
    </nav>
  </header>
  <div id="error" role="alert" hidden><span id="error-text"></span><button id="clear-error" class="quiet">收起</button></div>
  <main>
    <section id="canvas" aria-label="网页视口" tabindex="-1">
      <div id="empty">
        <span class="empty-symbol" aria-hidden="true">◎</span>
        <h2 id="empty-title">打开网页</h2>
        <p id="empty-message">在地址栏输入要访问的公开网址。</p>
      </div>
      <svg id="viewport" xmlns="http://www.w3.org/2000/svg" aria-label="当前网页，可通过已识别的控件操作" hidden>
        <image id="capture" x="0" y="0" preserveAspectRatio="none" aria-hidden="true"></image>
        <g id="hotspots"></g>
      </svg>
    </section>
    <aside id="controls-pane" hidden aria-label="页面控件">
      <div class="aside-head"><h2>页面控件</h2><button id="hide-controls" class="icon" aria-label="收起页面控件">×</button></div>
      <div id="controls-list"></div>
    </aside>
  </main>
  <footer>
    <span id="signal" aria-hidden="true"></span><span id="status" role="status">正在连接浏览器…</span>
    <div class="actions">
      <button id="up" class="icon" aria-label="向上滚动网页" title="向上滚动网页" disabled>↑</button>
      <button id="down" class="icon" aria-label="向下滚动网页" title="向下滚动网页" disabled>↓</button>
      <button id="zoom" class="quiet" aria-pressed="false" title="以原始尺寸显示网页，可横向滚动" disabled>原始尺寸</button>
      <button id="show-controls" class="quiet" aria-controls="controls-pane" aria-expanded="false" disabled>页面控件</button>
      <button id="sync" class="quiet" title="重新读取当前页面" disabled>同步画面</button>
      <button id="end" class="quiet" title="结束当前浏览会话" disabled>结束会话</button>
    </div>
  </footer>
  <dialog id="field-dialog" aria-labelledby="field-title">
    <form id="field-form">
      <div class="dialog-head"><h2 id="field-title">填写网页控件</h2><button type="button" data-cancel class="icon" aria-label="取消">×</button></div>
      <label id="field-label" for="field-text">输入内容</label>
      <textarea id="field-text" rows="4" maxlength="4096" placeholder="输入要写入此控件的完整文字"></textarea>
      <select id="field-select" hidden></select>
      <p class="dialog-status" id="field-status" role="status"></p>
      <div class="dialog-actions"><button type="button" data-cancel>取消</button><button id="field-enter" type="submit" hidden>写入并回车</button><button class="primary" id="field-submit">应用到网页</button></div>
    </form>
  </dialog>
  <dialog id="worker-dialog" aria-labelledby="worker-title">
    <form id="worker-form">
      <div class="dialog-head"><h2 id="worker-title">交给工人</h2><button type="button" data-cancel class="icon" aria-label="取消">×</button></div>
      <p id="worker-page" dir="auto"></p>
      <label for="goal">要在这个页面完成什么？</label>
      <textarea id="goal" rows="4" maxlength="2000" placeholder="例如，查找这个页面的报名截止日期" required></textarea>
      <p class="dialog-status" id="worker-status" role="status"></p>
      <div class="dialog-actions"><button type="button" data-cancel>取消</button><button class="primary" id="worker-submit">派给工人</button></div>
    </form>
  </dialog>
  <dialog id="end-dialog" aria-labelledby="end-title"><form id="end-form">
    <h2 id="end-title">结束当前浏览会话？</h2><p>将关闭当前网页以及工人使用的同一个浏览会话。</p>
    <div class="dialog-actions"><button type="button" data-cancel autofocus>保留会话</button><button id="end-submit" class="primary">结束会话</button></div>
  </form></dialog>
</div>`;

export function mountBrowserPane(host, bridge) {
  const root = host.attachShadow({mode: 'open'});
  // Only the bundled static layout is parsed as HTML. Page-provided text stays in text nodes.
  root.innerHTML = layout;
  const styles = document.createElement('link');
  styles.rel = 'stylesheet';
  styles.href = new URL('./browser.css', import.meta.url).href;
  root.prepend(styles);
  const $ = id => root.getElementById(id);
  let page = {connected: false, busy: false};
  let screen;
  let observedAt = 0;
  let field;
  let handoff;
  let running = false;
  let refreshing;
  let timer;
  let wheelTimer;
  let wheelDelta = 0;
  let notice = '';
  let passiveError = false;
  let editingAddress = false;
  let shown = false;
  let disposed = false;
  let release = Promise.resolve();

  function message(error) {
    const raw = typeof error?.message === 'string' ? error.message : '';
    return raw.replace(/^Error invoking remote method '[^']+':\s*(?:Error:\s*)?/, '').trim().slice(0, 280) || '浏览器没有返回结果，请同步页面后查看。';
  }
  function showError(detail) {
    $('error-text').textContent = detail;
    $('error').hidden = !detail;
  }

  function validScreen(value) {
    return typeof value?.viewId === 'string' && value.viewId.length > 0 &&
      typeof value.image === 'string' && value.image.startsWith('data:image/jpeg;base64,') &&
      Number.isFinite(value.width) && value.width > 0 && Number.isFinite(value.height) && value.height > 0;
  }
  function editable(control) {
    return control.tag === 'textarea' || (control.tag === 'input' && textInputs.has((control.inputType || '').toLowerCase())) ||
      (control.tag !== 'input' && (control.editable === true || control.role === 'textbox'));
  }
  function controlKind(control) {
    if (control.tag === 'select') return '选择框';
    if (editable(control)) return '输入框';
    if (control.role === 'link' || control.tag === 'a') return '链接';
    if (control.inputType === 'checkbox') return '复选框';
    if (control.inputType === 'radio') return '单选框';
    return '按钮';
  }
  function controlLabel(control) {
    return control.name || controlKind(control);
  }
  function selectedControl(ref) {
    return screen?.controls?.find(control => control.ref === ref && !control.disabled);
  }

  function updateChrome() {
    const connected = page.connected === true;
    const ready = connected && !!screen && !running && !page.busy;
    const blocked = ['blocked', 'disposed'].includes(page.state);
    $('go').disabled = !bridge || running || page.busy || blocked;
    $('back').disabled = !connected || !page.canGoBack || running || page.busy;
    $('forward').disabled = !connected || !page.canGoForward || running || page.busy;
    $('reload').disabled = !connected || running || page.busy;
    $('sync').disabled = !connected || running || page.busy;
    $('end').disabled = !connected || running || page.busy;
    $('delegate').disabled = !ready;
    $('show-controls').disabled = !screen;
    $('up').disabled = !ready;
    $('down').disabled = !ready;
    $('zoom').disabled = !screen;
    $('signal').dataset.tone = running || page.busy ? 'busy' : ready ? 'ready' : '';
    const fallback = blocked ? '会话已停止，请到原任务核对结果' : page.state === 'unavailable' ? '浏览器组件未就绪' :
      connected ? (page.title || '网页已打开') : '尚未打开网页';
    $('status').textContent = running ? '正在处理…' : page.busy ? '浏览器正在执行操作…' : notice || fallback;
    $('empty').hidden = !!screen;
    $('viewport').toggleAttribute('hidden', !screen);
    $('empty-title').textContent = connected ? '等候网页画面' : blocked ? '会话已停止' : '打开网页';
    $('empty-message').textContent = connected ? '可以在下方选择“同步画面”读取当前页面。' :
      blocked ? '请在工作台查看原任务的执行情况。' : '在地址栏输入要访问的公开网址。';
    if (!screen) {
      $('controls-pane').hidden = true;
      $('show-controls').setAttribute('aria-expanded', 'false');
    }
    $('canvas').setAttribute('aria-label', page.title ? '当前网页 · ' + page.title : '网页视口');
  }

  function renderControls() {
    const spots = document.createDocumentFragment();
    const list = document.createDocumentFragment();
    for (const control of screen?.controls || []) {
      const item = document.createElement('button');
      item.type = 'button';
      item.dataset.ref = control.ref;
      item.disabled = control.disabled === true;
      const kind = document.createElement('span');
      kind.className = 'role';
      kind.textContent = controlKind(control);
      item.append(kind, document.createTextNode(controlLabel(control)));
      list.append(item);
      const box = control.bounds;
      if (item.disabled || !box || ![box.x, box.y, box.width, box.height].every(Number.isFinite)) continue;
      const x = Math.max(0, box.x), y = Math.max(0, box.y);
      const w = Math.min(screen.width, box.x + box.width) - x;
      const h = Math.min(screen.height, box.y + box.height) - y;
      if (w <= 0 || h <= 0) continue;
      const hit = document.createElementNS(svgNs, 'rect');
      for (const [key, value] of Object.entries({x, y, width: w, height: h}))
        hit.setAttribute(key, String(value));
      hit.dataset.ref = control.ref;
      hit.setAttribute('tabindex', '0');
      hit.setAttribute('role', 'button');
      hit.setAttribute('aria-label', controlKind(control) + ' · ' + controlLabel(control));
      const title = document.createElementNS(svgNs, 'title');
      title.textContent = controlLabel(control);
      hit.append(title);
      spots.append(hit);
    }
    if (!list.childNodes.length) {
      const empty = document.createElement('p');
      empty.textContent = '当前页面没有可操作的控件。';
      list.append(empty);
    }
    $('hotspots').replaceChildren(spots);
    $('controls-list').replaceChildren(list);
  }
  function apply(value, passive = false) {
    if (!value || typeof value.connected !== 'boolean') throw Error('浏览器返回了无效的页面状态。');
    const prior = screen;
    const oldUrl = page.url;
    page = value;
    if (!page.connected || oldUrl !== page.url || page.viewId !== screen?.viewId) screen = undefined;
    if (validScreen(value)) { screen = value; observedAt = Date.now(); }
    if (prior?.image !== screen?.image) {
      if (screen) {
        $('capture').setAttribute('href', screen.image);
        $('capture').setAttribute('width', String(screen.width));
        $('capture').setAttribute('height', String(screen.height));
        $('viewport').setAttribute('viewBox', '0 0 ' + screen.width + ' ' + screen.height);
        $('viewport').setAttribute('width', String(screen.width));
        $('viewport').setAttribute('height', String(screen.height));
      } else $('capture').removeAttribute('href');
    }
    if (prior?.viewId !== screen?.viewId || (!prior && screen)) renderControls();
    if (!passive || (!editingAddress && oldUrl !== page.url)) {
      $('address').value = page.url || '';
      editingAddress = false;
    }
    if (oldUrl !== page.url) {
      $('canvas').scrollTop = 0;
      if (passive) notice = '';
    }
    updateChrome();
  }
  function openDialog() {
    return root.querySelector('dialog[open]');
  }
  async function sync(passive = false, force = false) {
    if (!shown || document.hidden || disposed || running || refreshing || (passive && openDialog())) return;
    refreshing = (async () => {
      const summary = await bridge.call('state', {});
      if (running || !shown || document.hidden || disposed) return;
      apply(summary, true);
      if (summary.connected && summary.url && !summary.busy && (force || (!screen && !passiveError))) {
        const value = await bridge.call('preview', {});
        if (running || !shown || document.hidden || disposed) return;
        apply(value, true);
      }
      if (force || screen) {
        if (passiveError) showError('');
        passiveError = false;
      }
    })();
    try { await refreshing; }
    catch (error) {
      if (!running && shown && !document.hidden && !disposed) {
        showError(message(error));
        passiveError = true;
      }
    } finally { refreshing = undefined; }
  }
  function scheduleSync(delay = 160) {
    clearTimeout(timer);
    timer = setTimeout(() => { void sync(true); }, delay);
  }

  async function perform(action, payload = {}, options = {}) {
    if (disposed || !shown || document.hidden || running) return false;
    running = true;
    notice = '';
    showError('');
    updateChrome();
    try {
      if (refreshing) await refreshing.catch(() => {});
      if (disposed || !shown || document.hidden) return false;
      if (payload.viewId && Date.now() - observedAt > 20_000) {
        const current = await bridge.call('preview', {});
        if (disposed || !shown || document.hidden) return false;
        apply(current, true);
        if (screen?.viewId !== payload.viewId) throw Error('网页内容已变化，请关闭当前操作并在新画面上重新选择。');
      }
      const value = await bridge.call(action, payload);
      if (disposed) return false;
      if (action !== 'delegate' && shown && !document.hidden) apply(value);
      if (action === 'delegate') {
        if (!value?.taskId && value?.accepted !== true) throw Error('尚未取得派工回执，请在工作台查看任务。');
        notice = value.bound === false ? '任务已受理；页面已变化，请在工作台查看任务。' : '已派给工人，可在工作台查看进度';
      }
      passiveError = false;
      return true;
    } catch (error) {
      const detail = message(error);
      showError(detail);
      if (options.errorTarget) options.errorTarget.textContent = detail;
      return false;
    } finally {
      running = false;
      if (!disposed) updateChrome();
    }
  }
  function navigate() {
    let raw = $('address').value.trim();
    try {
      if (!raw) throw Error('请输入网址。');
      if (!/^[a-z][a-z\d+.-]*:\/\//i.test(raw)) {
        if (/^[a-z][a-z\d+.-]*:/i.test(raw) && !/^[^/\s:]+:\d+(?:[/?#]|$)/.test(raw)) throw Error('请输入 HTTP 或 HTTPS 网址。');
        raw = 'https://' + raw;
      }
      const url = new URL(raw);
      if (!['http:', 'https:'].includes(url.protocol) || !url.hostname || url.username || url.password)
        throw Error('请输入不含登录信息的公开 HTTP 或 HTTPS 网址。');
      void perform('open', {url: url.href});
    } catch (error) { showError(message(error)); }
  }
  function showField(control) {
    field = {viewId: screen.viewId, ref: control.ref, kind: control.tag === 'select' ? 'select' : 'type'};
    const select = field.kind === 'select';
    $('field-title').textContent = select ? '更改选项' : '替换控件中的文字';
    $('field-label').textContent = controlLabel(control);
    $('field-label').htmlFor = select ? 'field-select' : 'field-text';
    $('field-select').hidden = !select;
    $('field-text').hidden = select;
    $('field-enter').hidden = select;
    $('field-text').value = typeof control.value === 'string' ? control.value : '';
    $('field-select').multiple = control.multiple === true;
    const choices = (control.options || []).map(option => {
      const item = new Option(option.label || option.value, option.value);
      item.selected = option.selected === true;
      item.disabled = option.disabled === true;
      return item;
    });
    $('field-select').replaceChildren(...choices);
    $('field-status').textContent = '';
    $('field-submit').disabled = select && choices.length === 0;
    $('field-dialog').showModal();
    (select ? $('field-select') : $('field-text')).focus();
  }
  function useControl(ref) {
    const control = selectedControl(ref);
    if (!control || running || page.busy || openDialog()) return;
    if (editable(control) || control.tag === 'select') showField(control);
    else void perform('click', {viewId: screen.viewId, ref});
  }
  function scrollRemote(direction, amount = 540) {
    if (!screen || running || page.busy) return;
    return perform('scroll', {viewId: screen.viewId, direction, amount});
  }

  $('location').addEventListener('submit', event => { event.preventDefault(); navigate(); });
  $('address').addEventListener('input', () => { editingAddress = true; });
  $('address').addEventListener('keydown', event => {
    if (event.key === 'Escape' && editingAddress) {
      event.preventDefault(); event.stopPropagation();
      $('address').value = page.url || ''; editingAddress = false;
    }
  });
  $('clear-error').addEventListener('click', () => showError(''));
  for (const action of ['back', 'forward', 'reload']) $(action).addEventListener('click', () => { void perform(action); });
  $('sync').addEventListener('click', () => { void sync(false, true); });
  $('dismiss').addEventListener('click', () => bridge.dismiss());
  $('up').addEventListener('click', () => { void scrollRemote('up'); });
  $('down').addEventListener('click', () => { void scrollRemote('down'); });
  $('zoom').addEventListener('click', () => {
    const natural = $('canvas').classList.toggle('natural');
    $('zoom').setAttribute('aria-pressed', String(natural));
    $('zoom').textContent = natural ? '适应宽度' : '原始尺寸';
  });
  $('end').addEventListener('click', () => $('end-dialog').showModal());
  $('end-form').addEventListener('submit', async event => {
    event.preventDefault();
    $('end-submit').disabled = true;
    await perform('close');
    $('end-dialog').close();
    $('end-submit').disabled = false;
  });
  $('show-controls').addEventListener('click', () => {
    $('controls-pane').hidden = !$('controls-pane').hidden;
    $('show-controls').setAttribute('aria-expanded', String(!$('controls-pane').hidden));
  });
  $('hide-controls').addEventListener('click', () => {
    $('controls-pane').hidden = true;
    $('show-controls').setAttribute('aria-expanded', 'false');
    $('show-controls').focus();
  });
  for (const id of ['hotspots', 'controls-list']) {
    $(id).addEventListener('click', event => {
      const hit = event.target.closest('[data-ref]');
      if (hit) useControl(hit.dataset.ref);
    });
  }
  $('viewport').addEventListener('click', event => {
    if (event.target.closest('[data-ref]') || !screen) return;
    notice = '此处没有可操作的控件。可查看“页面控件”或同步画面。';
    updateChrome();
  });
  $('hotspots').addEventListener('keydown', async event => {
    const ref = event.target.dataset.ref;
    const key = event.key === ' ' ? 'Space' : event.key;
    if (!ref || !remoteKeys.has(key) || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
    const control = selectedControl(ref);
    if (!control) return;
    event.preventDefault();
    if (running || page.busy || !screen) return;
    if ((key === 'Space' || key === 'Enter') && (editable(control) || control.tag === 'select')) {
      useControl(ref);
      return;
    }
    if (await perform('press', {viewId: screen.viewId, ref, key}) && key === 'Tab') {
      const focused = screen?.controls?.find(item => item.focused);
      const spots = [...$('hotspots').children];
      const next = spots.find(spot => spot.dataset.ref === focused?.ref);
      // When the remote page wraps, keyboard users can reach the sidebar toolbar.
      if (next && next !== spots[0]) next.focus(); else $('show-controls').focus();
    }
  });
  $('canvas').addEventListener('wheel', event => {
    const box = $('canvas');
    if (!screen || event.ctrlKey || event.shiftKey || !event.deltaY) return;
    if ((event.deltaY > 0 && box.scrollTop + box.clientHeight < box.scrollHeight - 1) || (event.deltaY < 0 && box.scrollTop > 0)) return;
    event.preventDefault();
    if (running || page.busy) return;
    const multiplier = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? 540 : 1;
    wheelDelta += event.deltaY * multiplier;
    clearTimeout(wheelTimer);
    wheelTimer = setTimeout(() => {
      const delta = wheelDelta;
      wheelDelta = 0;
      if (delta) void scrollRemote(delta > 0 ? 'down' : 'up', Math.max(1, Math.min(2000, Math.round(Math.abs(delta)))));
    }, 80);
  }, {passive: false});
  $('field-form').addEventListener('submit', async event => {
    event.preventDefault();
    if (!field || running) return;
    const {viewId, ref, kind} = field;
    $('field-submit').disabled = true;
    const payload = kind === 'select' ? {values: [...$('field-select').selectedOptions].map(option => option.value)} :
      {text: $('field-text').value, ...(event.submitter === $('field-enter') ? {submit:true} : {})};
    if (await perform(kind, {viewId, ref, ...payload}, {errorTarget: $('field-status')})) $('field-dialog').close();
    $('field-submit').disabled = false;
  });
  $('delegate').addEventListener('click', () => {
    if (!screen || !page.url) return;
    handoff = {url: page.url, viewId: screen.viewId};
    $('worker-page').textContent = handoff.url;
    $('worker-status').textContent = '';
    $('worker-dialog').showModal();
    $('goal').focus();
  });
  $('worker-form').addEventListener('submit', async event => {
    event.preventDefault();
    const goal = $('goal').value.trim();
    if (!goal || !handoff || running) return;
    $('worker-submit').disabled = true;
    if (await perform('delegate', {goal, ...handoff}, {errorTarget: $('worker-status')})) {
      $('worker-dialog').close();
      $('goal').value = '';
      scheduleSync();
    }
    $('worker-submit').disabled = false;
  });
  for (const button of root.querySelectorAll('[data-cancel]'))
    button.addEventListener('click', () => { if (!running) button.closest('dialog').close(); });
  for (const dialog of root.querySelectorAll('dialog'))
    dialog.addEventListener('cancel', event => { if (running) event.preventDefault(); });
  root.addEventListener('keydown', event => {
    if (openDialog()) { if (event.key === 'Escape') event.stopPropagation(); return; }
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); bridge.dismiss(); return; }
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'l') {
      event.preventDefault(); $('address').focus(); $('address').select();
    } else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'r') {
      event.preventDefault(); if (!$('reload').disabled) void perform('reload');
    } else if (event.altKey && ['ArrowLeft', 'ArrowRight'].includes(event.key)) {
      event.preventDefault();
      const action = event.key === 'ArrowLeft' ? 'back' : 'forward';
      if (!$(action).disabled) void perform(action);
    }
  });

  const offState = bridge.onState?.(() => { if (shown && !refreshing && !running) scheduleSync(); });
  let poll;
  function suspend() {
    clearTimeout(timer); clearTimeout(wheelTimer); clearInterval(poll); wheelDelta = 0;
    for (const dialog of root.querySelectorAll('dialog[open]')) dialog.close();
    screen = undefined;
    $('capture').removeAttribute('href');
    renderControls();
    updateChrome();
    release = bridge.call('release', {}).catch(() => {});
  }
  async function resume() {
    await release;
    if (refreshing) await refreshing.catch(() => {});
    if (!shown || document.hidden || disposed) return;
    clearInterval(poll);
    poll = setInterval(() => { if (page.connected && !passiveError) void sync(true, true); }, 3500);
    await sync(false, true);
  }
  function onVisibility() {
    if (!shown || disposed) return;
    if (document.hidden) suspend(); else void resume();
  }
  document.addEventListener('visibilitychange', onVisibility);
  return {
    onShow() {
      if (disposed) return;
      shown = true;
      void resume();
      $('address').focus();
    },
    onHide() {
      if (!shown) return;
      shown = false;
      suspend();
    },
    dispose() {
      this.onHide();
      disposed = true;
      document.removeEventListener('visibilitychange', onVisibility);
      offState?.();
      root.replaceChildren();
    }
  };
}

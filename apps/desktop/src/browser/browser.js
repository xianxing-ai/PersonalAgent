import {createBrowserMediaPlayer} from './media-player.js';
const svgNs = 'http://www.w3.org/2000/svg';
const remoteKeys = new Set(['Enter', 'Tab', 'Escape', 'ArrowUp', 'ArrowDown', 'Space']);
const textInputs = new Set(['', 'text', 'email', 'url', 'search', 'tel', 'number', 'date', 'datetime-local', 'time', 'month', 'week']);
const layout = `<div class="shell">
  <header>
    <div class="mast">
      <h1>内置浏览器</h1>
      <button id="dismiss" class="quiet last" aria-label="收起内置浏览器" title="收起内置浏览器">收起</button>
    </div>
    <nav aria-label="网页导航">
      <button id="back" class="icon" title="后退（Alt + ←）" aria-label="后退" disabled>←</button>
      <button id="forward" class="icon" title="前进（Alt + →）" aria-label="前进" disabled>→</button>
      <button id="reload" class="icon" title="重新加载网页（Ctrl + R）" aria-label="重新加载网页" disabled>↻</button>
      <form id="location">
        <input id="address" aria-label="网页地址" type="text" inputmode="url" autocomplete="off" autocapitalize="off" spellcheck="false" maxlength="4096">
        <button id="go" type="submit" class="go" aria-label="打开输入的网址" title="打开网址">前往</button>
      </form>
      <span id="error" hidden><span id="error-text" role="status"></span><button id="retry" type="button" class="quiet" aria-label="重试加载">重试</button></span>
    </nav>
    <div id="media-bar" hidden>
      <button id="media-toggle" type="button">播放</button>
      <span id="media-status" role="status"></span>
      <button id="sound" type="button" aria-label="打开声音" aria-pressed="false" disabled>打开声音</button>
    </div>
  </header>
  <main>
    <section id="canvas" aria-label="网页视口" tabindex="-1">
      <div id="media-dock" hidden><video id="player" autoplay muted playsinline disablepictureinpicture aria-label="当前网页的实时媒体"></video></div>
      <svg id="viewport" xmlns="http://www.w3.org/2000/svg" aria-label="当前网页，可通过已识别的控件操作" hidden>
        <image id="capture" x="0" y="0" preserveAspectRatio="none" aria-hidden="true"></image>
        <foreignObject id="media-target" aria-hidden="true" hidden></foreignObject>
        <g id="hotspots"></g>
        <g id="pointer" aria-hidden="true" hidden><circle class="pointer-ring" r="12"></circle><path d="M0 0 3 21 8 15 13 23 17 20 12 13 20 12Z"></path></g>
      </svg>
    </section>
    <aside id="controls-pane" hidden aria-label="页面控件">
      <div class="aside-head"><h2>页面控件</h2><button id="hide-controls" class="icon" aria-label="收起页面控件">×</button></div>
      <div id="controls-list"></div>
    </aside>
  </main>
  <footer id="page-tools" hidden>
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
  let running = false;
  let refreshing;
  let timer;
  let wheelTimer;
  let wheelDelta = 0;
  let retryAction;
  let passiveError = false;
  let editingAddress = false;
  let shown = false;
  let disposed = false;
  let pointerTimer, pointerStamp = 0, ignorePointerBefore = 0;
  let mediaState = 'idle', mediaDetail = '';
  let poll;
  let release = Promise.resolve();
  const inForeground = () => shown && !disposed && !document.hidden && document.hasFocus();
  const player = $('player');
  const media = createBrowserMediaPlayer(player, {
    read: payload => bridge.call('media', payload),
    changed(state, detail) { mediaState = state; mediaDetail = detail; renderMedia(); }
  });

  function showError(label = '', retry) {
    retryAction = retry;
    $('error-text').textContent = label;
    $('error').hidden = !label;
    $('retry').hidden = !retry;
    $('address').setAttribute('aria-invalid', String(label === '网址无效'));
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
    if (control.tag === 'video') return '视频';
    if (control.tag === 'audio') return '音频';
    if (control.tag === 'select') return '选择框';
    if (editable(control)) return '输入框';
    if (control.role === 'link' || control.tag === 'a') return '链接';
    if (control.inputType === 'checkbox') return '复选框';
    if (control.inputType === 'radio') return '单选框';
    return '按钮';
  }
  function controlLabel(control) {
    if (['video', 'audio'].includes(control.tag)) {
      const action = control.mediaPlaying ? '暂停' : control.ended ? '重新播放' : control.paused ? '播放' : '在侧栏播放';
      return action + (control.name ? ' · ' + control.name : controlKind(control));
    }
    return control.name || controlKind(control);
  }
  function selectedControl(ref) {
    return screen?.controls?.find(control => control.ref === ref && !control.disabled);
  }
  function mediaControl() {
    const items = (screen?.controls || []).filter(control => !control.disabled && ['video', 'audio'].includes(control.tag));
    if (page.mediaPlaying) return items.find(control => control.mediaPlaying);
    return items.length === 1 ? items[0] : undefined;
  }
  function renderMedia() {
    const current = mediaControl(), playing = page.mediaPlaying === true;
    const active = mediaState === 'playing', localGesture = mediaState === 'gesture';
    const decoding = active || mediaState === 'buffering' || localGesture;
    const alreadyPlaying = current?.paused === false && !current.ended && !playing;
    $('media-bar').hidden = !screen || (!current && !playing);
    $('media-toggle').disabled = (!current && !localGesture) || running || page.busy;
    $('media-toggle').textContent = localGesture || alreadyPlaying ? '在侧栏播放' : playing ? '暂停' : '播放';
    $('media-status').textContent = mediaDetail || (active ? '实时播放' : current?.ended ? '播放结束' : playing ? '正在读取媒体…' : alreadyPlaying ? '网页正在播放' : '已暂停');
    $('sound').disabled = !active;
    $('sound').textContent = player.muted ? '打开声音' : '静音';
    $('sound').setAttribute('aria-label', $('sound').textContent);
    $('sound').setAttribute('aria-pressed', String(!player.muted));
    const bounds = current?.mediaPlaying && current.tag === 'video' ? current.bounds : undefined;
    const embedded = bounds && [bounds.x,bounds.y,bounds.width,bounds.height].every(Number.isFinite) && bounds.width > 0 && bounds.height > 0;
    const target = embedded ? $('media-target') : $('media-dock');
    if (player.parentNode !== target) {
      // moveBefore preserves player state where Chromium supports atomic DOM moves.
      if (target.moveBefore) target.moveBefore(player, null);
      else { target.append(player); if (active) void player.play().catch(() => {}); }
    }
    if (embedded) for (const key of ['x','y','width','height']) target.setAttribute(key, String(bounds[key]));
    $('media-target').toggleAttribute('hidden', !embedded || !decoding);
    $('media-dock').hidden = embedded || !decoding || current?.tag === 'audio';
  }
  function clearPointer() {
    clearTimeout(pointerTimer);
    pointerStamp = 0;
    $('pointer').setAttribute('hidden', '');
  }
  function renderPointer(marker) {
    if (!marker || !screen || !inForeground()) { clearPointer(); return; }
    const {x,y,at,action,width,height} = marker;
    const remaining = 2200 - (Date.now() - at);
    if (![x,y,at,width,height].every(Number.isFinite) || width <= 0 || height <= 0 || x < 0 || y < 0 || x > width || y > height ||
        !['prepare','click','type','select'].includes(action) || at < ignorePointerBefore || remaining <= 0) { clearPointer(); return; }
    if (pointerStamp === at) return;
    clearTimeout(pointerTimer);
    pointerStamp = at;
    const node = $('pointer');
    const scale = Math.max(1, screen.width / Math.max(1, $('viewport').getBoundingClientRect().width));
    node.setAttribute('transform', 'translate(' + (x * screen.width / width) + ' ' + (y * screen.height / height) + ') scale(' + scale + ')');
    node.toggleAttribute('hidden', false);
    node.dataset.action = action;
    const ring = node.querySelector('circle');
    if (action === 'click') ring.animate([{opacity:1,transform:'scale(.5)'},{opacity:0,transform:'scale(1.7)'}], {duration:650});
    pointerTimer = setTimeout(clearPointer, Math.min(2200, remaining));
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
    $('show-controls').disabled = !screen;
    $('up').disabled = !ready;
    $('down').disabled = !ready;
    $('zoom').disabled = !screen;
    $('page-tools').hidden = !connected;
    $('canvas').setAttribute('aria-busy', String(running || page.busy === true));
    $('viewport').toggleAttribute('hidden', !screen);
    if (!screen) {
      $('controls-pane').hidden = true;
      $('show-controls').setAttribute('aria-expanded', 'false');
    }
    $('canvas').setAttribute('aria-label', page.title ? '当前网页 · ' + page.title : '网页视口');
    renderMedia();
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
    if (oldUrl !== page.url && oldUrl) {
      clearPointer(); ignorePointerBefore = Date.now();
      media.stop();
      player.muted = true;
    }
    if (!page.connected || oldUrl !== page.url || (!page.busy && page.viewId !== screen?.viewId)) screen = undefined;
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
    if (oldUrl !== page.url) $('canvas').scrollTop = 0;
    updateChrome();
    renderPointer(page.pointer);
    if (page.mediaPlaying && page.connected && inForeground()) media.start();
    else media.stop();
  }
  function openDialog() {
    return root.querySelector('dialog[open]');
  }
  async function sync(passive = false, force = false) {
    if (!inForeground() || running || refreshing || (passive && openDialog())) return;
    refreshing = (async () => {
      const summary = await bridge.call('state', {});
      if (running || !inForeground()) return;
      apply(summary, true);
      if (summary.connected && summary.url && !summary.busy && (force || (!screen && !passiveError))) {
        // Pixels may change while the actionable controls are identical. Renew the complete
        // observation periodically so new controls also become keyboard/click targets.
        if (passive && screen && screen.viewId === summary.viewId && Date.now() - observedAt < 4500) {
          const frame = await bridge.call('frame', {});
          if (running || !inForeground()) return;
          if (frame?.state === 'waiting') return;
          if (frame?.state === 'frame' && validScreen(frame) && frame.viewId === screen.viewId &&
              frame.url === page.url && frame.width === screen.width && frame.height === screen.height) {
            $('capture').setAttribute('href', frame.image);
            screen.image = frame.image;
            renderPointer(frame.pointer);
            if (passiveError) showError('');
            passiveError = false;
            return;
          }
        }
        const value = await bridge.call('preview', {});
        if (running || !inForeground()) return;
        apply(value, true);
      }
      if (force || screen) {
        if (passiveError) showError('');
        passiveError = false;
      }
    })();
    try { await refreshing; }
    catch {
      if (!running && inForeground()) {
        showError('加载失败', retryRead);
        passiveError = true;
      }
    } finally { refreshing = undefined; }
  }
  function scheduleSync(delay = 160) {
    if (!inForeground() || timer !== undefined) return;
    timer = setTimeout(() => { timer = undefined; void sync(true); }, delay);
  }
  async function retryRead() {
    if (refreshing) await refreshing.catch(() => {});
    await sync(false, true);
  }

  async function perform(action, payload = {}, options = {}) {
    if (disposed || !shown || document.hidden || running) return false;
    running = true;
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
      if (shown && !document.hidden) apply(value);
      passiveError = false;
      return true;
    } catch {
      if (disposed) return false;
      if (options.errorTarget) options.errorTarget.textContent = '更改未确认';
      else if (action === 'open') showError('加载失败', navigate);
      else if (['reload','back','forward'].includes(action)) showError('加载失败', retryRead);
      else showError('操作未确认', retryRead);
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
    } catch { showError('网址无效'); $('address').focus(); }
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
    else {
      const media = ['video','audio'].includes(control.tag);
      void perform('click', {viewId: screen.viewId, ref, ...(media ? {mediaAction: control.mediaPlaying ? 'pause' : 'play'} : {})});
    }
  }
  function scrollRemote(direction, amount = 540) {
    if (!screen || running || page.busy) return;
    return perform('scroll', {viewId: screen.viewId, direction, amount});
  }

  $('location').addEventListener('submit', event => { event.preventDefault(); navigate(); });
  $('address').addEventListener('input', () => { editingAddress = true; showError(); });
  $('address').addEventListener('keydown', event => {
    if (event.key === 'Escape' && editingAddress) {
      event.preventDefault(); event.stopPropagation();
      $('address').value = page.url || ''; editingAddress = false;
    }
  });
  $('retry').addEventListener('click', () => { const retry = retryAction; showError(); void retry?.(); });
  for (const action of ['back', 'forward', 'reload']) $(action).addEventListener('click', () => { void perform(action); });
  $('sync').addEventListener('click', () => { if (mediaState === 'unavailable') media.stop(); void sync(false, true); });
  $('media-toggle').addEventListener('click', () => {
    if (mediaState === 'gesture') { void player.play().catch(() => showError('播放失败')); return; }
    const control = mediaControl();
    if (control) useControl(control.ref);
  });
  $('sound').addEventListener('click', () => {
    player.muted = !player.muted;
    if (!player.muted) void player.play().catch(() => { player.muted = true; renderMedia(); showError('播放失败'); });
    renderMedia();
  });
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
  $('hotspots').addEventListener('keydown', async event => {
    const ref = event.target.dataset.ref;
    const key = event.key === ' ' ? 'Space' : event.key;
    if (!ref || !remoteKeys.has(key) || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
    const control = selectedControl(ref);
    if (!control) return;
    event.preventDefault();
    if (running || page.busy || !screen) return;
    if ((key === 'Space' || key === 'Enter') && (editable(control) || ['select','video','audio'].includes(control.tag))) {
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

  const offState = bridge.onState?.(() => { if (shown && !refreshing && !running) scheduleSync(30); });
  function pausePolling() {
    clearTimeout(timer); clearTimeout(wheelTimer); clearInterval(poll); wheelDelta = 0;
    timer = poll = undefined;
    clearPointer(); ignorePointerBefore = Date.now();
    media.stop();
  }
  function updatePolling() {
    if (!inForeground()) { pausePolling(); return; }
    if (poll !== undefined) return;
    let lastRefresh = 0;
    poll = setInterval(() => {
      if (!page.connected || running || refreshing || openDialog()) return;
      const interval = passiveError ? 5000 : page.mediaPlaying ? 3500 : 1200;
      if (Date.now() - lastRefresh < interval) return;
      lastRefresh = Date.now();
      void sync(true, true);
    }, 1200);
  }
  function releasePane() {
    pausePolling();
    showError();
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
    if (!inForeground()) return;
    updatePolling();
    await sync(false, true);
  }
  function onVisibility() {
    if (!shown || disposed) return;
    if (!inForeground()) pausePolling(); else void resume();
  }
  document.addEventListener('visibilitychange', onVisibility);
  window.addEventListener('blur', pausePolling);
  window.addEventListener('focus', onVisibility);
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
      releasePane();
    },
    dispose() {
      this.onHide();
      disposed = true;
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('blur', pausePolling);
      window.removeEventListener('focus', onVisibility);
      offState?.();
      host.remove();
    }
  };
}

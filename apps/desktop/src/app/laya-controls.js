export function mountLayaControls(root, invoke) {
  const element = document.createElement('section');
  element.className = 'sheet';
  element.innerHTML = '<h2>本地 Laya</h2><p>用于邮件分类和候选判断。手动启动后在本机处理，关闭即释放模型。</p><button class="btn" data-laya="start">启动本地模型</button> <button class="btn" data-laya="stop">停止并释放</button><p data-laya="status" role="status"></p>';
  root.querySelector('#error').before(element);
  let state = {}, pendingAction, operation = 0, publication = 0, unconfirmed = false, receiptLost = false, feedback = '';
  const startable = new Set(['stopped', 'unavailable', 'memory_insufficient', 'error']);
  const stoppable = new Set(['ready', 'starting', 'identity_changed', 'stop_unconfirmed']);
  const known = new Set([...startable, ...stoppable, 'stopping']);
  const field = name => element.querySelector(`[data-laya="${name}"]`);
  function paint() {
    field('status').textContent = feedback || (receiptLost
      ? '操作回执未获确认；当前已读回状态：'+(state.reason || state.state)
      : state.reason || '本地模型尚未装配');
    field('start').disabled = Boolean(pendingAction) || unconfirmed || !startable.has(state.state);
    field('stop').disabled = pendingAction === 'stop'
      || !(pendingAction === 'start' || unconfirmed || stoppable.has(state.state));
  }
  function render(value = {}) {
    publication++;
    state = value;
    paint();
  }
  async function run(action) {
    if (field(action).disabled) return;
    const current = ++operation;
    pendingAction = action; receiptLost = false; feedback = ''; paint();
    let confirmed = true;
    try {
      try { await invoke(`laya.${action}`); } catch { confirmed = false; }
      if (current !== operation) return;
      // A publication or a later stop can precede this operation's reply.
      // Read the existing host snapshot instead of applying the reply's old state.
      const observed = publication;
      const readback = await invoke('snapshot');
      if (current !== operation) return;
      const latest = publication === observed ? readback?.laya : state;
      if (!latest || !known.has(latest.state)) throw Error();
      state = latest; unconfirmed = false; receiptLost = !confirmed; feedback = '';
    } catch {
      if (current === operation) {
        unconfirmed = true;
        feedback = '本地模型当前状态未获确认，请停止并复核后再启动';
      }
    } finally {
      if (current === operation) {pendingAction = undefined; paint();}
    }
  }
  field('start').onclick = () => run('start'); field('stop').onclick = () => run('stop');
  paint();
  return {render, show:visible => {element.hidden = !visible;}};
}

import {assistantCardHtml} from './answer-block.js';

/** One create control beside the existing assistant cards. Built-in cards stay a single open button. */
export function mountAssistantRoster(container, {invoke, escape, onOpen, report}) {
  container.classList?.add?.('assistant-roster');
  container.innerHTML = `<button type="button" class="assistant-create" data-assistant-create>新建助手</button>
<form class="assistant-create-form" data-assistant-create-form hidden>
<label>名字<input name="displayName" maxlength="40" required autocomplete="off"></label>
<label>说明<input name="instructions" maxlength="500" required autocomplete="off"></label>
<label>模型（可选）<input name="modelId" maxlength="128" autocomplete="off" placeholder="留空则使用当前模型"></label>
<div><button type="submit">保存</button><button type="button" data-assistant-create-cancel>取消</button></div>
<p class="assistant-form-status" data-assistant-form-status role="status"></p>
</form><div class="assistant-cards" aria-label="子助手"></div>`;
  const form = () => container.querySelector('[data-assistant-create-form]');
  const status = () => container.querySelector('[data-assistant-form-status]');
  const field = (node, name) => (node?.elements?.namedItem?.(name)?.value ?? node?.[name]?.value ?? '').trim();
  container.addEventListener('click', event => {
    const button = event.target.closest?.('button');
    if (!button || (container.contains && !container.contains(button))) return;
    if (button.dataset.assistantCreate !== undefined) { const node = form(); if (node) node.hidden = false; return; }
    if (button.dataset.assistantCreateCancel !== undefined) {
      const node = form(); if (node) node.hidden = true;
      const note = status(); if (note) note.textContent = '';
    }
  });
  container.addEventListener('submit', async event => {
    const node = event.target;
    if (node?.dataset?.assistantCreateForm === undefined && !node?.matches?.('[data-assistant-create-form]')) return;
    event.preventDefault();
    const displayName = field(node, 'displayName');
    const instructions = field(node, 'instructions');
    const modelId = field(node, 'modelId');
    try {
      const created = await invoke('assistant.create', {displayName, instructions, ...(modelId ? {modelId} : {})});
      node.reset?.();
      node.hidden = true;
      const note = status(); if (note) note.textContent = '';
      if (created?.assistantId) onOpen?.(created.assistantId);
    } catch (error) { report?.(error); }
  });
  const cards = container.querySelector('.assistant-cards');
  cards?.addEventListener?.('click', event => {
    const id = event.target.closest?.('[data-assistant-id]')?.dataset.assistantId;
    if (id) onOpen?.(id);
  });
  return {paint(assistants) {
    const node = container.querySelector('.assistant-cards');
    if (node) node.innerHTML = (assistants ?? []).map(item => assistantCardHtml(item, escape)).join('');
  }};
}

export function assistantThreadActionsHtml(assistant) {
  if (assistant?.origin !== 'user') return '';
  return `<span class="assistant-manage"><button type="button" data-assistant-rename>改名</button><button type="button" data-assistant-delete>删除</button></span>`;
}

/** Rename stays inline. Delete asks once in the thread before the host removes the assistant. */
export function bindAssistantThreadActions(root, assistant, {invoke, escape, report, onChanged, onDeleted}) {
  if (assistant?.origin !== 'user') return;
  const rename = root.querySelector('[data-assistant-rename]');
  const remove = root.querySelector('[data-assistant-delete]');
  if (rename) rename.onclick = () => {
    if (root.querySelector('[data-assistant-rename-form]')) return;
    const form = document.createElement('form');
    form.dataset.assistantRenameForm = 'true';
    form.innerHTML = `<label>名字<input name="displayName" maxlength="40" required value="${escape(assistant.displayName)}"></label><label>说明<input name="instructions" maxlength="500" required value="${escape(assistant.instructions)}"></label><button type="submit">保存</button><button type="button" data-assistant-rename-cancel>取消</button>`;
    rename.insertAdjacentElement?.('afterend', form) ?? rename.after?.(form);
    form.querySelector('[data-assistant-rename-cancel]').onclick = () => form.remove();
    form.onsubmit = async event => {
      event.preventDefault();
      const displayName = (form.displayName?.value ?? form.querySelector('[name="displayName"]')?.value ?? '').trim();
      const instructions = (form.instructions?.value ?? form.querySelector('[name="instructions"]')?.value ?? '').trim();
      try { await invoke('assistant.rename', {assistantId: assistant.assistantId, displayName, instructions}); onChanged?.(); }
      catch (error) { report?.(error); }
    };
  };
  if (remove) remove.onclick = () => {
    if (root.querySelector('[data-assistant-delete-confirm]')) return;
    const ask = document.createElement('p');
    ask.dataset.assistantDeleteAsk = 'true';
    ask.innerHTML = `确认删除「${escape(assistant.displayName)}」？已有任务记录会保留。<button type="button" data-assistant-delete-confirm>确认删除</button><button type="button" data-assistant-delete-cancel>取消</button>`;
    remove.insertAdjacentElement?.('afterend', ask) ?? remove.after?.(ask);
    ask.querySelector('[data-assistant-delete-cancel]').onclick = () => ask.remove();
    ask.querySelector('[data-assistant-delete-confirm]').onclick = async () => {
      try { await invoke('assistant.delete', {assistantId: assistant.assistantId}); onDeleted?.(); }
      catch (error) { report?.(error); }
    };
  };
}

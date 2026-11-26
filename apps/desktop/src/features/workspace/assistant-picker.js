import {assistantVisualSpec} from '../conversation/answer-block.js';

export function updateAssistantPicker(select, assistants) {
  const previous = select.value;
  let selectedContentChanged = false;
  const available = new Map(Array.from(select.options, option => [option.value, option]));
  const choices = assistants.length ? assistants : [{assistantId:'', displayName:'暂无助手'}];
  for (const [index, assistant] of choices.entries()) {
    const id = assistant.assistantId;
    const label = assistant.displayName || id;
    const visual = id ? assistantVisualSpec(assistant) : null;
    const option = available.get(id) ?? document.createElement('option');
    available.delete(id);
    if (option.textContent !== label || option.firstElementChild?.dataset.tone !== visual?.tone) {
      if (option.selected) selectedContentChanged = true;
      option.value = id;
      const name = document.createElement('span');
      name.className = 'assistant-choice-name';
      name.textContent = label;
      if (visual) {
        const icon = document.createElement('span');
        icon.className = 'assistant-card-icon';
        icon.dataset.tone = visual.tone;
        icon.setAttribute('aria-hidden', 'true');
        icon.innerHTML = visual.svg;
        option.replaceChildren(icon, name);
      } else {
        option.replaceChildren(name);
      }
    }
    if (select.options[index] !== option) select.insertBefore(option, select.options[index] ?? null);
  }
  for (const stale of available.values()) stale.remove();
  // Chromium reclones <selectedcontent> on selection, including when a selected assistant is renamed.
  if ((previous !== select.value || selectedContentChanged) && choices.some(item => item.assistantId === previous)) {
    select.value = previous;
  }
}

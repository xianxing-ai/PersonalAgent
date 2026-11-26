export function createStarterDraft(input) {
  let inserted;
  const reset = () => { inserted = undefined; };
  input.addEventListener('input', reset);

  function select(text) {
    if (input.readOnly || input.disabled) return;
    const draft = input.value;
    const prefix = inserted?.value === draft
      ? draft.slice(0, inserted.start)
      : draft + (draft && !draft.endsWith('\n') ? '\n' : '');
    const next = prefix + text;
    if (draft !== next) {
      input.value = next;
      input.dispatchEvent(new Event('input', {bubbles:true}));
    }
    inserted = {value:next, start:prefix.length};
    input.focus();
    input.setSelectionRange(next.length, next.length);
  }

  return {select, reset};
}

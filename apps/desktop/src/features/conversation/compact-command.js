const draftHint = '压缩命令需要单独发送。请先发送或清空当前草稿，再点击压缩。';

export function bindCompactButton(button, input, feedback) {
  button.type = 'button';
  button.textContent = '压缩';
  button.title = '把较早的对话收成摘要';
  button.setAttribute('aria-label', '压缩对话');
  input.title = '也可以输入 /压缩 或 /compact，把较早的对话收成摘要。';

  const hint = document.createElement('span');
  input.addEventListener('input', () => hint.remove());
  button.onclick = () => {
    if (input.readOnly || input.disabled) return;
    input.focus({preventScroll:true});
    const text = input.value.trim();
    if (!text) {
      input.value = '/压缩';
      input.dispatchEvent(new Event('input', {bubbles:true}));
    } else if (!/^\/(?:压缩|compact)$/iu.test(text)) {
      if (!hint.isConnected) {
        hint.textContent = (feedback.textContent ? ' ' : '') + draftHint;
        feedback.append(hint);
      }
      hint.scrollIntoView({block:'nearest'});
    }
  };
}

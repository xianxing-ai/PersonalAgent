const input = document.querySelector('#code');
document.querySelector('form').addEventListener('submit', async event => {
  event.preventDefault(); const code = input.value.trim(); input.value = '';
  try {if (!await window.obsidianPairing.submit(code)) document.querySelector('#status').textContent = '配对码格式无效，请重新粘贴';}
  catch {document.querySelector('#status').textContent = '配对窗口已失效，请重新打开';}
});
document.querySelector('#cancel').addEventListener('click', () => {input.value = ''; window.close();});
window.addEventListener('pagehide', () => {input.value = '';});

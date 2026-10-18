const text = {
  'zh-CN': {title:'桌面设置',intro:'窗口、外观和本机诊断',language:'语言',theme:'主题',system:'跟随系统',light:'浅色',dark:'深色',font:'设置页字体大小',calm:'减少设置页动效',top:'悬浮入口始终置顶',snap:'拖动结束后贴近边缘吸附',hover:'靠近悬浮球展开面板',save:'保存',saved:'已保存',windows:'窗口与恢复',reloadWarning:'重新加载会丢失该窗口未提交的输入。请先保存输入。',diagnostics:'本机诊断',refresh:'刷新',logs:'打开日志文件夹',show:'显示',reload:'重新加载',minimize:'最小化',maximize:'最大化 / 恢复',confirm:'确认重新加载此窗口？未提交的输入会丢失。'},
  en: {title:'Desktop settings',intro:'Windows, appearance and local diagnostics',language:'Language',theme:'Theme',system:'System',light:'Light',dark:'Dark',font:'Settings text size',calm:'Reduce settings motion',top:'Keep floating windows on top',snap:'Snap near screen edges after dragging',hover:'Expand panel when approaching orb',save:'Save',saved:'Saved',windows:'Windows and recovery',reloadWarning:'Reloading discards unsent input in that window. Save your input first.',diagnostics:'Local diagnostics',refresh:'Refresh',logs:'Open logs folder',show:'Show',reload:'Reload',minimize:'Minimize',maximize:'Maximize / Restore',confirm:'Reload this window? Unsent input will be lost.'},
};
const form = document.querySelector('form');
text['zh-CN'].shortcut = 'Ctrl+Shift+Space 显示悬浮球';
text.en.shortcut = 'Ctrl+Shift+Space shows the orb';
text['zh-CN'].theme = '设置页主题';
text.en.theme = 'Settings page theme';
text['zh-CN'].font = '后台与大工作区字体缩放';
text.en.font = 'Settings and workspace text scale';
const status = document.querySelector('#status');
let words = text['zh-CN'];
let current;
let ready = false, closed = false;
form.querySelectorAll('input,select,button').forEach(control=>{control.disabled=true;});
window.addEventListener('unload',()=>{closed=true;},{once:true});
function apply(settings, locale) {
  if (closed) return;
  const language = settings.language === 'system' ? (locale.startsWith('zh') ? 'zh-CN' : 'en') : settings.language;
  words = text[language];
  document.documentElement.lang = language;
  document.documentElement.dataset.calm = String(settings.calm);
  document.title = `PersonalAgent · ${words.title}`;
  document.querySelectorAll('[data-i18n]').forEach(node => { node.textContent = words[node.dataset.i18n]; });
  document.documentElement.dataset.theme = settings.theme === 'system' ? (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light') : settings.theme;
}
async function read() {
  if (closed) return;
  const snapshot = await window.localDesktop.call('read');
  if (closed) return;
  current = snapshot;
  if (!ready) for (const [key, value] of Object.entries(current.settings)) {
    const field = form.elements.namedItem(key);
    if (field) { if (field.type === 'checkbox') field.checked = value; else field.value = value; }
  }
  apply(current.settings, current.locale);
  document.querySelector('#info').textContent = `PersonalAgent ${current.version} · Electron ${current.electron} · ${current.platform} ${current.arch} · ${current.displays.map(d => `${d.width}×${d.height} @ ${d.scale}×`).join(', ')}`;
  document.querySelector('#log').textContent = current.logs;
  const container = document.querySelector('#windows');
  container.replaceChildren();
  for (const target of current.windows) {
    const row = document.createElement('div');row.className='window-row';
    const title = document.createElement('strong');title.textContent=target.mode;row.append(title);
    for (const action of ['show', 'reload', ...(['orb','panel'].includes(target.mode) ? [] : ['minimize','maximize'])]) {
      const button=document.createElement('button');button.textContent=words[action];
      button.onclick=async()=>{if(closed||(action==='reload'&&!confirm(words.confirm)))return;button.disabled=true;try{await window.localDesktop.call('window',{id:target.id,action});}catch(error){if(!closed)status.textContent=error.message;}finally{if(!closed)button.disabled=false;}};
      row.append(button);
    }
    container.append(row);
  }
  if (!ready) {
    ready = true;
    status.textContent = '';
    form.querySelectorAll('input,select,button').forEach(control=>{control.disabled=false;});
  }
}
form.onsubmit=async event=>{
  event.preventDefault();const button=form.querySelector('button');if(closed||!ready||button.disabled)return;button.disabled=true;
  const patch={};for(const key of Object.keys(current.settings)){const field=form.elements.namedItem(key);patch[key]=field.type==='checkbox'?field.checked:key==='fontScale'?Number(field.value):field.value;}
  try{await window.localDesktop.call('save',patch);if(closed)return;await read();if(!closed)status.textContent=words.saved;}catch(error){if(!closed)status.textContent=error.message;}finally{if(!closed)button.disabled=false;}
};
document.querySelector('#refresh').onclick=()=>read().catch(error=>{if(!closed)status.textContent=error.message;});
document.querySelector('#logs').onclick=()=>{if(closed)return;return window.localDesktop.call('logs').then(error=>{if(error&&!closed)status.textContent=error;}).catch(error=>{if(!closed)status.textContent=error.message;});};
matchMedia('(prefers-color-scheme: dark)').addEventListener('change',()=>{if(current)apply(current.settings,current.locale);});
read().catch(error=>{if(!closed)status.textContent=error.message;});

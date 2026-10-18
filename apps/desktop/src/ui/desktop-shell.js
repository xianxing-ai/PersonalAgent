export function mountDesktopShell() {
  const mode = new URLSearchParams(location.search).get('mode');
  if (!['admin','workspace'].includes(mode) || !window.desktop?.preferences) return;
  const labels = {'设置':'Settings','设置与管理':'Settings and management','桌面设置与恢复':'Desktop settings and recovery','关闭':'Close','最小化':'Minimize','最大化或还原':'Maximize or restore','关闭工作区':'Close workspace','打开设置':'Open settings','搜索设置…':'Search settings…','设置导航':'Settings navigation','常规':'General','外观':'Appearance','快捷键':'Shortcuts','个人资料':'Profile','语音':'Voice','配置':'Configuration','个性化':'Personalization','模型':'Models','记忆':'Memory','个人':'Personal','应用':'Application'};
  Object.assign(labels, {'集成':'Integrations','编码':'Coding','任务':'Tasks','桌面宠物':'Desktop pets','键盘快捷键':'Keyboard shortcuts','分析':'Analytics','电脑操控':'Computer control','插件':'Plugins','钩子':'Hooks','连接':'Connections','环境':'Environment','安全':'Security','已归档任务':'Archived tasks'});
  const originals = new WeakMap();
  let preference, receivedUpdate = false, closed = false;
  function apply() {
    if (closed || !preference) return;
    const {settings,locale}=preference;
    const lang=settings.language==='system'?(locale.startsWith('zh')?'zh-CN':'en'):settings.language;
    document.documentElement.lang=lang;
    for(const node of document.querySelectorAll('.admin-bar button,.side nav button span,.nav-group h2,.side-home span,.admin-search input,.workspace-titlebar button,[data-open-settings]')){
      if(!originals.has(node))originals.set(node,{text:node.childElementCount?null:node.textContent,title:node.getAttribute('title'),label:node.getAttribute('aria-label'),placeholder:node.getAttribute('placeholder')});
      const original=originals.get(node);
      const translate=value=>lang==='en'?(labels[value]??value):value;
      if(original.text!==null&&node.textContent!==translate(original.text))node.textContent=translate(original.text);
      for(const [key,attr] of [['title','title'],['label','aria-label'],['placeholder','placeholder']])if(original[key]!==null&&node.getAttribute(attr)!==translate(original[key]))node.setAttribute(attr,translate(original[key]));
    }
  }
  const observer=new MutationObserver(apply);observer.observe(document.body,{childList:true,subtree:true});
  const unsubscribe=window.desktop.subscribePreferences(value=>{if(closed)return;receivedUpdate=true;preference=value;apply();});
  window.desktop.preferences().then(value=>{if(closed||receivedUpdate)return;preference=value;apply();}).catch(()=>{});
  const theme=matchMedia('(prefers-color-scheme: dark)');theme.addEventListener('change',apply);
  window.addEventListener('unload',()=>{closed=true;observer.disconnect();unsubscribe();theme.removeEventListener('change',apply);},{once:true});
}

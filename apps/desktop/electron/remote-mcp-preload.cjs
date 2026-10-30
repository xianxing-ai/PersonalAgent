const {contextBridge,ipcRenderer}=require('electron');
const allowed=new Set(['state','select','new','migrate','import','save','connect','disconnect','revoke','submit','task','focusQuestion','respond','cancel']);
contextBridge.exposeInMainWorld('remoteMcp',Object.freeze({
  invoke:(name,payload)=>allowed.has(name)?ipcRenderer.invoke('desktop:remote-mcp',name,payload):Promise.reject(Error('不支持的操作')),
}));

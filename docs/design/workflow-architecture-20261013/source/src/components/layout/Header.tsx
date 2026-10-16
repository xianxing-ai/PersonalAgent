import { Cpu } from 'lucide-react';
export function Header() {
  return <header className="site-header">
    <div className="site-brand"><Cpu size={24}/><div><strong>PersonalAgent <span>当前架构实验（未定型）</span></strong><small>28 功能连通图 · 自有镜像 · 平台MCP与日志接入</small></div></div>
    <div className="site-demo">2026.10.14 · 平台接线与实测待完成</div>
  </header>;
}

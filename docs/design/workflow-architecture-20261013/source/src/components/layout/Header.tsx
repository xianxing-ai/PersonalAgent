import { Cpu } from 'lucide-react';
export function Header() {
  return <header className="site-header">
    <div className="site-brand"><Cpu size={24}/><div><strong>PersonalAgent <span>最终主架构</span></strong><small>28 功能连通图 · 华为云国产模型优先 · 对齐现有端口</small></div></div>
    <div className="site-demo">主架构已定 · 生产接线与延迟实测待完成</div>
  </header>;
}

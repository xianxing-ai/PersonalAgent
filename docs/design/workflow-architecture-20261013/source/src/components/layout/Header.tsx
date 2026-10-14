import { Cpu } from 'lucide-react';
export function Header() {
  return <header className="site-header">
    <div className="site-brand"><Cpu size={24}/><div><strong>PersonalAgent <span>架构修订版</span></strong><small>28 功能连通图 · 一个全局决策配置 · 六大逻辑板块</small></div></div>
    <div className="site-demo">2026.10.14 · 设计查看页 · 生产接线与实测待完成</div>
  </header>;
}

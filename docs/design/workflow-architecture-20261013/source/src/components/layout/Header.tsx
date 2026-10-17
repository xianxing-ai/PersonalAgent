import { Cpu } from 'lucide-react';
export function Header() {
  return <header className="site-header">
    <div className="site-brand"><Cpu size={24}/><div><strong>PersonalAgent <span>当前设计 · 未最终定型</span></strong><small>本机 Laya · 28图/185节点串行 · AgentArts代理</small></div></div>
    <div className="site-demo">2026.10.16 · 设计基线 abb70879 · 实现/实测/缺项分别记录</div>
  </header>;
}

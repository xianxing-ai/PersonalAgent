import { Cpu } from 'lucide-react';
export function Header() {
  return <header className="site-header">
    <div className="site-brand"><Cpu size={24}/><div><strong>PersonalAgent <span>Competition架构 · 其余范围未最终定型</span></strong><small>AgentArts Workflow · 本机 Laya · 本地授权执行</small></div></div>
    <div className="site-demo">2026.10.17 · Competition边界修订 · 实现/实测/缺项分别记录</div>
  </header>;
}

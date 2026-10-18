import fs from 'node:fs';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
const root=path.resolve(import.meta.dirname,'../..');
const design='docs/design/workflow-architecture-20261013';
const tracked=execFileSync('git',['ls-files','-z','--','*.md'],{cwd:root,encoding:'utf8'}).split('\0').filter(Boolean);
const added=['DESIGN.md','WORKFLOWS.md','MODULES.md','IMPLEMENTATION.md','DOCUMENTATION_INVENTORY.md'].map(p=>design+'/'+p).concat('docs/adr/0033-unified-decision-workflow-architecture.md','docs/modules/AGENTARTS-PLATFORM-HANDOFF-20261014.md');
const files=[...new Set([...tracked,...added])].filter(p=>!p.includes('/fixtures/')&&!p.includes('/demo-vault/')&&!p.startsWith('docs/demo/knowledge/vault/')&&!p.endsWith('/SKILL.md')&&p!=='scripts/laya/README.md').sort();
const core=new Set(['README.md','AGENTS.md','CONTRIBUTING.md','docs/README.md','docs/CURRENT_DESIGN_CONTEXT.md','docs/PRD.md','docs/ARCHITECTURE.md','docs/PROJECT_STRUCTURE.md','docs/DEVELOPMENT_PROTOCOL.md','docs/MODULE_ASSIGNMENTS.md','docs/ROADMAP.md','docs/interfaces/README.md','docs/interfaces/CURRENT_INTERFACE_CATALOG.md','docs/modules/README.md','docs/modules/TEMPLATE.md','docs/adr/README.md','docs/competition/HUAWEI_ICT_AGENTARTS_PROFILE.md','docs/reviews/DESIGN_READING_GATE.md']);
function classify(file) {
 if(file==='AGENTS.md')return '一般协作规则参考；当前架构决定以最新Competition Profile与架构修订为准';
 if(core.has(file))return '当前规范：正文重写/同步';
 if(file.startsWith(design+'/'))return '当前主架构：完整正文/生成流程/查看器';
 if(file==='docs/adr/0033-unified-decision-workflow-architecture.md')return '历史架构讨论：原ADR-0024，现存于0033；现行决定见Competition Profile';
 if(file.startsWith('docs/design/'))return '历史设计：替代入口，保留原基线';
 if(file.startsWith('docs/adr/'))return '历史ADR：保留原决定与适用范围；现行规则见Competition Profile';
 if(/^(apps|packages)\/.+\/README\.md$/.test(file)&&fs.existsSync(path.join(root,file))&&fs.readFileSync(path.join(root,file),'utf8').includes('<!-- architecture-scope-20261013 -->'))return '模块架构已重写；API/验收参考保留';
 if(file.startsWith('docs/modules/'))return '工作包/验收记录：保留原日期、作者与结果';
 return '接口/技术/阶段参考：当前设计导航统一';
}
function patch(file,before,after) {
 const full=path.join(root,file).replace(/\\/g,'/');
 if(before===null)return `*** Add File: ${full}\n${after.trimEnd().split('\n').map(l=>'+'+l).join('\n')}\n`;
 if(before===after)return '';
 const a=before.trimEnd().split('\n'),b=after.trimEnd().split('\n');let p=0,s=0;
 while(p<Math.min(a.length,b.length)&&a[p]===b[p])p++;
 while(s<Math.min(a.length-p,b.length-p)&&a[a.length-s-1]===b[b.length-s-1])s++;
 return `*** Update File: ${full}\n@@\n${[...(p?[' '+a[p-1]]:[]),...a.slice(p,a.length-s).map(l=>'-'+l),...b.slice(p,b.length-s).map(l=>'+'+l),...(s?[' '+a[a.length-s]]:[])].join('\n')}\n`;
}
const read=file=>fs.readFileSync(path.join(root,file),'utf8').replace(/\r\n?/g,'\n');
const result=[];
if(process.argv.includes('--inventory')) {
 const file=design+'/DOCUMENTATION_INVENTORY.md';
 const lines=files.map(p=>`| [${p}](${path.posix.relative(design,p)}) | ${classify(p)} |`);
 const body='# 全项目架构文档清单\n\n2026-10-17按当前Competition架构决定、本机Laya运行位置及AgentArts Workflow编排边界核对规范。下表覆盖受版本控制的规范、模块README、接口、技术说明、设计、ADR及工作包；示例Vault/夹具/SKILL正文不属于架构规范，保持原样。未提交的用户旧设计草稿不纳入PR。\n\n核心当前文档重写正文；模块当前架构职责重写并保留可用API/运行说明；历史验收与ADR保留原作者、日期和结果，仅替代导航/标记关系。此区分防止把目标设计写成过去已经实现。\n\n旧核心正文可用git show 3275aa91:文件路径读取；2026-10-15历史记录保留当时的Laya与镜像实测范围。本机Laya现已确认在本机运行并参与Competition产品路径，AgentArts继续承担Agent/Workflow构建、编排、评估与部署；既有回执不证明外部比赛资格或真实端到端。公开wire与数据迁移不由文档修改。\n\n| 文档 | 本次处理与阅读规则 |\n| --- | --- |\n'+lines.join('\n')+'\n';
 result.push(patch(file,fs.existsSync(path.join(root,file))?read(file):null,body.replaceAll('本机Laya现已确认在本机运行并参与Competition产品路径','本机Laya仅为独立Local Profile实验候选，不属于Competition产品路径')));
} else {
 const targets=files.filter(file=>!core.has(file)&&!file.startsWith(design+'/')&&file!=='docs/adr/0033-unified-decision-workflow-architecture.md'&&fs.existsSync(path.join(root,file))&&!read(file).includes('<!-- architecture-scope-20261013 -->'));
 const batch=Number(process.argv[2]||0),chosen=targets.slice(batch*24,batch*24+24);
 for(const file of chosen) {
  const before=read(file),title=before.split('\n').find(l=>l.startsWith('# '));if(!title)continue;
  const rel=p=>path.posix.relative(path.posix.dirname(file),p);
  const historical=file.startsWith('docs/design/');
  const note=`<!-- current-design-20261013 -->\n> ${historical?'历史设计，当前适用性以Competition Profile及最新架构修订为准；原基线/估算/验收保留。':'本文按所记版本阅读，API/阶段/验收事实保留。'}当前依据：[完整主架构](${rel(design+'/DESIGN.md')}) · [28功能流程](${rel(design+'/WORKFLOWS.md')}) · [连通图](${rel(design+'/index.html')}) · [接口状态](${rel('docs/interfaces/CURRENT_INTERFACE_CATALOG.md')}) · [协作规则](${rel('CONTRIBUTING.md')})。本机Laya在本机运行并参与Competition产品路径，AgentArts负责Agent/Workflow构建、编排、评估与部署；本地Runtime保留Policy、ToolGateway、TaskRuntime及Evidence。具体节点、领域资格、外部比赛资格与真实验收分别核实，AgentArts失败不得静默回退Local Profile。常规PR须有合资格非作者对当前head有效批准；Owner具体PR审核例外须留记录，必需技术CI不豁免。`;
  let after=before.replace(/^<!-- current-design-202610(?:09|13) -->\n>[^\n]*\n?/gm,'');
  after=after.replace(title,title+'\n\n'+note.replaceAll('本机Laya在本机运行并参与Competition产品路径','本机Laya仅为独立Local Profile实验候选，不属于Competition产品路径')).replace(/\n{4,}/g,'\n\n\n');
  result.push(patch(file,before,after));
 }
 process.stdout.write(JSON.stringify({total:targets.length,batch,files:chosen,changed:chosen.filter((_,i)=>Boolean(result[i])),patch:result.some(Boolean)?'*** Begin Patch\n'+result.filter(Boolean).join('')+'*** End Patch':null}));
 process.exit(0);
}
process.stdout.write(JSON.stringify({total:files.length,patch:'*** Begin Patch\n'+result.filter(Boolean).join('')+'*** End Patch'}));

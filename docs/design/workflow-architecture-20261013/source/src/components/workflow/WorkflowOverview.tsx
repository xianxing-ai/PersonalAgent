import { memo, useMemo, useState } from 'react';
import type { Node, Edge, NodeProps, NodeTypes } from '@xyflow/react';
import { ReactFlow, ReactFlowProvider, Background, Controls, MiniMap, Handle, Position, MarkerType, useReactFlow } from '@xyflow/react';
import { ALL_FEATURES } from '../../data/architectureFeatures';
import type { ArchitectureNode } from '../../data/architectureFeatures';
import { OVERVIEW_COLUMNS, OVERVIEW_LINKS, SHARED_NODES, INTERFACE_NOTES } from '../../data/overview';
import { MODEL_SOURCES, MODEL_CATALOG, SHARED_DETAILS, LATENCY_DESIGN, FINAL_DESIGN_STATUS } from '../../data/currentNotes';
import { ARCHITECTURE_AREAS, ARCHITECTURE_MECHANISMS, DESIGN_GOALS, ACCEPTANCE_MATRIX, GOLDEN_PATH } from '../../data/currentMechanisms';
import { PLATFORM_INTEGRATIONS, PLATFORM_BASELINE, PLATFORM_SCOPE, PLATFORM_GOLDEN_PATH, PLATFORM_BOUNDARIES, RESOURCE_ROUTES } from '../../data/currentPlatform';
import currentDesign from '../../data/currentDesign.generated.json';

type GraphData = Record<string, unknown> & {label:string; subtitle:string; kind:string; featureId?:string; count?:number; detail?:ArchitectureNode; focused?:boolean};
type Panel = 'node' | 'area' | 'mechanism' | 'validation' | 'platform' | 'wiring' | undefined;
const COLORS:Record<string,string> = {flow:'#64748b',decision:'#a78bfa',evidence:'#34d399',shadow:'#fbbf24',platform:'#22d3ee'};
const FEATURE_MAP = new Map(ALL_FEATURES.map(f=>[f.id,f]));
const TEMPLATE_COUNT = ALL_FEATURES.reduce((sum,f)=>sum+f.nodes.length,0);
const KIND_LABELS:Record<string,string> = {input:'输入/事件',tool_exec:'工具/端口',semantic_decision:'AgentArts Agent/Workflow',execution_model:'配置执行模型候选',deterministic_check:'宿主检查',checkpoint:'状态/检查点',parallel_split:'独立依赖分支（当前串行）',join:'条件分支汇合',verification:'结果核验',wait_user:'按需用户决定',complete:'汇合/交付'};
const FlowCard = memo(({data,selected}:NodeProps<Node<GraphData>>)=>(
 <div className={'overview-node '+(data.kind==='platform'?'platform ':'')+(selected?'selected ':'')+(data.focused?'focused':'')} data-feature-code={data.featureId} title={data.label}>
  <Handle type="target" position={Position.Left} id="in"/><Handle type="source" position={Position.Right} id="out"/>
  <div className="overview-node-meta">{data.featureId || (data.kind==='decision'?'AgentArts编排':data.kind==='platform'?'AgentArts接入':'共用路径')}<span>{data.kind==='platform'?'分项状态':data.detail?'设计节点':data.count!==undefined?data.count+' 节点':'设计'}</span></div>
  <div className="overview-node-title">{data.label}</div><div className="overview-node-subtitle">{data.subtitle}</div>
 </div>
));
const nodeTypes:NodeTypes={overview:FlowCard};

// 用声明的前置关系布局；图上的补查/恢复反馈边不充当硬依赖，以免把并行分支排成串行。
function ranks(nodes:ArchitectureNode[]) {
 const known=new Set(nodes.map(n=>n.id)), degree=new Map(nodes.map(n=>[n.id,0])), next=new Map(nodes.map(n=>[n.id,[] as string[]]));
 for(const node of nodes)for(const source of node.dependencies)if(known.has(source)){degree.set(node.id,degree.get(node.id)!+1);next.get(source)!.push(node.id);}
 const level=new Map<string,number>(),queue=nodes.filter(n=>degree.get(n.id)===0).map(n=>n.id);
 queue.forEach(id=>level.set(id,0));
 for(let i=0;i<queue.length;i++)for(const target of next.get(queue[i]) || []){
  level.set(target,Math.max(level.get(target)||0,(level.get(queue[i])||0)+1));
  degree.set(target,degree.get(target)!-1);if(degree.get(target)===0)queue.push(target);
 }
 nodes.forEach((n,i)=>{if(!level.has(n.id))level.set(n.id,i);});
 return level;
}
function makeGraph(expanded:Set<string>,selected:string|undefined,showDecisions:boolean,pathMode:'all'|'realtime'|'background',focusIds:string[]){
 const nodes:Node<GraphData>[]=[],edges:Edge[]=[],focus=new Set(focusIds);
 const isRelated=(id:string)=>id===selected?.split('::')[0]||focus.has(id);
 let x=0;
 for(const column of OVERVIEW_COLUMNS){
  let y=0,width=300;
  for(const id of column.ids){
   const f=FEATURE_MAP.get(id)!;
   nodes.push({id,type:'overview',position:{x,y},data:{label:f.name,subtitle:column.title,kind:'flow',featureId:id,count:f.nodes.length,focused:focus.has(id)},selected:selected===id});
   if(expanded.has(id)){
    const level=ranks(f.nodes),perLevel=new Map<number,number>();
    for(const detail of f.nodes){
     const rank=level.get(detail.id)||0,lane=perLevel.get(rank)||0;perLevel.set(rank,lane+1);
     nodes.push({id:id+'::'+detail.id,type:'overview',position:{x:x+lane*285,y:y+140+rank*140},data:{label:detail.label,subtitle:KIND_LABELS[detail.kind]||detail.kind,kind:'flow',featureId:id,detail,focused:focus.has(id)},selected:selected===id+'::'+detail.id});
    }
    width=Math.max(width,Math.max(...perLevel.values(),1)*285+40);
    for(const e of f.edges)edges.push({id:id+'::'+e.id,source:id+'::'+e.source,target:id+'::'+e.target,sourceHandle:'out',targetHandle:'in',label:e.branchLabel,style:{stroke:'#38bdf8',strokeWidth:1.5,strokeDasharray:e.condition?'5 4':undefined},markerEnd:{type:MarkerType.ArrowClosed,color:'#38bdf8'}});
    const roots=f.nodes.filter(n=>n.dependencies.length===0);
    for(const n of roots.length?roots:[f.nodes[0]])edges.push({id:id+'::entry::'+n.id,source:id,target:id+'::'+n.id,sourceHandle:'out',targetHandle:'in',style:{stroke:'#38bdf8'}});
    y+=140+(Math.max(...level.values(),0)+1)*140+70;
   }else y+=145;
  }
  x+=width;
 }
 SHARED_NODES.forEach((n,i)=>nodes.push({id:n.id,type:'overview',position:{x,y:i*145},data:{label:n.label,subtitle:n.subtitle,kind:n.kind,focused:focus.has(n.id)},selected:selected===n.id}));
 if(expanded.size===0){
  const order=['F01','F03','F28','F24','F02','F04','F05','F27','F08','F09','F10','F12','F11','F07','F06','F13','F19','F17','F15','F16','F18','F20','F14','F21','F25','F26','F22','F23'];
  nodes.forEach(n=>{const i=order.indexOf(n.id);if(i>=0)n.position={x:Math.floor(i/4)*240,y:(i%4)*125};else{const s=SHARED_NODES.findIndex(item=>item.id===n.id);n.position={x:120+(s%4)*360,y:535+Math.floor(s/4)*125};}});
 }
 OVERVIEW_LINKS.forEach(([source,target,label,kind],i)=>{
  if(kind==='decision'&&!showDecisions)return;
  const emphasized=!!selected||focus.size>0,related=!!isRelated(source)||isRelated(target),color=COLORS[kind];
  edges.push({id:'relation-'+i,source,target,sourceHandle:'out',targetHandle:'in',label:related?label:undefined,type:'smoothstep',style:{stroke:color,strokeWidth:related?2.5:1.8,opacity:emphasized?(related?1:0.1):(kind==='decision'?0.32:0.65),strokeDasharray:kind==='decision'||kind==='shadow'?'6 5':undefined},labelStyle:{fill:'#e2e8f0',fontSize:12},labelBgStyle:{fill:'#111827',fillOpacity:0.96},markerEnd:{type:MarkerType.ArrowClosed,color}});
 });
 if(pathMode!=='all'){
  const active=new Set(pathMode==='realtime'?['USER','F01','F02','F03','F05','F27','F24','F28','DECISION','MODELS','POLICY','TOOL','EVIDENCE','VERIFY','AA_GATEWAY','AA_KNOWLEDGE','AA_OBSERVE']:['EVENT','F04','F05','F09','F10','F12','F22','F23','F26','F27','DECISION','MODELS','F24','EVIDENCE','AA_KNOWLEDGE','AA_OBSERVE','AA_EVALUATE']);
  nodes.forEach(n=>{n.style={opacity:active.has(n.data.featureId || n.id)?1:0.25};});
  edges.forEach(e=>{if(!active.has(e.source.split('::')[0])||!active.has(e.target.split('::')[0]))e.style={...e.style,opacity:0.07};});
 }
 return {nodes,edges};
}
function OverviewBody(){
 const flow=useReactFlow();
 const [expanded,setExpanded]=useState<Set<string>>(new Set()),[selected,setSelected]=useState<string>();
 const [showDecisions,setShowDecisions]=useState(true),[panel,setPanel]=useState<Panel>();
 const [pathMode,setPathMode]=useState<'all'|'realtime'|'background'>('all'),[showLatency,setShowLatency]=useState(false);
 const [areaId,setAreaId]=useState(ARCHITECTURE_AREAS[0].id),[mechanismId,setMechanismId]=useState(ARCHITECTURE_MECHANISMS[0].id);
 const [platformId,setPlatformId]=useState(PLATFORM_INTEGRATIONS[0].id);
 const area=ARCHITECTURE_AREAS.find(a=>a.id===areaId)!,mechanism=ARCHITECTURE_MECHANISMS.find(m=>m.id===mechanismId)!;
 const platform=PLATFORM_INTEGRATIONS.find(item=>item.id===platformId)!;
 const focusIds=useMemo(()=>panel==='area'?[...area.features,...area.shared]:panel==='mechanism'?[...mechanism.features,...mechanism.shared]:panel==='platform'?[platform.nodeId,...platform.features,...platform.shared]:[],[panel,area,mechanism,platform]);
 const graph=useMemo(()=>makeGraph(expanded,selected,showDecisions,pathMode,focusIds),[expanded,selected,showDecisions,pathMode,focusIds]);
 const selectedNode=graph.nodes.find(n=>n.id===selected),f=FEATURE_MAP.get(selectedNode?.data.featureId||'');
 const connections=OVERVIEW_LINKS.filter(([s,t])=>s===f?.id||t===f?.id);
 const fit=()=>flow.fitView({padding:0.06,duration:300});
 const expand=(ids:string[])=>{setExpanded(new Set(ids));setSelected(undefined);setPanel(undefined);};
 const openFeature=(id:string)=>{setSelected(id);const entry=PLATFORM_INTEGRATIONS.find(item=>item.nodeId===id);if(entry){setPlatformId(entry.id);setPanel('platform');}else setPanel('node');};
 const togglePanel=(next:Panel)=>{setPanel(panel===next?undefined:next);setSelected(undefined);};
 const featureLinks=(ids:string[])=><div className="architecture-feature-links">{ids.map(id=><button key={id} onClick={()=>openFeature(id)}>{id} {FEATURE_MAP.get(id)?.name}</button>)}</div>;
 return <section className="overview-shell" aria-label="全部28个功能连通总图">
  <div className="overview-toolbar">
   <div><h1>全部工作流 · 一张连通图</h1><p>28图 · {TEMPLATE_COUNT}节点默认串行 · AgentArts负责Competition编排 · 实测与目标分开</p></div>
   <div className="overview-actions">
    {(['all','realtime','background'] as const).map(mode=><button key={mode} aria-pressed={pathMode===mode} onClick={()=>setPathMode(mode)}>{mode==='all'?'全部路径':mode==='realtime'?'实时路径':'后台路径'}</button>)}
    <button aria-pressed={panel==='mechanism'} onClick={()=>togglePanel('mechanism')}>核心机制</button>
    <button className="platform-entry" aria-pressed={panel==='platform'} onClick={()=>togglePanel('platform')}>AgentArts接入与代码核对</button>
    <button aria-pressed={panel==='validation'} onClick={()=>togglePanel('validation')}>验证方案</button>
    <button aria-pressed={panel==='wiring'} onClick={()=>togglePanel('wiring')}>协作者接线 · CW10 / MOD39</button>
    <button aria-pressed={showLatency} onClick={()=>setShowLatency(!showLatency)}>延迟与设计状态</button>
    <button onClick={()=>expand(ALL_FEATURES.map(item=>item.id))}>展开全部节点</button>
    <button onClick={()=>expand([])}>收起为功能总览</button><button onClick={fit}>适应全部</button>
    <label><input type="checkbox" checked={showDecisions} onChange={e=>setShowDecisions(e.target.checked)}/> 决策连线</label>
   </div>
  </div>
  <nav className="architecture-areas" aria-label="六大逻辑板块">
   <span>六大板块</span>{ARCHITECTURE_AREAS.map(item=><button key={item.id} aria-pressed={panel==='area'&&areaId===item.id} onClick={()=>{setAreaId(item.id);setPanel('area');setSelected(undefined);}}>{item.name}</button>)}
   <select aria-label="快速查看功能" value={f?.id||''} onChange={e=>{if(e.target.value)openFeature(e.target.value);}}><option value="">快速查看 F01–F28</option>{ALL_FEATURES.map(item=><option key={item.id} value={item.id}>{item.id} {item.name}</option>)}</select>
  </nav>
  <div className="overview-caption">Competition目标由AgentArts负责构建、编排、评估和部署；本地Runtime经CloudAgentPort调用部署版本并负责授权执行与Evidence。历史实测记录与目标分别展示，不把本机Laya或自有镜像编排作为比赛主链或故障回退。</div>
  {showLatency&&<div className="architecture-latency"><strong>{FINAL_DESIGN_STATUS}</strong><ul>{LATENCY_DESIGN.map((line,i)=><li key={i}>{line}</li>)}</ul></div>}
  <div className="overview-body">
   <div className="overview-canvas">
    <ReactFlow key={expanded.size===ALL_FEATURES.length?'expanded':expanded.size===0?'compact':'partial'} nodes={graph.nodes} edges={graph.edges} nodeTypes={nodeTypes} fitView fitViewOptions={{padding:0.06}} minZoom={0.025} maxZoom={2.5} nodesDraggable={false} nodesConnectable={false} onNodeClick={(_,n)=>openFeature(n.id)} onPaneClick={()=>{setSelected(undefined);setPanel(undefined);}} proOptions={{hideAttribution:true}}>
     <Background color="#1c2a42" gap={24}/><Controls/>{expanded.size>0&&<MiniMap pannable zoomable nodeColor={n=>COLORS[String(n.data.kind)]||'#64748b'}/>}
    </ReactFlow>
   </div>
   {panel&&<aside className="overview-detail" aria-label="架构详情">
    <button className="overview-close" onClick={()=>setPanel(undefined)} aria-label="关闭总图详情">×</button>
    {panel==='wiring'&&<>
     <div className="overview-kicker">固定来源 {currentDesign.sha.slice(0,8)} · 不复制另一套负责人</div><h2>协作者接线与全部 MOD</h2>
     <p>每个工作包由唯一owner完成公开端口→实际调用方→必要验证→Evidence；依赖方不代替消费方接线。保留unavailable/真实未验。</p>
     <h3>十个当前工作包</h3>{currentDesign.workPackages.map(pkg=><article className="architecture-goal" key={pkg.title}><h3>{pkg.title}</h3><p>{pkg.ports}</p><strong>实际调用方</strong><p>{pkg.consumer}</p><small>{pkg.status}</small></article>)}
     <details className="platform-section"><summary>全部39 MOD：owner / port / 消费方 / 测试 / 当前缺项</summary>{currentDesign.modules.map(mod=><article className="architecture-goal" key={mod.title}><h3>{mod.title}</h3><p>{mod.ports}</p><p>{mod.consumer}</p><code>{mod.tests}</code><p>{mod.status}</p><small>{mod.evidence}</small></article>)}</details>
    </>}
    {panel==='platform'&&<>
     <div className="overview-kicker">当前平台 · 已实现/已验/缺项分开</div><h2>AgentArts平台接入</h2>
     <p>{PLATFORM_SCOPE}</p>
     <nav className="architecture-mechanism-tabs" aria-label="AgentArts接入分类">{PLATFORM_INTEGRATIONS.map(item=><button key={item.id} aria-pressed={item.id===platformId} onClick={()=>{setPlatformId(item.id);setSelected(item.nodeId);}}>{item.name}</button>)}</nav>
     <h3>{platform.name}</h3><div className="platform-status">{platform.status}</div>
     <h3>已有实现 · 可复用</h3><ul>{platform.existing.map(line=><li key={line}>{line}</li>)}</ul>
     <h3>只补这些适配</h3><ul>{platform.increment.map(line=><li key={line}>{line}</li>)}</ul>
     <h3>详细接入流程</h3><ol>{platform.steps.map(line=><li key={line}>{line}</li>)}</ol>
     <h3>复用边界</h3><ul>{platform.reuse.map(line=><li key={line}>{line}</li>)}</ul>
     <h3>平台价值与真实验收证据</h3><p>{platform.proof}</p>
     <h3>关联工作流 · 同图高亮</h3>{featureLinks(platform.features)}
     <details className="platform-section"><summary>知识库、MCP与Skill的多来源</summary>{RESOURCE_ROUTES.map(item=><article className="architecture-goal" key={item.name}><h3>{item.name}</h3><ul>{item.sources.map(source=><li key={source}>{source}</li>)}</ul><p>{item.route}</p><small>{item.existing}</small></article>)}<p>来源选择复用现有配置与宿主；不因平台、自制或第三方来源增加固定封锁名单、角色禁用或新的审批门槛。</p></details>
     <details className="platform-section"><summary>四项代码核对与最小增量</summary><p>{PLATFORM_BASELINE}</p>{PLATFORM_INTEGRATIONS.map(item=><article className="architecture-goal" key={item.id}><h3>{item.name}</h3><p>{item.status}</p><ul>{item.code.map(code=><li className="platform-code" key={code}><code>{code}</code></li>)}</ul></article>)}<article className="architecture-goal"><h3>Skill已有代码</h3><code>packages/skills/src/local-installation.ts</code><br/><code>packages/skills/src/cloud-selection.ts</code><p>本机安装/快照与云选择端口已有；平台资产和网络来源适配、通用资源执行及云验收待交付。</p></article></details>
     <details className="platform-section"><summary>首条真实验收路径与边界</summary><ol>{PLATFORM_GOLDEN_PATH.map(step=><li key={step}>{step}</li>)}</ol><ul>{PLATFORM_BOUNDARIES.map(line=><li key={line}>{line}</li>)}</ul></details>
     <div className="platform-docs">官方接口依据：{platform.sources.map(source=><a key={source.url} href={source.url} target="_blank" rel="noreferrer">{source.label}</a>)}</div>
    </>}
    {panel==='area'&&<>
     <div className="overview-kicker">六大逻辑板块 · 同图高亮</div><h2>{area.name}</h2><p>{area.description}</p>
     <div className="overview-adapter">阅读分组，不新增进程、服务或第二套任务系统。28个功能是模板库；模块编号是工程分工。</div>
     <h3>功能与共享路径</h3>{featureLinks(area.features)}
     <div className="architecture-feature-links">{area.shared.map(id=><button key={id} onClick={()=>openFeature(id)}>{SHARED_NODES.find(n=>n.id===id)?.label}</button>)}</div>
     <h3>设计重点</h3><p>明确责任与授权 → 主模型语义编排 → 范围内执行者探索 → 可信工具与读回 → 状态/记忆更新 → 按需影子。</p>
    </>}
    {panel==='mechanism'&&<>
     <div className="overview-kicker">2026.10.15 核心机制 · 实验实现与目标</div><h2>{mechanism.name}</h2>
     <nav className="architecture-mechanism-tabs" aria-label="核心机制分类">{ARCHITECTURE_MECHANISMS.map(item=><button key={item.id} aria-pressed={item.id===mechanismId} onClick={()=>setMechanismId(item.id)}>{item.name}</button>)}</nav>
     <p>{mechanism.summary}</p><h3>详细流程</h3><ol>{mechanism.steps.map((s,i)=><li key={i}>{s}</li>)}</ol>
     <h3>分支与边界</h3><ul>{mechanism.exceptions.map((s,i)=><li key={i}>{s}</li>)}</ul>
     <div className="overview-adapter"><strong>现有能力 / 待接线</strong><p>{mechanism.status}</p></div>
     <h3>关联功能</h3>{featureLinks(mechanism.features)}
    </>}
    {panel==='validation'&&<>
     <div className="overview-kicker">设计目标与验证方法 · 不填模拟成绩</div><h2>三项可检验目标</h2>
     {DESIGN_GOALS.map((goal,i)=><article className="architecture-goal" key={goal.name}><h3>{i+1}. {goal.name}</h3><p>{goal.mechanism}</p><small>指标：{goal.metrics}</small></article>)}
     <h3>真实证据与下一业务验收</h3><ol>{GOLDEN_PATH.map((step,i)=><li key={i}>{step}</li>)}</ol>{featureLinks(['F15','F22','F08','F12','F24'])}
     <h3>公平对照条件</h3><p>相同模型、数据、授权、幂等与读回能力；仅改变被测机制。完整重规划对照也能复用幂等，不故意做弱对照。</p>
     <h3>验收矩阵</h3><div className="architecture-matrix">{ACCEPTANCE_MATRIX.map(([ids,fixture,expected])=><article key={ids}><strong>{ids}</strong><p>{fixture}</p><small>{expected}</small></article>)}</div>
     <div className="overview-adapter">历史实测：Wukong167.432s/外层183.618s/20条；Pelican第二轮81.611s/外层89.735s/21条，首轮partial保留；6次本机Laya判断182–618ms，历史案例中的站点均升级DeepSeek，未达150ms。该本机/镜像路径、云目录与关联日志均不证明Competition平台工作流闭环。网页构建/截图只验证查看器。</div>
    </>}
    {panel==='node'&&selectedNode&&<>
     <div className="overview-kicker">{f?.id||'共用路径'} · 设计 / 逐项接线验证</div><h2>{selectedNode.data.label}</h2>
     {f?<>
      <p>{f.summary}</p><div className="overview-adapter"><strong>现有代码适配</strong><p>{INTERFACE_NOTES[f.id]||'复用已定义的公开能力与Runtime/ModelGateway/ToolGateway。真实可用性按现有接口目录；此页不提升验收或冻结等级。'}</p></div>
      {PLATFORM_INTEGRATIONS.some(item=>item.features.includes(f.id))&&<div className="architecture-feature-links">{PLATFORM_INTEGRATIONS.filter(item=>item.features.includes(f.id)).map(item=><button key={item.id} onClick={()=>openFeature(item.nodeId)}>AgentArts · {item.name}</button>)}</div>}
      <div className="overview-actions"><button onClick={()=>setExpanded(prev=>{const next=new Set(prev);if(next.has(f.id))next.delete(f.id);else next.add(f.id);return next;})}>{expanded.has(f.id)?'收起此功能':'在本图展开节点'}</button><button onClick={()=>flow.setCenter(selectedNode.position.x+110,selectedNode.position.y+60,{zoom:1,duration:300})}>定位此功能</button></div>
      <h3>语义决策点</h3><ul>{f.decisionPoints.map((s,i)=><li key={i}>{s}</li>)}</ul>
      <h3>完整功能流程 · {f.nodes.length} 节点</h3><ol>{f.nodes.map(n=><li key={n.id}><button className="overview-text-button" onClick={()=>{setExpanded(prev=>new Set([...prev,f.id]));setSelected(f.id+'::'+n.id);}}>{n.label}</button><small>{n.dependencies.length?'前置：'+n.dependencies.join('、'):'入口 / 独立分支'} · {KIND_LABELS[n.kind]||n.kind}{n.joinMode==='selected'?' · 仅汇合已选择分支':''}</small>{n.condition&&<small className="architecture-condition">条件：{n.condition}</small>}</li>)}</ol>
      {f.designNotes&&<><h3>修订说明与边界</h3><ul>{f.designNotes.map((s,i)=><li key={i}>{s}</li>)}</ul></>}
      <h3>与其他流程的连接</h3><ul>{connections.filter(([, , ,kind])=>kind!=='decision').map(([s,t,label],i)=><li key={i}><strong>{s} → {t}</strong><small>{label}</small></li>)}</ul>
      <h3>失败、取消与恢复</h3><ul>{f.recovery.map((s,i)=><li key={i}>{s}</li>)}</ul>
      {f.acceptance&&<><h3>如何验证</h3><ul>{f.acceptance.map((s,i)=><li key={i}>{s}</li>)}</ul></>}
      {selectedNode.data.detail&&<><h3>节点设计字段 · 非公共DTO</h3><pre>{JSON.stringify({inputs:selectedNode.data.detail.inputFields,outputs:selectedNode.data.detail.outputFields,condition:selectedNode.data.detail.condition,joinMode:selectedNode.data.detail.joinMode,required:selectedNode.data.detail.required,effect:selectedNode.data.detail.effectType,model:selectedNode.data.detail.modelAssignment,evidence:selectedNode.data.detail.evidenceRequirement,failureRoute:selectedNode.data.detail.failureRoute},null,2)}</pre></>}
     </>:<>
      <p>{selectedNode.data.subtitle}</p><h3>执行与恢复契约</h3><ul>{(SHARED_DETAILS[selectedNode.id]||[]).map((s,i)=><li key={i}>{s}</li>)}</ul>
      {selectedNode.id==='MODELS'&&<><h3>默认模型候选 · 配置入口保留</h3><ul>{MODEL_CATALOG.map(model=><li key={model.id}><strong>{model.name} · {model.vendor}</strong><small>{model.role}；{model.native}</small></li>)}</ul></>}
     </>}
    </>}
   </aside>}
  </div>
  <div className="overview-legend"><span><i style={{background:COLORS.flow}}/>依赖 / 条件（默认串行）</span><span><i style={{background:COLORS.decision}}/>AgentArts Agent/Workflow</span><span><i style={{background:COLORS.evidence}}/>本地Runtime Evidence / 读回</span><span><i style={{background:COLORS.shadow}}/>按需影子 · 历史实测串行</span><span><i style={{background:COLORS.platform}}/>AgentArts已验与缺项分开</span></div>
  <div className="overview-sources">模型文档依据：{MODEL_SOURCES.map(s=><a key={s.url} href={s.url} target="_blank" rel="noreferrer">{s.label}</a>)}<span>本地打包静态查看页，无模型调用、账号连接或执行循环。</span></div>
 </section>;
}
export function WorkflowOverview(){return <ReactFlowProvider><OverviewBody/></ReactFlowProvider>;}

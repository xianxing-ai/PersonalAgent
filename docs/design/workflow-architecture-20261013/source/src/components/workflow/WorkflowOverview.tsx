import { memo, useMemo, useState } from 'react';
import type { Node, Edge, NodeProps, NodeTypes } from '@xyflow/react';
import { ReactFlow, ReactFlowProvider, Background, Controls, MiniMap, Handle, Position, MarkerType, useReactFlow } from '@xyflow/react';
import { ALL_FEATURES } from '../../data/architectureFeatures';
import { OVERVIEW_COLUMNS, OVERVIEW_LINKS, SHARED_NODES, INTERFACE_NOTES } from '../../data/overview';
import { MODEL_SOURCES, MODEL_CATALOG } from '../../data/models';
import { SHARED_DETAILS, LATENCY_DESIGN, FINAL_DESIGN_STATUS } from '../../data/architectureNotes';
import type { ArchitectureNode } from '../../data/architectureFeatures';

type GraphData = Record<string, unknown> & {label:string; subtitle:string; kind:string; featureId?:string; count?:number; expanded?:boolean; detail?:ArchitectureNode};
const COLORS: Record<string,string> = {flow:'#64748b',decision:'#a78bfa',evidence:'#34d399',shadow:'#fbbf24'};
const FlowCard = memo(({data, selected}:NodeProps<Node<GraphData>>) => (
  <div className={'overview-node '+(selected?'selected':'')} data-feature-code={data.featureId || undefined} title={data.label}>
    <Handle type="target" position={Position.Left} id="in" />
    <Handle type="source" position={Position.Right} id="out" />
    <div className="overview-node-meta">{data.featureId || (data.kind==='decision'?'国产决策':'共用路径')}<span>{data.detail ? '架构节点' : data.count !== undefined ? data.count+' 节点' : '设计'}</span></div>
    <div className="overview-node-title">{data.label}</div>
    <div className="overview-node-subtitle">{data.subtitle}</div>
  </div>
));
const nodeTypes:NodeTypes = {overview:FlowCard};

// 有界拓扑布局。恢复边可以成环，不能使用无限递推队列。
function ranks(nodes:ArchitectureNode[], edges:{source:string;target:string}[]) {
  const known=new Set(nodes.map(n=>n.id)), degree=new Map(nodes.map(n=>[n.id,0])), next=new Map(nodes.map(n=>[n.id,[] as string[]]));
  edges.forEach(e=>{if(known.has(e.source)&&known.has(e.target)){degree.set(e.target,degree.get(e.target)!+1);next.get(e.source)!.push(e.target);}});
  const level=new Map<string,number>(), queue=nodes.filter(n=>degree.get(n.id)===0).map(n=>n.id);
  queue.forEach(id=>level.set(id,0));
  for(let i=0;i<queue.length;i++) for(const target of next.get(queue[i]) || []) {level.set(target,Math.max(level.get(target)||0,(level.get(queue[i])||0)+1));degree.set(target,degree.get(target)!-1);if(degree.get(target)===0)queue.push(target);}
  nodes.forEach((n,i)=>{if(!level.has(n.id))level.set(n.id,i);});
  return level;
}

function makeGraph(expanded:Set<string>, selected:string|undefined, showDecisions:boolean, pathMode:'all'|'realtime'|'background') {
  const nodes:Node<GraphData>[] = [], edges:Edge[] = [];
  let x=0;
  OVERVIEW_COLUMNS.forEach(column=>{
    const width=column.ids.some(id=>expanded.has(id))?680:300;
    let y=0;
    column.ids.forEach(id=>{
      const f=ALL_FEATURES.find(item=>item.id===id)!;
      const scenario=f;
      nodes.push({id,type:'overview',position:{x,y},data:{label:f.name,subtitle:column.title,kind:'flow',featureId:id,count:scenario.nodes.length,expanded:expanded.has(id)},selected:selected===id});
      if(expanded.has(id)) {
        const level=ranks(scenario.nodes,scenario.edges), perLevel=new Map<number,number>();
        scenario.nodes.forEach(detail=>{
          const rank=level.get(detail.id)||0, lane=perLevel.get(rank)||0;perLevel.set(rank,lane+1);
          nodes.push({id:id+'::'+detail.id,type:'overview',position:{x:x+lane*285,y:y+140+rank*140},data:{label:detail.label,subtitle:detail.kind==='semantic_decision'?'唯一国产模型给出语义建议':detail.kind==='wait_user'?'当前问题 + 版本 + 参数绑定':detail.kind,kind:'flow',featureId:id,detail},selected:selected===id+'::'+detail.id});
        });
        const keys=new Set(scenario.nodes.map(n=>n.id));
        scenario.edges.forEach(e=>{if(keys.has(e.source)&&keys.has(e.target))edges.push({id:id+'::'+e.id,source:id+'::'+e.source,target:id+'::'+e.target,sourceHandle:'out',targetHandle:'in',label:e.branchLabel,style:{stroke:'#38bdf8',strokeWidth:1.5},markerEnd:{type:MarkerType.ArrowClosed,color:'#38bdf8'}});});
        const roots=scenario.nodes.filter(n=>n.dependencies.length===0);
        (roots.length?roots:[scenario.nodes[0]]).filter(Boolean).forEach(n=>edges.push({id:id+'::entry::'+n.id,source:id,target:id+'::'+n.id,sourceHandle:'out',targetHandle:'in',style:{stroke:'#38bdf8'}}));
        y+=140+(Math.max(...level.values(),0)+1)*140+70;
      } else y+=145;
    });
    x+=width;
  });
  SHARED_NODES.forEach((n,i)=>nodes.push({id:n.id,type:'overview',position:{x,y:i*145},data:{label:n.label,subtitle:n.subtitle,kind:n.kind},selected:selected===n.id}));
  if (expanded.size === 0) {
    const order=['F01','F03','F28','F24','F02','F04','F05','F27','F08','F09','F10','F12','F11','F07','F06','F13','F19','F17','F15','F16','F18','F20','F14','F21','F25','F26','F22','F23'];
    nodes.forEach(n=>{
      const index=order.indexOf(n.id);
      if(index>=0)n.position={x:Math.floor(index/4)*240,y:(index%4)*125};
      else {const i=SHARED_NODES.findIndex(item=>item.id===n.id);n.position={x:120+(i%4)*360,y:535+Math.floor(i/4)*125};}
    });
  }
  OVERVIEW_LINKS.forEach(([source,target,label,kind],i)=>{
    if(kind==='decision'&&!showDecisions)return;
    const related=selected&&(source===selected||target===selected||source===selected.split('::')[0]||target===selected.split('::')[0]);
    const color=COLORS[kind];
    edges.push({id:'relation-'+i,source,target,sourceHandle:'out',targetHandle:'in',label:related?label:undefined,type:'smoothstep',style:{stroke:color,strokeWidth:related?2.5:1.8,opacity:selected?(related?1:0.1):(kind==='decision'?0.32:0.65),strokeDasharray:kind==='decision'||kind==='shadow'?'6 5':undefined},labelStyle:{fill:'#e2e8f0',fontSize:12},labelBgStyle:{fill:'#111827',fillOpacity:0.96},markerEnd:{type:MarkerType.ArrowClosed,color}});
  });
  if(pathMode!=='all') {
    const active=new Set(pathMode==='realtime'?['USER','F01','F02','F03','F24','F28','DECISION','MODELS','POLICY','TOOL','EVIDENCE','VERIFY']:['EVENT','F04','F05','F09','F10','F12','F22','F23','F26','F27','DECISION','MODELS','F24','EVIDENCE']);
    nodes.forEach(n=>{n.style={opacity:active.has(n.data.featureId || n.id)?1:0.25};});
    edges.forEach(e=>{if(!active.has(e.source.split('::')[0])||!active.has(e.target.split('::')[0]))e.style={...e.style,opacity:0.07};});
  }
  return {nodes,edges};
}

function OverviewBody() {
  const flow=useReactFlow();
  const [expanded,setExpanded]=useState<Set<string>>(new Set());
  const [selected,setSelected]=useState<string>();
  const [showDecisions,setShowDecisions]=useState(true);
  const [panelOpen,setPanelOpen]=useState(false);
  const [pathMode,setPathMode]=useState<'all'|'realtime'|'background'>('all');
  const [showLatency,setShowLatency]=useState(false);
  const graph=useMemo(()=>makeGraph(expanded,selected,showDecisions,pathMode),[expanded,selected,showDecisions,pathMode]);
  const selectedNode=graph.nodes.find(n=>n.id===selected), f=ALL_FEATURES.find(item=>item.id===selectedNode?.data.featureId);
  const scenario=f;
  const templateCount=ALL_FEATURES.reduce((sum,item)=>sum+item.nodes.length,0);
  const fit=()=>flow.fitView({padding:0.06,duration:300});
  const expand=(ids:string[])=>{setExpanded(new Set(ids));setSelected(undefined);setPanelOpen(false);};
  const connections=OVERVIEW_LINKS.filter(([s,t])=>s===f?.id||t===f?.id);
  return <section className="overview-shell" aria-label="全部28个功能连通总图">
    <div className="overview-toolbar">
      <div><h1>全部工作流 · 一张连通图</h1><p>28 个功能 · {templateCount} 个详细架构节点 · 共用决策、执行、语音与影子路径</p></div>
      <div className="overview-actions">
        {(['all','realtime','background'] as const).map(mode=><button key={mode} aria-pressed={pathMode===mode} onClick={()=>setPathMode(mode)}>{mode==='all'?'全部路径':mode==='realtime'?'实时路径':'后台路径'}</button>)}
        <button aria-pressed={showLatency} onClick={()=>setShowLatency(!showLatency)}>延迟与最终设计</button>
        <button onClick={()=>expand(ALL_FEATURES.map(item=>item.id))}>展开全部节点</button>
        <button onClick={()=>expand([])}>收起为功能总览</button>
        <button onClick={fit}>适应全部</button>
        <label><input type="checkbox" checked={showDecisions} onChange={e=>setShowDecisions(e.target.checked)}/> 决策连线</label>
      </div>
    </div>
    <div className="overview-caption">这是最终主架构图。点击功能查看完整依赖与现有接口适配；拖动和缩放查看全图。生产接线及真实延迟尚未验收。</div>
    {showLatency&&<div className="architecture-latency"><strong>{FINAL_DESIGN_STATUS}</strong><ul>{LATENCY_DESIGN.map((line,i)=><li key={i}>{line}</li>)}</ul></div>}
    <div className="overview-body">
      <div className="overview-canvas">
        <ReactFlow key={expanded.size===ALL_FEATURES.length?'expanded':expanded.size===0?'compact':'partial'} nodes={graph.nodes} edges={graph.edges} nodeTypes={nodeTypes} fitView fitViewOptions={{padding:0.06}} minZoom={0.025} maxZoom={2.5} nodesDraggable={false} nodesConnectable={false} onNodeClick={(_,node)=>{setSelected(node.id);setPanelOpen(true);}} onPaneClick={()=>{setSelected(undefined);setPanelOpen(false);}} proOptions={{hideAttribution:true}}>
          <Background color="#1c2a42" gap={24}/><Controls/>{expanded.size>0&&<MiniMap pannable zoomable nodeColor={node=>COLORS[String(node.data.kind)]||'#64748b'}/>}
        </ReactFlow>
      </div>
      {panelOpen&&selectedNode&&<aside className="overview-detail">
        <button className="overview-close" onClick={()=>setPanelOpen(false)} aria-label="关闭总图详情">×</button>
        <div className="overview-kicker">{f?.id || '共用路径'} · 最终设计 / 待接线</div>
        <h2>{selectedNode.data.label}</h2>
        {f?<>
          <p>{f.summary}</p>
          <div className="overview-adapter"><strong>现有代码适配</strong><p>{INTERFACE_NOTES[f.id]||'复用已定义的公开能力与 Runtime / ModelGateway / ToolGateway。此功能的真实可用性未在本轮验收。'}</p></div>
          <div className="overview-actions"><button onClick={()=>{setExpanded(prev=>{const next=new Set(prev);if(next.has(f.id)){next.delete(f.id);}else{next.add(f.id);}return next;});}}>{expanded.has(f.id)?'收起此功能':'在本图展开节点'}</button><button onClick={()=>flow.setCenter(selectedNode.position.x+110,selectedNode.position.y+60,{zoom:1,duration:300})}>定位此功能</button></div>
          <h3>语义决策点</h3><ul>{f.decisionPoints.map((text,i)=><li key={i}>{text}</li>)}</ul>
          <h3>完整功能流程 · {scenario?.nodes.length} 节点</h3><ol>{scenario?.nodes.map(n=><li key={n.id}><button className="overview-text-button" onClick={()=>{setExpanded(prev=>new Set([...prev,f.id]));setSelected(f.id+'::'+n.id);}}>{n.label}</button><small>{n.dependencies.length?'前置：'+n.dependencies.join('、'):'入口 / 独立分支'} · {n.kind}</small></li>)}</ol>
          <h3>与其他流程的连接</h3><ul>{connections.filter(([, , ,kind])=>kind!=='decision').map(([s,t,label],i)=><li key={i}><strong>{s} → {t}</strong><small>{label}</small></li>)}</ul>
          <h3>失败、取消与恢复</h3><ul>{f.recovery.map((line,i)=><li key={i}>{line}</li>)}</ul>
          {selectedNode.data.detail&&<><h3>节点输入、输出与调用契约</h3><pre>{JSON.stringify({inputs:selectedNode.data.detail.inputFields,outputs:selectedNode.data.detail.outputFields,model:selectedNode.data.detail.modelAssignment,evidence:selectedNode.data.detail.evidenceRequirement},null,2)}</pre></>}
        </>:<><p>{selectedNode.data.subtitle}</p><h3>执行与恢复契约</h3><ul>{(SHARED_DETAILS[selectedNode.id]||[]).map((line,i)=><li key={i}>{line}</li>)}</ul>{selectedNode.id==='MODELS'&&<><h3>默认模型配置（不是封锁名单）</h3><ul>{MODEL_CATALOG.map(model=><li key={model.id}><strong>{model.name} · {model.vendor}</strong><small>{model.role}；{model.native}</small></li>)}</ul></>}</>}
        <h3>三个影子模式</h3><ul><li>决策影子：比较判断，不证明反事实结果。</li><li>轨迹回放：缺少工具返回时标未知，不读未来信息。</li><li>隔离执行：独立合成状态，不写主任务或消费主授权。</li></ul>
      </aside>}
    </div>
    <div className="overview-legend"><span><i style={{background:COLORS.flow}}/>功能调用 / 条件分支</span><span><i style={{background:COLORS.decision}}/>唯一国产模型语义建议（虚线）</span><span><i style={{background:COLORS.evidence}}/>执行证据 / 读回</span><span><i style={{background:COLORS.shadow}}/>隔离影子 / 改进（虚线）</span><span>默认国产模型 · 配置自由 · 不新增限制</span></div>
    <div className="overview-sources">模型文档依据：{MODEL_SOURCES.map(source=><a key={source.url} href={source.url} target="_blank" rel="noreferrer">{source.label}</a>)}<span>静态架构查看页，无模型调用及执行循环。</span></div>
  </section>;
}
export function WorkflowOverview(){return <ReactFlowProvider><OverviewBody/></ReactFlowProvider>;}

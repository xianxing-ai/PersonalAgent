// Generate viewer data from a fixed, committed design. Never executes product code.
import fs from 'node:fs';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const repo=process.argv[2];
if(!repo)throw Error('Pass the trusted repository path');
const sha='abb70879d5eb8c41451b89570978e2f454d4b93f';
const read=relative=>execFileSync('git',['-C',repo,'show',`${sha}:${relative}`],{encoding:'utf8'});
const sourcePaths={design:'docs/design/CURRENT_DESIGN_20261015.md',workflows:'docs/design/WORKFLOW_STATUS_20261015.md',wiring:'docs/competition/COLLABORATOR_WIRING_PACKAGE.md',modules:'docs/modules/CURRENT_MOD_WIRING_HANDOFF.md'};
const docs=Object.fromEntries(Object.entries(sourcePaths).map(([key,p])=>[key,read(p)]));
const rows=text=>text.split(/\r?\n/).filter(l=>l.startsWith('| ')).map(l=>l.split('|').slice(1,-1).map(c=>c.trim()));
const workflows=rows(docs.workflows).filter(r=>/^F\d\d /.test(r[0])).map(r=>({id:r[0].slice(0,3),title:r[0],design:r[1],status:r[2]}));
const workPackages=rows(docs.wiring).filter(r=>/^CW-\d\d /.test(r[0])).map(r=>({title:r[0],ports:r[1],consumer:r[2],status:r[3]}));
const modules=rows(docs.modules).filter(r=>/^MOD-/.test(r[0])).map(r=>({title:r[0],ports:r[1],consumer:r[2],tests:r[3],status:r[4],evidence:r[5]}));
if(workflows.length!==28||workPackages.length!==10||modules.length!==39)throw Error(`Unexpected committed source coverage ${workflows.length}/${workPackages.length}/${modules.length}`);
fs.writeFileSync(path.join(root,'src/data/currentDesign.generated.json'),JSON.stringify({sha,date:'2026-10-15',sourcePaths,workflows,workPackages,modules},null,2)+'\n');
const replacements=[
 ['全部业务工作流和Laya multilingual服务/权重迁入自有镜像','Competition由AgentArts构建与编排Agent/Workflow；本地Runtime经CloudAgentPort调用部署版本'],
 ['Laya在镜像内裁决','Competition主链由AgentArts Agent/Workflow编排，本机Laya仅属可选Local实验'],
 ['唯一全局语义决策配置','AgentArts Competition Agent/Workflow编排'],
 ['唯一主决策配置','AgentArts Competition编排'],
 ['唯一主模型','AgentArts Agent/Workflow'],['主模型','Competition Agent/Workflow'],
 ['独立分支并行','独立依赖分支（当前Engine默认串行；机会并行待验）'],
 ['独立分类、资料查询与草稿生成并行','独立分类、资料查询与草稿依赖；当前Engine串行推进'],
 ['线程A：','分支A：'],['线程B：','分支B：'],
 ['并行调研','独立分支调研（当前串行）'],
 ['严格遵循午休保护偏好','按用户实际偏好和时区处理'],
 ['低信噪比丢弃或保留观察','证据不足保留不确定性；未订阅不等于无关'],
 ['多任务并发完成时的通知收敛器','同一NotificationService的feed/层级静默与用户可调打扰策略'],
];
function clean(value){if(typeof value==='string'){for(const[a,b]of replacements)value=value.replaceAll(a,b);return value;}if(Array.isArray(value))return value.map(clean);if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).map(([k,v])=>[k,clean(v)]));return value;}
const architecture=clean(JSON.parse(fs.readFileSync(path.join(root,'src/data/architecture.json'),'utf8')));
for(const f of architecture){
 const current=workflows.find(w=>w.id===f.id); if(!current)throw Error(f.id);
 f.summary=current.design;
 f.designNotes=[`当前实现/实测边界：${current.status}`,'Competition目标由AgentArts承担Agent/Workflow构建、编排、评估和部署；本地Runtime经CloudAgentPort调用部署版本并保留授权执行与Evidence。','本机Laya/自有镜像结果是历史实测，不证明Competition平台编排验收；Competition失败不得静默回退Local。','该图默认串行；图中独立依赖、分支与join是控制关系，不等于已实际并发。',...(f.designNotes||[]).filter(n=>!n.startsWith('当前实现/实测边界：')&&!n.startsWith('Competition目标由AgentArts')&&!n.startsWith('本机Laya/自有镜像结果是历史实测')&&!n.startsWith('该图默认串行；'))];
 f.recovery=['沿原task/session/revision/deadline与checkpoint恢复；取消受理不等于执行已停止。','结果未知的写入保留原operation先读回，不换ID重放。','最小修复/依赖重规划算法仍暂停交接；不由本查看器定义新自动重试策略。'];
 for(const n of f.nodes){
  if(n.modelAssignment){
   n.modelAssignment=(n.kind==='semantic_decision'||n.modelAssignment.vendor==='Laya'||n.modelAssignment.vendor==='受信候选选择')?{vendor:'AgentArts',model:'AgentArts Agent/Workflow',role:'Competition编排由AgentArts承担；本地Runtime负责Policy授权和工具执行'}:{vendor:'可信ModelGateway配置',model:'经AgentArts部署工作流调用；实际模型按平台读回记录',role:n.modelAssignment.role,thinkingLevel:'原生参数按provider实际支持；预算不等于思考深度'};
   n.label=n.label.replace(/Qwen|GLM|DeepSeek/g,'配置执行模型');
  }
  n.label=n.label.replaceAll('并行启动','依赖就绪后串行推进').replaceAll('并行派发','依赖派发（当前串行）').replaceAll('就绪节点并行','就绪节点默认串行').replaceAll('并行','独立依赖（默认串行）').replaceAll('Laya从候选中选择','AgentArts Agent/Workflow编排').replaceAll('合格Laya/未合格配置执行模型选择','AgentArts Agent/Workflow编排').replaceAll('Laya选择','AgentArts Agent/Workflow编排').replaceAll('唯一决策模型','AgentArts Agent/Workflow');
  const suffix='节点字段是展示设计；真实执行须原Policy/ToolGateway/Evidence，不把目录/签名/模型自报当完成。';
  if(!n.evidenceRequirement?.includes(suffix))n.evidenceRequirement=[n.evidenceRequirement||'',current.status,suffix].filter(Boolean).join(' ');
 }
}
const labelSets={
 F12:['来源事件入feed并保留版本/撤回','读取global→connector→responsibility当前策略','合格候选/教师判断重要性；不授新权限','原子reserve同round额度→发送前复检→渠道receipt','独立read ack与有效归来digest；unknown核实不重发'],
 F22:['固定同任务/基线/来源版本与验收条件','高级开关并入已有候选选择与风险/价值判断','按可信机会资源选择decision_shadow/trace_replay/isolated','主结果优先；显式比较才等待双方','隔离执行不借用主授权或写主记忆','只读replay历史read复用，历史write仅timeline','同条件独立验证，缺反事实unknown','记录实际收益/资源/调用/失败与Evidence','可比结果交F23；当前实测main后shadow串行'],
 F23:['可信验收配置/同task-session-revision-deadline比较','验签与完整verifyComparable上下文；不是授权','原Policy/ToolGateway对configuration port授权','revision CAS晋升→真实读回→原operation核实','回滚绑定原版本并保留双方；无port unavailable'],
};
for(const[id,labels]of Object.entries(labelSets)){const f=architecture.find(x=>x.id===id);labels.forEach((l,i)=>{const n=f.nodes.find(n=>n.id===`${id}_N${String(i+1).padStart(2,'0')}`);n.label=l;});}
function node(id,label,kind,effect,inputFields,outputFields,extra={}){
 const f=architecture.find(f=>id.startsWith(f.id+'_')),n=f.nodes.find(n=>n.id===id);
 Object.assign(n,{label,kind,effectType:effect,inputFields,outputFields,resourceKeys:[],...extra});
 n.evidenceRequirement=`${workflows.find(w=>w.id===f.id).status} 节点字段是展示设计而非公共DTO；保留真实Policy/执行/Evidence/读回，未配置能力unavailable。`;
 if(kind!=='semantic_decision'&&kind!=='execution_model')delete n.modelAssignment;
 n.failureRoute='沿原失败/unknown回执返回Host；缺port unavailable，不自动重放写入。';
}
node('F12_N01','来源事件持久feed，保留source/revision/撤回','input','持久状态',['eventRefs','sourceVersion','responsibilityRefs'],['itemId','unread','eventRefs']);
node('F12_N02','读取global→connector→responsibility当前策略','deterministic_check','读取',['scopeRefs','policyRevision'],['mode','maxInterruptions','windowMinutes','silentUntilUtc','preferredChannel','allowUrgentBreakthrough','digestMode','quietHours']);
node('F12_N03','候选重要性与当前通知策略分流；不授权限','semantic_decision','读取',['itemId','classificationRef','currentPolicy'],['feed_only / may_attempt_delivery','decisionRefs']);
node('F12_N04','原子reserve同round→最新策略复检→实际渠道receipt','tool_exec','授权投递/持久状态',['itemId','roundId','policyRevision','currentChannel','原授权'],['reservationRef','sending / confirmed / unknown','receiptRef'],{required:false,condition:'当前策略允许打扰且渠道授权有效'});
node('F12_N05','静默feed/独立read ack与有效return digest','complete','持久状态/读取',['itemId','unread','deliveredAt','readAck','仍有效变化'],['done / changed / pending / blocked','digestRef'],{required:false,condition:'查询/归来摘要；静默不补弹旧通知'});
node('F22_N09','高级开关/风险价值/可信机会资源；主任务优先','deterministic_check','读取',['trustedSettings','resources','taskIdentity'],['eligible / defer / skip / need_teacher']);
node('F22_N01','冻结同基线snapshot/asOf/sourceVersions与原验收','input','读取',['task/session/revision/deadline','snapshot','asOf','sourceVersions'],['frozenComparisonInput']);
node('F22_N02','同次候选value.shadowPlan选择模式与启动意图','semantic_decision','读取',['frozenComparisonInput','trustedResources','已有判断上下文'],['decision_shadow / trace_replay / isolated','decisionRef']);
node('F22_N03','decision_shadow仅比较选择，不实际执行工具','deterministic_check','纯判断结果',['sealedCandidates','decisionRef'],['shadowDecision','comparisonRefs'],{required:false,condition:'选择decision_shadow'});
node('F22_N04','trace_replay只读历史；write仅timeline不重放','tool_exec','历史读取（无工具副作用）',['frozenSnapshot','historicalRecords','requestedActions','sourceVersions'],['replay_result','timeline','historical failed / unknown'],{required:false,condition:'选择trace_replay；F22历史adapter须显式绑定public replay服务'});
node('F22_N05','isolated同基线/namespace/权限执行并独立验证','tool_exec','隔离环境授权副作用',['baselineSHA','isolationProof','验收合同','隔离授权'],['branchReceipt','EvidenceRefs','currentSHA'],{required:false,condition:'选择isolated且真实隔离能力与授权可用'});
node('F22_N06','核对replay可比性，缺反事实/failed/unknown保留原态','verification','读取',['replay_result','历史完整性/来源版本'],['comparable / partial / unknown / not_comparable','reasonRefs'],{required:false,condition:'选择trace_replay；完整与缺失记录均核对后汇合'});
node('F22_N07','按已选模式汇合可比结果；显式比较才等双方','join','读取',['selectedMode','mainReceipt','shadowReceipt','验收配置'],['comparable / partial / unknown','pairRefs'],{joinMode:'selected'});
node('F22_N08','记录实际收益/资源/失败，候选交原F23','complete','持久状态',['pairRefs','latency','calls','tokens','EvidenceRefs'],['comparisonHistory','candidateRef']);
node('F23_N01','可信验收配置/同task-session-revision-deadline比较','input','读取',['mainReceipt','shadowReceipt','task/session/revision/deadline','acceptanceConfig'],['candidatePair','comparisonContext']);
node('F23_N02','验签与verifyComparable完整上下文；不是授权','deterministic_check','读取',['candidatePair','comparisonContext','trustedVerifier'],['verifiedComparable / rejected','reasonRefs']);
node('F23_N03','原Policy/ToolGateway授权configuration port','tool_exec','授权校验/读取',['verifiedComparable','configurationPort','expectedRevision','argumentsDigest','授权scope'],['authorizedReleaseRequest / unavailable']);
node('F23_N04','revision CAS晋升并保留原operation','tool_exec','授权配置写入',['authorizedReleaseRequest','expectedRevision','candidateVersion','sideEffect声明'],['operationId','applied / conflict / unknown']);
node('F23_N05','真实回读；必要回滚仍核原版本与授权','complete','读取/有条件授权配置回滚',['operationId','actualConfigurationRevision','readbackPort','原回滚授权'],['verifiedReadback / waiting_reconciliation / conflict','rollbackAnchor原版本/参数digest','rollbackReceipt']);
for(const f of architecture){
 f.designNotes=f.designNotes.map(s=>s.replaceAll('默认国内MaaS','当前DeepSeek经AgentArts代理（平台后端MaaS如实记录，无客户端直连fallback）').replaceAll('同一决策配置可以并发处理独立判断','同一决策配置可提出独立判断；真实串行/合批能力分别验收'));
 if(['F12','F22','F23'].includes(f.id))for(const e of f.edges){e.branchLabel=architecture.find(f=>e.target.startsWith(f.id+'_')).nodes.find(n=>n.id===e.target).condition||'沿当前选择/原授权推进';}
}
fs.writeFileSync(path.join(root,'src/data/architecture.json'),JSON.stringify(architecture,null,2)+'\n');
console.log(JSON.stringify({sha,workflows:workflows.length,nodes:architecture.reduce((s,f)=>s+f.nodes.length,0),workPackages:workPackages.length,modules:modules.length}));

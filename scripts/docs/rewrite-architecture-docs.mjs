// Emit apply_patch input; source edits are applied through the patch tool.
// This documents-only migration preserves historical receipts and public contracts.
import fs from 'node:fs';
import path from 'node:path';
import {execFileSync} from 'node:child_process';

const root = path.resolve(import.meta.dirname, '../..');
const design = 'docs/design/workflow-architecture-20261013';
const original = file => fs.readFileSync(path.join(root, file), 'utf8').replace(/\r\n?/g, '\n');
const updates = new Map();
const set = (file, text) => updates.set(file, text.trim() + '\n');
const features = JSON.parse(original(`${design}/source/src/data/architecture.json`));
const all = features.map(f => f.id);
const definitions = [
 ['MOD-01','工程与存储底座','goo122',['packages/storage'],['F24','F25','F26']],
 ['MOD-02','公共契约与客户端','goo122',['packages/contracts','packages/client','packages/testkit'],['F01','F02','F24','F25','F28']],
 ['MOD-03','任务Runtime与调度','goo122',['apps/runtime'],['F01','F03','F06','F12','F24']],
 ['MOD-04A','模型网关与Provider','goo122',['packages/models'],['F23','F27','F28']],
 ['MOD-04B','协调与云端口','zemeng5208',['packages/coordination','packages/agents'],['F01','F03','F28']],
 ['MOD-05','Policy、工具与连接器宿主','goo122',['packages/policy','packages/tool-gateway','packages/connector-host'],['F02','F14','F15','F21','F24','F25']],
 ['MOD-06','本地MCP','goo122',['packages/mcp'],['F21']],
 ['MOD-07','Skills安装与执行','goo122',['packages/skills'],['F21','F23']],
 ['MOD-08','知识、Wiki与Obsidian','goo122',['packages/knowledge','apps/obsidian-plugin'],['F04','F05']],
 ['MOD-09','版本化记忆与流程学习','goo122',['packages/memory','packages/learning'],['F04','F05','F23','F27']],
 ['MOD-10','模型能力与训练研究','zemeng5208',['docs/research/agentarts'],['F23','F28']],
 ['MOD-11','Desktop外壳与桥接','zemeng5208',['apps/desktop/electron','apps/desktop/src/app'],['F01','F02','F12']],
 ['MOD-12','悬浮球与对话面板','zemeng5208',['apps/desktop/src/features/orb','apps/desktop/src/features/conversation'],['F01','F12','F24']],
 ['MOD-13','管理后台与配置展示','zemeng5208',['apps/desktop/src/features/admin','apps/desktop/src/ui'],['F22','F23','F25','F26','F27','F28']],
 ['MOD-14','语音会话与确认接线','zemeng5208',['packages/voice','apps/desktop/src/features/voice'],['F02']],
 ['MOD-15','唤醒与连续语音','zemeng5208',['packages/voice-wake'],['F02']],
 ['MOD-16','Windows执行与凭据适配','zemeng5208',['apps/windows-host','packages/windows-client'],['F14','F25']],
 ['MOD-17','本机状态读取','zemeng5208',['packages/windows-client'],['F13']],
 ['MOD-18','工作区补丁与命令工具','zemeng5208',['packages/coding-tools'],['F15','F17']],
 ['MOD-19','打包与安装','zemeng5208',['packaging','scripts/release'],['F26']],
 ['MOD-20','待办与日历','Potatos498',['packages/productivity','packages/connectors/calendar'],['F06','F07']],
 ['MOD-21','邮件连接器','Potatos498',['packages/connectors/mail'],['F08']],
 ['MOD-22','订阅采集','Potatos498',['packages/connectors/feeds'],['F09']],
 ['MOD-23','通知汇总策略','Potatos498',['packages/notifications'],['F12']],
 ['MOD-24','研究与资料获取','Potatos498',['packages/connectors/research'],['F10']],
 ['MOD-25','天气','Potatos498',['packages/connectors/weather'],['F11']],
 ['MOD-26','可选社交能力','Potatos498',[],['F09','F12','F21']],
 ['MOD-27','目标与依赖图','zemeng5208',['packages/goals'],['F01','F03']],
 ['MOD-28','持续认知与唯一决策消费','zemeng5208',['packages/cognition'],all],
 ['MOD-29','AgentArts镜像与云基础','zemeng5208',['packages/agentarts','apps/agentarts-runtime'],['F26','F28']],
 ['MOD-30','云Workflow与工具提案','zemeng5208',['packages/agentarts'],all],
 ['MOD-31','执行模型协作与评估','zemeng5208',['packages/agentarts','apps/runtime/src/application/subagent-host.ts'],['F22','F23','F28']],
 ['MOD-32','云端观测与比赛验收','zemeng5208',['packages/agentarts','tests/manual/agentarts'],['F22','F24','F26']],
 ['MOD-33','GitHub能力底座','goo122',['packages/connectors/github'],['F16','F18','F19','F20']],
 ['MOD-34','CI失败修复','Potatos498',['packages/coding-tools/src/dev-workflows'],['F15','F16','F18']],
 ['MOD-35','测试失败定位','Potatos498',['packages/coding-tools/src/test-locate'],['F16','F17']],
 ['MOD-36','代码评审预审','goo122',['packages/cognition/src/dev-workflows'],['F18']],
 ['MOD-37','API文档一致性','goo122',[],['F20']],
 ['MOD-38','Issue分诊与修复','Potatos498',['packages/cognition/src/dev-workflows'],['F19']],
];
const modules = definitions.map(([id,name,owner,codePaths,workflows]) => ({id,name,owner,codePaths,workflows}));
set(`${design}/modules.json`, JSON.stringify({version:'2026-10-13',profile:'huawei_ict_agentarts',baseline:'3275aa91',scope:'目标责任映射，不是完成度或生产能力声明',modules}, null, 2));
const sourceFor = f => modules.filter(m => m.workflows.includes(f)).map(m => m.id).join('、');
const kind = {input:'输入',semantic_decision:'唯一模型语义建议',execution_model:'执行模型候选',tool_exec:'工具或受信宿主',deterministic_check:'确定性检查',verification:'验证',join:'条件汇合',wait_user:'必要时等待用户',complete:'完成建议/结果',fork:'并行分派'};
const notes = Object.fromEntries([...original(`${design}/source/src/data/overview.ts`).matchAll(/^  (F\d{2}): '([^']+)'/gm)].map(m=>[m[1],m[2]]));
let workflows = '# 28功能完整工作流\n\n由scripts/docs/rewrite-architecture-docs.mjs从已合并架构数据生成。修改流程先改source/src/data/architecture.json，并同步查看器产物；字段名是设计概念，不是公共DTO或已公布capability。当前代码状态以接口目录为准。\n\n[主架构](DESIGN.md) · [总图](index.html) · [模块映射](MODULES.md) · [重构接线](IMPLEMENTATION.md)\n\n';
for (const f of features) {
 workflows += `## ${f.id} ${f.name}\n\n${f.summary}\n\n工程责任：${sourceFor(f.id)}。\n\n### 决策模型参与\n\n${f.decisionPoints.map(p=>`- ${p}`).join('\n')}\n\n### 节点与依赖\n\n`;
 for (const n of f.nodes) {
  workflows += `#### ${n.id} ${n.label}\n\n- 类型：${kind[n.kind]||n.kind}；前置：${n.dependencies.join('、')||'独立入口'}。\n- 汇合要求：${n.required?'本轮必需':'条件/可选'}${n.condition?`；${n.condition}`:''}。\n- 输入概念：${n.inputFields.join('、')||'由当前任务快照与节点上下文提供，具体字段在接线时映射'}。\n- 输出概念：${n.outputFields.join('、')||'节点结果、来源及状态引用，具体字段在接线时映射'}。\n- 资源：${n.resourceKeys.join('、')||'沿用所选宿主资源管理'}；动作性质：${n.effectType}。\n`;
  if(n.evidenceRequirement)workflows+=`- 依据：${n.evidenceRequirement}（设计条件；示例ID不证明已有授权或真实证据）。\n`;
  if(n.modelAssignment)workflows+=`- 模型角色：${n.kind==='semantic_decision'?'同一生效决策配置':n.modelAssignment.role}；模型选择与思考参数是推荐配置，必须通过F28按实际能力映射。\n`;
  workflows+='\n';
 }
 workflows+='### 分支、反馈与恢复边\n\n| 起点 | 终点 | 条件/目的 |\n| --- | --- | --- |\n'+f.edges.map(e=>`| ${e.source} | ${e.target} | ${e.branchLabel||'满足前置后推进'} |`).join('\n')+'\n\n';
 workflows+=`### 失败、取消和接线\n\n${f.recovery.map(s=>`- ${s}`).join('\n')}\n- ${notes[f.id]||'复用对应工程模块公开端口、Runtime/Policy/ToolGateway；现有实现、组合接线及真实目标系统验证分别记录，不由本图提升接口状态。'}\n- 同资源写入排队；结果未知查询原执行与目标状态。用户修改当前操作使旧确认失效，独立分支继续。\n- 节点成功不自动表示任务成功；按本轮所选必需分支、来源版本和Evidence由TaskRuntime确认终态。\n\n`;
}
set(`${design}/WORKFLOWS.md`, workflows);
const perModule = m => `## ${m.id} ${m.name}\n\n负责人：${m.owner}。功能：${m.workflows.join('、')}。\n\n维护入口：${m.codePaths.length?m.codePaths.map(p=>`\`${p}\``).join('、'):'按既有模块登记开工；本轮不创建空生产目录'}。\n\n接线责任：${m.id==='MOD-28'?'将现有有限建议消费逐步迁到唯一云决策配置；Laya代码是待迁移存量，不是新默认。':m.id==='MOD-04A'?'复用ModelPort/ModelGateway，映射真实供应商能力与原生思考参数，并向F27反馈上下文配置版本。':m.id==='MOD-14'?'将主动语音询问、最终转写、问题/参数/revision绑定接到既有授权响应；保留直接本地停止。':m.id==='MOD-31'?'执行模型协作与候选评估；不创建第二个最终语义裁决模型，建立独立影子宿主的能力与证据。':m.id==='MOD-08'?'复用Wiki来源、配对引用、正文写入及恢复；检索来源可追溯，不把跨文件/SQLite称为原子事务。':m.id==='MOD-09'?'提供作用域事实、版本、撤回、投影与流程候选；语义排序和取舍由唯一模型建议，存储与权限由宿主控制。':'复用既有公开契约与宿主注册，将所列功能的节点输入/输出映射到实际能力，交付必要消费接线。'}\n\n验收责任：公开契约和失败/取消夹具、受影响消费者检查、配置缺失不支持、真实场景单独读回。模型/图/文档或Fake通过不能宣布整模块完成。\n\n状态：本表不重新评分、不把历史验收覆盖为未实现；当前工作包与证据见ROADMAP及对应README。\n\n`;
set(`${design}/MODULES.md`, '# 39工程模块与28功能的责任映射\n\n生成依据为本目录modules.json；长期所有权由docs/MODULE_ASSIGNMENTS.md登记。模块名表示目标职责，不代表新增包或部署完成。04A/04B拆分使工程模块共39个。\n\n'+modules.map(perModule).join(''));

set('README.md', `# PersonalAgent

Windows常驻个人助手：用户用文字或语音给出目标，系统在已授权责任内持续判断、并行委派、执行、核实和跟进。云端AgentArts镜像调用国内MaaS，本地Runtime保存任务事实、授权、工具结果与终态。

当前主架构已按28功能方案统一；默认唯一语义决策配置为DeepSeek-V4.1-Flash，执行模型候选优先华为支持的国产模型。模型可配置，不新增白名单或审批限制。主架构定稿与生产重构完成是不同状态。

## 从这里阅读

- [完整主架构](${design}/DESIGN.md)、[28功能逐节点工作流](${design}/WORKFLOWS.md)、[离线连通总图](${design}/index.html)。
- [产品需求](docs/PRD.md)、[系统边界](docs/ARCHITECTURE.md)、[重构工作包](${design}/IMPLEMENTATION.md)。
- [39模块分工](docs/MODULE_ASSIGNMENTS.md)、[接口实际状态](docs/interfaces/CURRENT_INTERFACE_CATALOG.md)、[进度与证据](docs/ROADMAP.md)。
- [Competition Profile](docs/competition/HUAWEI_ICT_AGENTARTS_PROFILE.md)、[公共协议](docs/DEVELOPMENT_PROTOCOL.md)、[协作规范](CONTRIBUTING.md)。

## 当前代码

文档核对基线为main 3275aa91：包含#347架构查看器、#320 Wiki/Skill组合、#332 Windows与补丁恢复等增量。历史固定公开文件场景已有真实Huawei WSS→MaaS→本地Policy/读取/Evidence→续答记录；完整28功能、统一决策迁移、语音确认、影子宿主和端到端延迟仍待逐项验收。本轮只重写文档，不改生产执行链。

当前唯一实施profile为huawei_ict_agentarts；既有Local代码及已授权DEV-WORKFLOWS增量保留，不静默替代比赛路径。TaskRuntime、ModelGateway、Policy、ToolGateway、Evidence和既有记忆/知识端口继续复用。

## 开发入口

版本以.node-version、package.json与锁文件为准。根目录：

    npm ci
    npm run check
    npm run start:desktop

Windows可使用npm.cmd。check执行必要工程门禁；真实模型、账号、语音、设备和比赛验收另见tests/manual。dev、demo:protocol与demo:runtime是开发样例，不能当作生产Agent启动。

架构页index.html可直接离线打开。其source/是独立文档查看器，不是Electron Renderer改用React的声明，也不进入产品根workspace。生成与检查命令见该目录README。

PR需一位合资格非作者对当前提交有效Approve及实际检查、无冲突和意见处理；本轮按用户要求同时请求goo122、Potatos498审核。历史证据保留在原记录和Git，旧Laya/双人阅读设计已被当前入口替代。
`);
set('docs/README.md', `# 项目文档

当前架构版本为2026-10-13，依据已合并#347与用户后续确认。阅读顺序如下：

| 文档 | 回答的问题 |
| --- | --- |
| [当前设计与状态](CURRENT_DESIGN_CONTEXT.md) | 方向、代码基线和未完成事项 |
| [PRD](PRD.md) | 用户能力、需求编号与验收 |
| [主架构](design/workflow-architecture-20261013/DESIGN.md) | 唯一决策、并行图、语音、记忆、影子与云/本地边界 |
| [工作流](design/workflow-architecture-20261013/WORKFLOWS.md) | 28功能全部154个详细节点和条件/恢复边 |
| [总图](design/workflow-architecture-20261013/index.html) | 全部功能在一张图上的连接 |
| [架构契约](ARCHITECTURE.md) | 工程模块、依赖与事实来源 |
| [公共协议](DEVELOPMENT_PROTOCOL.md) | 已发布Schema和待适配设计的关系 |
| [接口目录](interfaces/CURRENT_INTERFACE_CATALOG.md) | frozen/provisional/unavailable与证据 |
| [模块分工](MODULE_ASSIGNMENTS.md) | 39模块与负责人 |
| [目录规范](PROJECT_STRUCTURE.md) | 实际workspace与测试位置 |
| [Competition Profile](competition/HUAWEI_ICT_AGENTARTS_PROFILE.md) | AgentArts实施路径和比赛验证 |
| [重构接线](design/workflow-architecture-20261013/IMPLEMENTATION.md) | 兼容迁移、工作包和验证 |
| [ROADMAP](ROADMAP.md) | 实际执行状态与历史记录 |
| [ADR](adr/README.md) | 长期决定和替代关系 |
| [协作规则](../CONTRIBUTING.md) | 审查、交付与合并 |

[文档清单](design/workflow-architecture-20261013/DOCUMENTATION_INVENTORY.md)覆盖当前规范、模块API说明、历史设计与验收。历史事实不改写成新方案的成功证据；旧设计入口已明确归档，当前规范不再使用Laya默认决策或双人本机阅读门槛。
`);
set('docs/CURRENT_DESIGN_CONTEXT.md', `# 当前设计与实施状态

日期：2026-10-13 · profile：huawei_ict_agentarts · 代码基线：main 3275aa91。

## 当前唯一主架构入口

[完整主架构](design/workflow-architecture-20261013/DESIGN.md) · [28功能流程](design/workflow-architecture-20261013/WORKFLOWS.md) · [连通图](design/workflow-architecture-20261013/index.html) · [39模块](MODULE_ASSIGNMENTS.md) · [重构接线](design/workflow-architecture-20261013/IMPLEMENTATION.md)。

| 事项 | 已定设计 | 当前实现边界 |
| --- | --- | --- |
| 决策 | 唯一语义决策配置，默认华为国内MaaS DeepSeek-V4.1-Flash | 新统一配置及Laya迁移未完成；存量适配保留 |
| 编排 | 事件驱动责任图、稳定模板、真实依赖并行 | Runtime/图/云角色代码可复用，完整28功能图宿主待接线 |
| 模型分派 | 主对话可选择厂商、模型和原生思考；执行者提交候选 | subagentModels与ReasoningEffort已有；Competition参数映射另验收 |
| 语音 | 主动询问、口头同意/拒绝/修改、问题与操作绑定 | Voice/Live代码已有；完整确认与设备场景未验收 |
| 记忆 | Wiki来源+Memory事实，唯一模型参与排序/取舍 | #320组合已合入；生产身份/真实私人出机及完整失效传播仍缺 |
| 影子 | 决策比较、轨迹回放、隔离执行，默认后台 | 轨迹/测试可复用；独立影子宿主待实现 |
| 执行 | 本地Runtime/Policy/ToolGateway/Evidence | 沿用现有端口，不新增授权或第二个任务库 |
| 传输 | WSS主、可见HTTPS备用，未知结果先核实 | 固定读取场景已有真实记录；云回执非持久恢复 |
| 资源/延迟 | 云API默认，不强制本地权重；合批/并行/缓存减少阻塞 | 没有28功能端到端P50/P95；普通语义任务有秒级等待风险 |
| 协作 | 一位合资格非作者有效Approve及检查门槛 | #347已合并；文档重写为新工作包，不自动授权合并 |

设计不增加模型封锁、角色白名单、审批门槛或固定金额/Token/步骤预算；实现依既有授权、用户配置和平台限制。当前接口事实见[接口目录](interfaces/CURRENT_INTERFACE_CATALOG.md)，旧百分比不作为本次重构完成率。
`);
set('docs/ARCHITECTURE.md', `# 系统架构与工程边界

版本：2026-10-13 · 基线：main 3275aa91 · 本轮文档重写，不修改生产协议或运行行为。

## 1. 架构选择

采用事件驱动责任图、唯一语义决策模型、真实依赖并行执行和后台影子。完整依据见[主架构](design/workflow-architecture-20261013/DESIGN.md)，节点数据见[28工作流](design/workflow-architecture-20261013/WORKFLOWS.md)。

默认决策配置通过华为云国内MaaS调用DeepSeek-V4.1-Flash；执行模型候选优先国产。一个生效配置负责所有最终语义取舍，模型池生成候选。代码处理版本、权限、锁、算术和状态，不让每个机械步骤调用云端。模型选择自由配置，不新增限制。

## 2. 进程与事实来源

| 组件 | 所有职责 | 不能越过的边界 |
| --- | --- | --- |
| Electron Renderer | 输入、状态、责任/配置/证据展示 | 不直接调用Provider、Shell、数据库或连接器 |
| Desktop主进程 | 可信配置、凭据适配、IPC、窗口生命周期 | 不复制Runtime执行循环 |
| Runtime Application / TaskRuntime | 受理、分派、持久步骤、取消、恢复、终态 | 模型/UI/连接器不能直接写终态 |
| Coordination / Goal / Cognition | 版本图、影响传播、语义建议消费 | 只通过公开端口读取记忆和提交建议 |
| AgentArts镜像 | Workflow/角色/模型编排、候选与工具提案 | 不持有本机授权或主数据库，不直接控制Windows |
| ModelGateway | Provider能力/配置、调用、取消、期限 | 结构化适配不冒充原生能力 |
| Policy / ToolGateway | 原有授权核验、工具执行与记录 | 模型输出不是授权来源 |
| Knowledge / Memory / Learning | 正文来源、版本事实、可验证流程候选 | 不取代任务库或调度器 |
| Connector / Windows Host | 能力实际执行、目标读回 | 不决定授权、主目标或任务终态 |
| Evidence / Verifier | 实际执行、来源和结果依据 | 模型自报与Schema合法不代表完成 |

当前Desktop是Electron+原生HTML/CSS/JavaScript，Runtime可在主进程装配；文档React查看器不改变产品技术栈。Windows Host与原生Pipe的具体支持范围依实际验收。

## 3. 依赖和端口

apps可依赖packages；packages不反向依赖apps，contracts不依赖内部包，跨包只用exports。具体Provider/连接器仅在可信composition注入。模型统一经过ModelGateway；工具统一经过Runtime/Policy/ToolGateway。

复用CoordinationPort、CloudAgentPort、ModelPort、MemoryQueryPort、FactChangeFeed、KnowledgePort、ToolExecutionPort和已有图存储。类型存在不等于frozen；逐项状态由[接口目录](interfaces/CURRENT_INTERFACE_CATALOG.md)登记。

## 4. 任务与图

F01主对话与事件形成任务；F03找受影响依赖；F27组织上下文；唯一模型选功能与候选；F28分派模型；F24推进就绪分支。F06—F21及F25/F26的具体能力按任务选路，最终经验证汇合。

任务和节点绑定稳定身份、输入/来源/目标revision、配置版本与执行记录。独立只读可并行，同资源写入和桌面输入按现有规则加锁。必需/可选与条件分支分别汇合；恢复只修受影响子图。结果未知先查原操作，不通过重规划重发。

## 5. 责任与语音

沿用已有授权，责任内直接执行，缺范围或关键歧义才问。语音主动播报当前动作摘要；最终转写绑定问题、会话、参数和revision。口头同意走原授权响应，修改使旧确认失效；沉默、回声、旧回答不能放行。停止播报、取消任务和停止新动作不同；本地直接停止不等云端。

## 6. 记忆和上下文

KnowledgePort负责搜索与来源；MemoryQueryPort负责事实版本查询，FactChangeFeed传递变化。唯一模型参与相关性、写入建议、排序、矛盾与摘要取舍；宿主负责访问范围、版本、实际写入、撤回和恢复。

上下文按目标、责任、活跃节点、来源和未解决副作用组织。F28反馈真实模型窗口/参数配置；F27生成可恢复摘要和引用。缓存绑定输入及所有相关版本，来源变化使依赖结果失效；授权仍实时核验。

## 7. 影子、评估与改进

F22三模式默认后台；主运行只读保护、输出命名空间独立、不消费主授权。缺反事实结果标未知，隔离执行条件与可比性有证据。F23改提示/图/调用配置/模型版本，不直接改MaaS远端权重，不以修改测试制造晋升。

## 8. 云部署和通信

huawei_ict_agentarts为当前唯一实施路径，AgentArts真实承担构建/编排/评估/部署。Local及已授权DEV-WORKFLOWS基线保留，不作为云失败的静默回退。WSS为主、HTTPS备用可见，已发送未知不能盲发备用。云回执restartRecovery:false，自动持久恢复不得承诺。

镜像装业务代码、SDK、固定版本和配置引用，默认国内API推理；本机不强制加载权重。国内可执行需分别验证镜像拉取、模型、语音及各连接器真实端点，不能以npm镜像或查看器离线证明全产品网络可用。

## 9. 迁移与验收

保留公共wire 1.0.0、transport 0.1.0和候选版本的既有语义；新概念字段在实施时映射或经版本化扩展。Laya代码是待迁移实现，旧fast/world/plan/review收敛最终裁决入口，具体迁移见[IMPLEMENTATION](design/workflow-architecture-20261013/IMPLEMENTATION.md)。

真实延迟尚未实测，关键路径需分别量受理/首响/工具/完整结果/并发排队。已有固定公开文件云闭环是局部证据；28功能、语音、私人来源、写入、影子和配置晋升分别验收。设计采用见[ADR-0024](adr/0024-unified-decision-workflow-architecture.md)，不新增生产包、任务库或执行循环。
`);
set('docs/PROJECT_STRUCTURE.md', `# 目录与依赖规范

当前架构：2026-10-13。目录按真实进程与公开包组织，28功能不是28个新workspace。

| 位置 | 职责 |
| --- | --- |
| apps/desktop | Electron、可信主进程/Preload和原生页面 |
| apps/runtime | TaskRuntime及application组合、调度/恢复/宿主接线 |
| apps/agentarts-runtime | 自有AgentArts HTTP/WS部署入口 |
| apps/windows-host、packages/windows-client | 原生执行/观测和公开客户端 |
| apps/obsidian-plugin | 只读插件与本机配对 |
| packages/contracts、client、testkit | 单一Schema/生成类型、消费SDK及显式Fake |
| packages/models、coordination、agentarts | 模型入口、云端口适配与云编排 |
| packages/goals、cognition | 版本图、持续影响和语义建议消费 |
| packages/knowledge、memory、learning | 来源正文、事实版本和流程候选 |
| packages/policy、tool-gateway、connector-host | 原有授权、执行和凭据注入 |
| packages/mcp、skills | 本地扩展接入与受控执行 |
| packages/connectors/* | 邮件/日历/订阅/研究/天气/GitHub等Provider |
| packages/productivity、notifications、coding-tools | 业务规范化、通知、工作区和开发工具 |
| docs/design/workflow-architecture-20261013 | 当前主架构、工作流、模块/迁移说明、离线图及独立查看器源码 |
| docs/modules、tests/manual | 现有实现/验收记录与真实验证入口 |

## 放置规则

生产代码在apps/、packages/，连接器在packages/connectors/。根src/不新增生产入口，不创建未开工空模块。普通包保留README、package.json、src与test，跨包通过exports调用。

Runtime application管理任务分派、审批与恢复，Desktop只负责装配和界面。packages不得依赖apps；contracts无内部依赖；具体Provider/Connector在可信composition注入。依赖门禁使用根check:architecture。

根workspace共享package-lock.json。文档查看器source/是独立离线构建项目，其自身锁文件仅属于该工件，不进入产品workspace，也不将其React依赖加到产品。

## 测试与数据

模块测试位于对应workspace/test，跨模块在tests/integration，依赖门禁在tests/architecture，真实账号/模型/设备在tests/manual。按受影响路径选择必要检查；纯文档检查链接、编号、事实及git diff --check，不自动调用真实服务。

数据库、WAL、缓存、凭据与私人数据保留在忽略的用户/项目数据目录，迁移有序且保留数据，不靠清库升级。新工作树登记后使用独立可写数据与端口，禁止硬重置/清理他人文件解决冲突。

## 文档生成

scripts/docs/rewrite-architecture-docs.mjs生成架构重写补丁与28功能/39模块说明；scripts/docs/sync-design-navigation.py生成全仓文档导航补丁。生成文件注明源数据，正文使用补丁工具修改。查看器仍通过其export:offline发布，文档生成不启动模型或产品执行。

历史ADR/验收正文保留，归档入口在当前文档清单；架构版本变化不改写历史作者、PR、测试或真实结果。
`);

const table = modules.map(m=>`| ${m.id} | ${m.name} | ${m.owner} | ${m.codePaths.length?m.codePaths.map(p=>'\`'+p+'\`').join('、'):'未建立生产目录'} | ${m.workflows.join('、')} |`).join('\n');
set('docs/MODULE_ASSIGNMENTS.md', `# 模块分工与交付边界

版本：2026-10-13 · profile：huawei_ict_agentarts。本次保持长期负责人，按新架构重写职责，不转移他人的代码所有权。

goo122负责存储/协议/Runtime/ModelGateway/Policy/工具宿主/知识记忆，以及MOD-33/36/37；zemeng5208负责核心认知、云架构、AgentArts、桌面/语音/Windows和编码工具；Potatos498负责MOD-20—26业务与接线、MOD-34/35/38。每人交付必要端口、实现、消费接线、验证与文档，不将日常验收集中交给一人。

## 39模块与28功能

F编号是产品工作流，MOD编号是工程责任。详细接线说明见[MODULES](design/workflow-architecture-20261013/MODULES.md)。

| 模块 | 当前目标职责 | 负责人 | 主要维护位置 | 工作流 |
| --- | --- | --- | --- | --- |
${table}

## 共享区域与例外

MOD-34/35/38的coding-tools/dev-workflows、test-locate和cognition/dev-workflows/issue-triage由Potatos498负责；MOD-36的code-review由goo122负责，核心cognition仍归zemeng5208。共享exports、Runtime/桌面接线由实际变更人随工作包完成并验证，不反向导入私有源码。

公共Schema、根配置、迁移和根组合由goo122长期维护，但三人可在各自分支提交必要兼容变更及消费测试，不等待独占集成槽。必要跨模块修改说明范围，保留其他人改动；同一物理checkout串行编辑。

## 交付与审查

独立开发可使用契约一致的Fake/Unavailable；缺真实服务只阻止相应真实验收，不阻止可独立实现。授权、付费调用、真实写入与发布按现有授权处理，设计不授予新权限。

状态以ROADMAP登记，接口状态以CURRENT_INTERFACE_CATALOG登记。一个工作包一个负责人/PR，声明profile、拥有文件、依赖、兼容/迁移、验收与剩余问题。当前非作者一人有效Approve即可满足人数要求；按用户要求可同时请求两位审核，不将旧“双人本机阅读”规则恢复为门槛。三人跨PR均衡承担审查与合并，禁止管理员绕过。

Local仅保留既有代码及已经授权的DEV-WORKFLOWS增量，不扩展为第二套默认产品路径。MOD-19发布和MOD-26具体平台开工按已确认范围，不因为本次文档重写自动启动。
`);

const oldCatalog=original('docs/interfaces/CURRENT_INTERFACE_CATALOG.md');
const frozen=oldCatalog.slice(oldCatalog.indexOf('## 3. 已冻结：'),oldCatalog.indexOf('## 4. 已实现但尚未冻结'));
set('docs/interfaces/CURRENT_INTERFACE_CATALOG.md', `# 当前接口目录与冻结登记

版本：2026-10-13 · 代码核对基线：main 3275aa91。本文是接口成熟度及能力登记，不把目标设计转换为可调用API。

## 1. 状态与版本

frozen表示满足单一契约、生产实现、失败夹具、公开消费者、自审/CI及必要真实闭环的兼容承诺；provisional可在固定版本上消费，须记录迁移；unavailable表示未公布能力或缺所需生产语义。Schema/Fake/文档存在不构成能力。

部署profile与冻结集合不同：huawei_ict_agentarts是当前产品实施路径；Core Runtime Profile 1仅是下面的冻结子集。Local/DEV-WORKFLOWS既有实现保留，不静默回退。

本地wire 1.0.0、独立AgentArts transport 0.1.0、Windows内部帧及候选协议均按原单一Schema/解析器；本次不扩字段、枚举、operation、能力或冻结集合。

## 2. 当前main增量与证据

| 面 | 实现/公开消费入口 | 成熟度与验证范围 |
| --- | --- | --- |
| Runtime/工具 | TaskRuntime、application组合、Policy/ToolGateway、检查点与Evidence | 基础冻结子集如下；工具、持续授权和完整图恢复仍provisional |
| 模型 | ModelPort是ModelProvider公开别名，ModelGateway、Pangu/OpenAI-compatible/Live适配 | provisional；能力按真实deployment声明；新默认国内决策配置未接线 |
| 模型分派 | Runtime subagentModels/getModelGateway/getModelConfigurationRef/getModelReasoningEfforts | provisional；完整Competition多模型/原生参数/版本反馈待接线 |
| 云编排 | CoordinationPort、CloudAgentPort、AgentArts自有镜像、8 Workflow/3 Controller绑定 | provisional；固定公开文件Huawei WSS/MaaS/本地读取闭环有历史真实记录，不提升整链或全部绑定 |
| 知识 | KnowledgePort.search、Wiki来源/版本/受控写入恢复、本机配对桥及插件 | #320组合已进入main；host-only provisional，无新增公共wire；真实私人完整生命周期/云消费另验收 |
| 记忆 | MemoryQueryPort、FactChangeFeed、SQLite事实与投影/修订/撤回 | provisional；事实查询不等于向量检索；来源身份/出机许可和完整自动失效传播另验收 |
| MCP/Skills | 固定只读stdio、安装/启停/使用/卸载及受限Skill | #320组合已集成；provisional，任意脚本/远端写工具与真实云使用未由此证明 |
| 目标/认知 | 图存储appendBatch、影响/显式修复、持久事实批消费、有限建议适配 | provisional；Laya仍为存量，新的唯一决策配置迁移及完整责任循环待实施 |
| 语音 | Voice/Live/wake代码与宿主工厂 | provisional宿主面；wire voice操作仍未公布，问题绑定和实际设备同意/修改另验收 |
| Windows/补丁 | Named Pipe、目标读回、可信宿主尝试记录、Competition patch核实 | #332进入main；仅按模块明确场景记录，内部契约provisional，不概括为任意软件/写入可用 |
| 业务 | productivity、calendar、mail、feeds、notifications、research、weather、GitHub | 各包已存在；真实账号/网络、宿主注册、用户旅程分别核对，不能整体称unavailable或整体verified |
| 影子与上下文 | 当前轨迹/评估夹具、已有上下文与模型工厂可复用 | 新三模式独立影子宿主、摘要映射/缓存版本、责任编译为待接线能力 |

证据入口：[真实Huawei固定读取](../modules/AGENTARTS-HUAWEI-LIVE-COMPATIBILITY-20261012.md)、[Wiki/Skill集成](../modules/MOD-06-07-SKILL-WIKI-INTEGRATION-20261013.md)、[Windows](../../apps/windows-host/ACCEPTANCE-20261013.md)、[补丁](../../packages/coding-tools/ACCEPTANCE-20261013.md)。历史测试不等于本轮重新运行。

${frozen}

## 4. 本设计尚未公布的能力

| 目标 | 可复用入口 | 实施前状态 |
| --- | --- | --- |
| 自然语言责任编译/持久授权匹配 | Goal、Runtime、现有Policy | 完整目标消费unavailable；不得私设责任DTO/Renderer数据库 |
| 主动语音问题/操作/参数/revision绑定 | Voice宿主、authorization.respond | 新绑定未交付，语音意图不能直接签发授权 |
| 统一唯一决策服务及Laya迁移 | Cognition、CloudAgentPort、ModelGateway | 新默认配置未验证；只记录语义建议，保持旧消费者兼容 |
| 完整F28 Competition分派 | subagentModels及云编排 | 原生参数/能力/配置版本映射待接线，不扩ReasoningEffort枚举冒充支持 |
| F27可恢复摘要与版本缓存 | Memory/Knowledge/ModelPort | 完整宿主待交付；不是新MemoryQuery向量API |
| F22三模式影子 | 轨迹/评估/显式测试夹具 | 独立宿主与隔离证据未交付，不读写主状态/授权 |
| F23自动配置改进与晋升 | learning候选/验证端口 | 生产验证器/发布条件及回滚读回另验收；不是权重训练 |
| F24完整图推进/分支恢复 | TaskRuntime、检查点、原操作核实 | 保留原任务状态，不创建第二套调度器 |
| MaaS远端权重修改 | 无现有API | unavailable；独立训练工作包不能冒充API功能 |
| 云端持久回执自动恢复 | 云状态查询、本地发送意图 | restartRecovery:false；未知不重发，生产自动协调另验收 |

## 5. 能力发现、兼容与冻结

生产握手只公布实际支持的operation和ToolDescriptor；settings/connector/voice等Schema占位不能由文档启用。host-only工厂和wire能力分开，未公布返回UNSUPPORTED_CAPABILITY。

provisional变化固定提交和消费者；冻结字段变更需不兼容版本或明确协商。新增能力经单一Schema、生成器、失败夹具和消费接线交付后再登记。任务/工具语义和真实场景要分别验证；本轮文档重写不提升状态。

旧目录全文可从Git基线3275aa91读取，不继续将2026-09“尚无包/未进入main”等历史条目作为当前结论。公共契约仍以packages/contracts及公开exports为单一来源。
`);
set('docs/DEVELOPMENT_PROTOCOL.md', `# 公共开发协议与新架构适配

日期：2026-10-13。本次重新组织说明，不修改Schema/生成类型或新增公共DTO。单一来源：packages/contracts/schema/protocol.json、agentarts-transport.json、Windows内部Schema及各包exports；成熟度见[接口目录](interfaces/CURRENT_INTERFACE_CATALOG.md)。

## 1. 通信分层

Renderer经安全Preload/Client提交请求与接收事实状态；Runtime管理可信生命周期。CoordinationPort/CloudAgentPort隔离云DTO，ModelGateway统一模型调用，ToolGateway执行受限工具。huawei_ict_agentarts不静默回退Local。

本地wire 1.0.0与AgentArts独立transport 0.1.0分别校验；WSS主通道与HTTPS备用保持同一业务身份。已发送结果未知不重发。Windows Pipe使用其内部契约及服务端身份核验，不因本机连接免检。

## 2. 已发布信封与操作

Request含kind、protocolVersion、requestId、taskId（适用时）、operation、deadline、idempotencyKey（适用时）和具体payload。Response区分outcome=ok/data与error/error，保留evidenceRefs。Event含eventId、streamId、sequence、type、occurredAt和具体payload。详细必需/可选约束以Schema为准。

requestId关联单次请求，业务幂等不以requestId代替；授权引用仅由可信Runtime执行路径注入。工具目录公布name/version/inputSchema/outputSchema/sideEffect/requiredScopes/idempotencySupport/recoverySupport/requiresPresence等既有字段，外部自报需宿主核验。

现有17个wire操作的状态见接口目录：7个任务/会话/审批查询基础操作frozen；event.subscribe与按装配公布的capability.list、authorization.respond、tool.invoke为provisional；settings、connector与voice操作未因本设计自动公布。

## 3. 任务与事件

状态来自Schema：created、planning、running、waiting_approval、waiting_external、waiting_reconciliation、verifying、cancelling、succeeded、failed、cancelled。TaskRuntime是唯一迁移者。受理不等于完成，cancelAccepted不等于执行停止；终态重试创建关联的新任务，不直接重开。

写入未知进入waiting_reconciliation并核对原执行；保留已经发生的副作用。审批/外部等待只阻塞相关节点。事件按eventId去重和sequence消费；快照分页保持snapshotSequence。服务端尚未交付的游标裁剪/unsubscribe能力不能根据目标语义宣布已有。

## 4. 新设计概念如何接线

| 概念 | 既有消费位置 | 适配要求 |
| --- | --- | --- |
| 用户目标/持续责任 | task.submit、Goal、可信配置与Policy | 责任字段是设计，不由Renderer生成新协议或授权 |
| 功能图节点 | Runtime步骤、图revision与checkpoint | 持久身份/条件/必需分支映射后才能执行 |
| 唯一决策建议 | Cognition/Coordination/CloudAgent | 节点、快照、版本和合法候选由宿主校验 |
| 模型与思考 | ModelRequest及subagentModels | 当前ReasoningEffort none/low/medium/high；供应商扩展先映射/兼容 |
| 上下文摘要/缓存 | MemoryQuery、Knowledge、模型请求 | 来源/目标/参数/配置版本匹配，不能解析resultSummary尾缀私设协议 |
| 语音同意 | Voice宿主与authorization.respond | 最终转写、问题/参数/revision绑定；decision仍按已有allow_once/deny语义 |
| 影子结果 | 独立评估/轨迹宿主 | 不写主任务/记忆/授权，缺反事实结果标未知 |

实际需新增字段时先记录公共行为、版本/消费者影响，按单一Schema和生成器交付；文档里的snapshot、question、resource键不自动成为公开类型。

## 5. 知识与记忆

KnowledgePort.search返回带来源候选；MemoryQueryPort提供事实当前/历史版本，FactChangeFeed提供变化及确认。Wiki正文、事实投影和Goal图各有身份，不能宣称跨库原子。实际写入回执先保留，再独立恢复派生投影；缺页/断连不推断删除。

用户保存事实不自动授予出机；出机按任务、目的地、精确版本及现有许可。删除核对副本和原版本，外部已发送内容不在本地撤回保证内。

## 6. 错误、取消和副作用

INVALID_REQUEST/版本不兼容拒绝；UNSUPPORTED_CAPABILITY不伪造降级；REVISION_CONFLICT重读后重算；限流遵循实际retryAfter/deadline与用户预算；RESULT_UNKNOWN先核实。TIMEOUT或retryable不能单独决定写入重试。

调用贯穿deadline和取消信号；同一操作标识绑定相同输入，重规划/重启不刷新成新写入。模型不提供scopeRef、凭据、授权或执行函数。桌面输入与同资源写入复用既有锁。

## 7. 证据与联调

Evidence区分来源/观察/执行及mock、conditional、verified；可信执行路径记录，模型自报只作候选。敏感正文、音频、密钥和隐藏推理不默认写日志，公开引用不暴露私人路径。

联调用现有Client/FakeRuntime/ToolHost和明确Unavailable，测试公开契约、分支、修订、取消、未知与恢复。真实模型/账号/设备及平台trace另验收。合并按CONTRIBUTING的一位合资格非作者有效批准和实际检查执行，不以两人本机阅读作为协议冻结门槛。
`);

set('docs/competition/HUAWEI_ICT_AGENTARTS_PROFILE.md', `# Huawei ICT AgentArts Competition Profile

日期：2026-10-13 · 当前唯一实施profile：huawei_ict_agentarts。产品目标与28功能见[主架构](../design/workflow-architecture-20261013/DESIGN.md)。本次重新组织比赛架构，不重新解释或替代组委会实际通知。

## 1. AgentArts真实职责

AgentArts承担Agent/Workflow构建、云端编排、部署、调试评估与可追溯调用。自有镜像包含业务编排代码和模型配置引用，调用国内MaaS；不能只在本地完成全部核心决策后让平台改写文案。比赛届次、日期、评分与账号条件以实际通知/读回为准，本次未重新联网核验。

唯一决策配置贯穿目标、记忆、上下文、路由、恢复和影子比较；执行模型池形成候选。现有fast/world/plan/review代码阶段的最终裁决在重构中收敛；平台多角色协作不等于允许第二个最终决策模型。

## 2. 云与本地闭环

Desktop/Voice或事件 → Runtime/Goal/来源快照 → CloudAgentPort → AgentArts/唯一决策与执行模型 → 工具提案 → 本地Policy/ToolGateway → 目标系统实际读回/Evidence → 云续答与语义汇总建议 → TaskRuntime终态与用户反馈。

本地保留任务、授权、私有事实、工具执行与终态。云端不接收本地授权令牌或完整私人数据库；正文出机遵循已有许可。语音同意是现有授权的输入方式，不是云端签发权限。持续责任内自动处理，未知写入先核实。

## 3. 部署与国内执行

复用ARM64 AgentArts自有镜像与8080/现有HTTP、WS入口，WSS主、HTTPS备用可见。固定代码/镜像digest、模型配置、部署版本、原操作身份与调用证据。历史GHCR预览不代表国内镜像可拉取，SWR/平台导入按实际条件验收。

默认国内MaaS决策和国产执行模型；模型入口可配置，不新增封锁。各业务Provider、语音端点、模型/镜像拉取须在国内环境分别测试，不能用架构图、npm镜像或海外Provider历史成功声称全产品墙内可用。Cloud status有界内存restartRecovery:false，未知不跨通道盲重发。

## 4. 当前代码证据

基线main 3275aa91已合入#347查看器、#320 Wiki/Skill组合、#332 Windows/补丁恢复等增量。固定公开合成文件场景取得真实Huawei WSS/MaaS→本地Policy/读取/Evidence→续答，见[原验收](../modules/AGENTARTS-HUAWEI-LIVE-COMPATIBILITY-20261012.md)。它仅证明该固定场景。

完整28功能、统一决策迁移、真实私人Wiki/记忆出机、口头确认、真实写入、三模式影子、全部绑定、平台完整trace/评估及延迟未由本次文档验收。接口保持原frozen/provisional/unavailable边界。

## 5. 比赛验收矩阵

| 面 | 必需证据 | 当前结论 |
| --- | --- | --- |
| 构建/部署 | 项目/Agent/版本、镜像digest、平台部署读回 | 局部历史证据保留；新设计部署另验收 |
| 编排/角色 | 真实依赖、候选交接、唯一裁决、完整轨迹 | 云角色与绑定已有；28功能重构未完成 |
| 工具 | 云提案、本地授权、目标读回、Evidence及续答 | 固定读取场景真实；其他动作逐项验证 |
| 知识/记忆 | 来源身份、版本、许可、撤回/恢复与引用 | Wiki/Skill已集成；私人/云完整链待验收 |
| 语音 | 主动问题、同意/拒绝/修改、回声/旧回答/停止 | 完整语音确认待接线与设备验证 |
| 影子/评估 | 固定快照、三模式隔离、未知、比较与回滚 | 测试/轨迹可复用；独立影子宿主待实现 |
| 可视化 | 真实任务、profile、模型、审批、证据、错误 | 离线架构页不是生产比赛Demo证据 |
| 资源/成本 | 首响/P50/P95、队列、usage、冷启动与错误 | 无完整新设计实测数字，不承诺毫秒延迟 |

## 6. Golden Path与重构顺序

先在现有可信链上统一决策配置和版本上下文，再接单个责任模板/事件、并行分派及语音询问；继续接影子和配置比较，按[IMPLEMENTATION](../design/workflow-architecture-20261013/IMPLEMENTATION.md)扩展全部功能。

主场景仍可使用会议15:00→17:00及准备14:00→16:00：证明受影响计划修订、无关计划不变、已授权范围直接执行、需询问时可语音处理、重启不重复副作用。并展示拒绝、参数修改、断连、未知结果和后台影子。

Local及已授权DEV-WORKFLOWS历史增量保留，不作为比赛失败静默回退或退出条件。发布镜像、PR合并、云调用与比赛验收分别记录，任何一项不自动证明其他项。
`);

set('docs/modules/README.md', `# 模块设计与验收入口

当前目标由[主架构](../design/workflow-architecture-20261013/DESIGN.md)、[28工作流](../design/workflow-architecture-20261013/WORKFLOWS.md)和[39模块责任](../MODULE_ASSIGNMENTS.md)定义。[接口目录](../interfaces/CURRENT_INTERFACE_CATALOG.md)是能力与冻结状态依据。

本目录MOD/MVP文件是独立工作包、实现说明及历史验收，保留原作者/日期/PR和验证范围；它们不再各自定义第二套当前架构。旧Laya、旧双人阅读及未集成描述按当时基线理解，当前迁移见[IMPLEMENTATION](../design/workflow-architecture-20261013/IMPLEMENTATION.md)。

开工按[TEMPLATE](TEMPLATE.md)写明profile、负责人、代码所有权、F功能映射、公开依赖、接线、兼容与验收。模块从端口到消费者完成必要闭环，缺服务使用明确Fake/Unavailable，真实场景另记。设计/模型复评/CI均不自动把整MOD标done。
`);
set('docs/modules/TEMPLATE.md', `# 模块工作包模板

## 目标与所有权

- 工作包ID、MOD编号与F01—F28映射：
- 目标profile（当前huawei_ict_agentarts）：
- 唯一负责人、拥有文件与共享接线：
- 需求/完成条件；不在本工作包的事项：

## 契约与流程

- 消费的公开端口、精确版本/提交及frozen/provisional/unavailable：
- 输入快照/来源/目标revision、输出与节点依赖：
- 唯一决策模型参与点；代码确定性检查及执行模型候选：
- 并行、条件/必需分支、资源锁、超时和取消：
- 现有责任/授权覆盖、必要语音询问与参数修改失效：
- 副作用身份、结果未知核实、检查点恢复与Evidence：
- 影子/回放/隔离可比性及默认后台路径：

## 兼容与验证

- Schema/DTO/Provider/配置/数据库影响；无则注明：
- 必要调用方接线与迁移/回退方式：
- Fake/失败夹具与实际执行的检查：
- 国内端点/真实目标系统/语音设备读回；未验证项：
- 延迟/usage记录（无实测不编数字）：

## 交付

- 状态与继续入口；实际提交/PR、拟审查/合并者：
- 当前提交有效非作者Approve、检查、意见处理与集成：
- 保留其他协作者修改、凭据/私人数据检查：

不开第二套任务库/调度器/授权系统，模型不签发授权；不因本模板描述能力便公布capability。
`);

const roadmapSource=original('docs/ROADMAP.md');
const oldRoadmap=(roadmapSource.includes('<!-- historical-roadmap-body -->')?roadmapSource.split('<!-- historical-roadmap-body -->')[1]:roadmapSource).trim().replace(/^<!-- current-design-20261009 -->\n>[^\n]*\n/gm,'');
set('docs/ROADMAP.md', `# 开发计划与进度

## 2026-10-13 当前主架构重构基线

已合并#347（main 3275aa91）确定[28功能主架构](design/workflow-architecture-20261013/DESIGN.md)与离线图。本轮全项目文档重写工作包为DOC-ARCH-20261013，负责人zemeng5208，状态in_progress（提交PR后进入review）；目标profile为huawei_ict_agentarts。没有修改生产执行链、Schema或数据库。

| 工作包 | 目标 | 状态 | 负责人/依赖 |
| --- | --- | --- | --- |
| DOC-ARCH-20261013 | 当前架构/需求/协议/目录/分工/模块导航统一及全部流程说明 | in_progress | zemeng5208；两位协作者PR审核 |
| ARCH-D01 | 唯一国内决策配置与Laya/云角色兼容迁移 | todo | zemeng5208+goo122公开端口；新配置与真实模型验收 |
| ARCH-D02 | 持续责任编译、版本快照与局部计划修复 | todo | zemeng5208；Runtime/Policy/Goal/Memory |
| ARCH-D03 | F28多模型与原生思考映射、F27上下文恢复/缓存 | todo | 各端口负责人按MODULE_ASSIGNMENTS；D01 |
| ARCH-D04 | 主动语音询问及当前问题/参数/revision确认 | todo | zemeng5208；既有Voice/授权，责任内不重复询问 |
| ARCH-D05 | 条件汇合、稳定副作用身份及图恢复接线 | todo | Runtime/核心/业务负责人；复用现有检查点 |
| ARCH-D06 | 三模式后台影子、配置比较及回滚 | todo | zemeng5208+既有learning端口；独立宿主未交付 |
| ARCH-D07 | 国内端点与28功能集成/延迟/Competition评估 | todo | 三人各自验收所负责路径，不集中代验 |

“todo”是新重构工作包状态，不否认已有模块实现。拆分与验收详见[IMPLEMENTATION](design/workflow-architecture-20261013/IMPLEMENTATION.md)，接口状态见[目录](interfaces/CURRENT_INTERFACE_CATALOG.md)。新工作包只按明确授权实施；本次只交付文档与PR。

当前main已包含Wiki/Skill #320、Windows/补丁 #332及查看器#347。历史固定Huawei WSS读取有真实证据，完整责任/语音/影子及新默认决策未验收。实际延迟未知，不提高旧完成率或整MOD状态。

## 历史执行台账（原日期/作者/证据保留）

以下是此前工作包的记录，旧阶段“未合并”、Laya默认、双人本机阅读和百分比不作为当前架构/协作结论。当前协作以AGENTS/CONTRIBUTING的一位合资格非作者有效Approve、检查、无冲突与意见处理为准。

<!-- historical-roadmap-body -->
${oldRoadmap.replace(/^# 开发计划与进度\n/,'')}
`);

set('docs/adr/0024-unified-decision-workflow-architecture.md', `# ADR-0024：统一决策、责任图与后台影子架构

状态：accepted（产品设计，实施待交付） · 日期：2026-10-13 · profile：huawei_ict_agentarts。

## 背景

用户确认#347架构并要求重写全项目架构文档。旧方案分散、Laya默认和重复云决策会增加资源/串行等待，旧目标/真实能力及协作规则混在一起。

## 决定

采用事件驱动责任图和稳定28功能模板；同一运行只有一个生效最终语义决策配置，默认华为国内MaaS DeepSeek-V4.1-Flash。执行模型池产生候选，ModelGateway统一入口；本地代码负责权限、版本、锁、状态与Evidence。

唯一模型参与目标、记忆搜索/写入建议、上下文、分派、选路、恢复与影子比较，独立问题合批、真实依赖并行。主动语音同意是现有授权输入方式；责任内直接执行，不增加审批或模型封锁。影子三模式默认后台、独立输出且不消费主授权；MaaS配置改进不称权重训练。

复用TaskRuntime、CloudAgentPort、Policy、ToolGateway、Knowledge/Memory和图存储，不另建调度器/数据库。AgentArts仍真实承担构建、编排、评估和部署；WSS/HTTPS及未知结果语义不变。

## 替代与保留

替代ADR-0013及旧常驻/Laya提案中“Laya默认语义决策”和当前设计入口的部分；Windows常驻、Wiki来源、云/本地边界与ADR-0001—0007、0012、0014/0015的兼容内容继续适用。其余ADR中的来源身份/恢复决定按现有状态保留。旧ADR不删除或改写历史验收。

## 迁移与取舍

Laya适配和fast/world/plan/review代码先保留兼容，逐工作包收敛最终裁决配置；不在文档PR删除生产实现或扩公共枚举。云API减少本机权重资源，但存在网络、队列和秒级语义等待，实际延迟需测试。模型品牌、成本与质量不作未经验证保证。

## 验收与复审

按DESIGN/WORKFLOWS/IMPLEMENTATION检查全部功能、版本、确认、未知和影子隔离，并分别取得国内模型/连接器、设备、平台及P50/P95证据。模型能力/质量或国内可用性不满足时复审配置；本ADR不意味着生产能力已frozen或完成。
`);
const adrs=execFileSync('git',['ls-files','docs/adr/*.md'],{cwd:root,encoding:'utf8'}).trim().split('\n').filter(p=>!p.endsWith('/README.md')&&!p.endsWith('/0024-unified-decision-workflow-architecture.md'));
set('docs/adr/README.md', `# 架构决策记录

当前主架构采用[ADR-0024](0024-unified-decision-workflow-architecture.md)。它替代旧Laya默认与旧设计入口，保留模块化单体、Runtime权限、Wiki来源、WSS及既有恢复语义。ADR的accepted是决定状态，不表示实现/真实验收已完成。

历史ADR保留原日期、内容与状态。后续替代由新ADR说明，不能覆盖旧作者或验收。协作按CONTRIBUTING，一位合资格非作者对当前head有效Approve及检查/冲突/意见门槛，不恢复旧双人本机阅读规则。

${adrs.map(file=>'- ['+original(file).split('\n')[0].replace(/^# /,'')+']('+path.basename(file)+')').join('\n')}
- [ADR-0024：统一决策、责任图与后台影子](0024-unified-decision-workflow-architecture.md)
`);
set('docs/interfaces/README.md', `# 接口与能力目录

[CURRENT_INTERFACE_CATALOG](CURRENT_INTERFACE_CATALOG.md)为接口状态唯一登记；[公共协议](../DEVELOPMENT_PROTOCOL.md)说明调用语义，[主架构](../design/workflow-architecture-20261013/DESIGN.md)说明目标。类型/Schema/配置不是生产能力。

本轮保留wire 1.0.0冻结子集、独立云transport 0.1.0及原候选语义。责任、语音问题绑定、图节点和影子字段是待适配设计，不新增临时DTO。host-only端口与wire能力分开；不可用返回UNSUPPORTED_CAPABILITY，不隐式使用Fake。

- [Windows Host内部契约](WINDOWS_HOST_CONTRACT.md)
- [日历投影](P1-CALENDAR-P5-PROJECTION.md)
- [邮件分页](P1-MAIL-P5-PAGINATION.md)
- [Competition公共枚举](COMPETITION_PUBLIC_ENUMS.md)

变更按单一Schema/生成器、版本、失败夹具、消费者接线和实际验证更新目录，不由本次文档重写提升冻结范围。
`);

set(`${design}/IMPLEMENTATION.md`, `# 全项目重构接线与验收

本设计是系统性重构，复用现有工程资产；不是仅增加一个界面，也不通过少改代码删掉责任、语音、影子或并行要求。本次PR只重写文档，实施另按工作包授权连续推进。

## 1. 已有资产与边界

TaskRuntime/application、ModelGateway/ModelPort、CoordinationPort/CloudAgentPort、Policy/ToolGateway、图存储appendBatch、MemoryQuery/FactChangeFeed、Knowledge/Wiki、subagentModels、业务Provider、Voice/Windows/补丁核实、轨迹与评估夹具均有代码可复用。精确能力见接口目录和各包README，不能整体重建或整体称没有实现。

Laya适配、旧云角色、Local开发路径不由文档PR删掉。先列调用方、输入/输出、状态、错误和已验证回归，再逐个迁移；只删除实施包造成的孤立代码。旧Task/授权/副作用记录保留。

## 2. ARCH-D01 唯一决策配置

位置：packages/models、coordination、cognition、agentarts及apps/agentarts-runtime可信组合。goo122维护模型契约，zemeng5208交付核心消费及云接线。

将有限判断接口及云角色中的最终裁决指向一个生效配置；相同快照独立问题合批。保留外部输入校验、合法候选与弃权/失败；模型故障不签发授权、伪造成功或静默切Local。执行模型产出候选并回传唯一裁决。

验收：配置缺失明确Unavailable、旧消费者兼容、原超时取消/结构化提案回归、国内账号真实判断与工具闭环。模型选择目录不能冒充端点已启用。

## 3. ARCH-D02 责任与局部修复

位置：packages/goals/cognition、Runtime application/proactive-cognition-host、competition-fact-host、Desktop责任展示。复用现有Goal/图存储/Policy，责任编译输出先映射现有端口。

自然语言目标识别单次/持续/修订；确定性范围检查后记录可撤销责任。事件按版本去重、找依赖，唯一模型只判断受影响节点，Runtime提交合法修订并推进。责任内动作直接执行，缺项只问一项。

验收：重复事件不重做、来源撤回/冲突只影响相关子图、参数变更失效、撤销竞态、旧结果不覆盖新目标、无关分支继续。持久授权的现有缺口用真实实现解决，不以“用户已经说过”绕开代码。

## 4. ARCH-D03 模型分派与上下文

位置：Runtime subagent-host/subagentModels、ModelRequest/Provider、云角色配置、Knowledge/Memory公开端口及Desktop模型设置。

复用模型配置引用和思考能力列表；用户可选择模型/思考，唯一模型推荐任务分工。原生参数、步骤、上下文和验证分别保存/展示，供应商max等不能直接扩已有ReasoningEffort。需要扩契约时记录兼容、生成类型和消费者。

F27按目标/责任/活跃节点/来源组成最小上下文，读取与索引初筛并行，唯一模型排序/摘要。缓存绑定输入及全部相关版本；F28模型窗口反馈F27。恢复从摘要及来源引用重建，过期/撤回内容不可被旧摘要偷偷继续使用。

验收：配置/来源/目标/参数变更失效、上下文预算与恢复、真依赖等待、独立分支并行、原生参数服务接受与真实效果分开。测队列及调用轮次，不根据厂商名称认定快慢。

## 5. ARCH-D04 语音确认

位置：packages/voice、voice-wake、Desktop可信语音宿主及Runtime授权响应。保留已交付Live生命周期和普通用户权限。

主动播报当前操作摘要，最终ASR转写绑定当前问题/会话/参数/revision；明确意图走本地路径，歧义由唯一模型建议。同意消费既有授权、拒绝阻止对应动作、修改作废旧确认并重新生成摘要。文本与语音共用同一操作。

验收：同意/拒绝/否定句/条件同意/修改/旧回答/中途转写/TTS回声/沉默/超时/断网/用户接管及本地停止。停止播报、取消任务、结束语音分开测；ASR不可用时直接本地停止仍有效，不能宣称所有口头停止可识别。

## 6. ARCH-D05 图推进与恢复

位置：TaskRuntime、application/coordination、现有checkpoint、workspace/knowledge对账、各业务Provider。Runtime与对应能力负责人交付各自消费者。

就绪且互不依赖的节点并行，条件分支选择记录持久化，必需/可选汇合分开。同资源锁、稳定工具运行/操作身份、deadline、取消及未知核实贯穿。已成功副作用保持，不因新模型或断线刷新身份重发。

验收：分支失败部分结果、必需节点缺证据不成功、锁争用、进程重启、未知写入/迟到结果/取消竞态、断线恢复。公用Task状态不另造一套图终态数据库。

## 7. ARCH-D06 影子与配置改进

位置：既有agentarts evaluation/轨迹、learning候选端口和新独立影子宿主（具体目录由实施工作包登记，不提前建空包）。

三模式使用固定快照与当时证据；隔离运行持久输出及资源身份独立，缺宿主拒绝。比较完全/部分/缺证据/不可比，反事实工具结果缺失保持未知。只后台提出候选，原有发布要求确有必要时只阻塞关联节点。

验收：主任务/记忆零写入、主授权零消费、真实通知零外发、无未来数据、同输入配置可比、回归拒绝/晋升/回滚读回。API配置改进不包括远端权重修改；任何训练方案另定数据/算力/评估。

## 8. ARCH-D07 全功能与国内验收

三人按MODULE_ASSIGNMENTS分别完成其F功能消费者，复用已有业务API/Provider。国内真实模型/语音/连接器/镜像拉取逐端点验证；配置缺失不默默换Fake，旧海外Provider源码保留但不宣称国内可达。

将28工作流的成功、失败、取消、修改和未知结果逐项读回；关键跨功能场景包括邮件草稿与语音修改、研究→编码→失败修复、事件→日历/提醒、断连→取消/恢复、后台影子→改进拒绝/回滚。

测本地受理、首响、工具读回、完整结果、P50/P95、并发排队、冷启动、上下文和usage；记录来源与模型配置版本。没有阈值授权不编固定SLO或金额/Token预算。分别交付AgentArts构建/部署/调用/trace/评估和本地可信闭环，架构页不作真实演示证据。

## 9. 向后兼容与提交

每包提交公共端口→实现→必要消费接线→关键验证→文档。Schema/枚举/迁移改动单一来源并保留旧数据，破坏性变更升级版本。共享文件用Git集成、保留协作者修改。

本轮文档检查只覆盖路径/编号/生成一致性/事实及必要审查工具，不跑付费模型或生产动作。实施包使用受影响workspace检查，公共集成按根check。CI通过、PR批准、合并、真实验收与发布分别记录。
`);

// Current module architecture is rewritten; API and dated receipts remain reference sections.
const tracked=execFileSync('git',['ls-files','-z','--','*.md'],{cwd:root,encoding:'utf8'}).split('\0').filter(Boolean);
for(const file of tracked.filter(p=>/^(apps|packages)\/.+\/README\.md$/.test(p)&&!p.includes('/fixtures/')&&!p.includes('/demo-vault/')&&!p.includes('/native/')&&!p.includes('/host/'))) {
 let body=original(file).replace(/^<!-- current-design-20261009 -->\n>[^\n]*\n/gm,'').replace(/^> 维护入口[^\n]*\n/gm,'').replace(/<!-- architecture-scope-20261013 -->[\s\S]*?<!-- \/architecture-scope-20261013 -->\n/,'');
 const title=body.split('\n')[0];
 const location=file.slice(0,-'/README.md'.length);
 const assigned=modules.filter(m=>m.codePaths.some(p=>p===location||p.startsWith(location+'/')));
 if(!assigned.length)continue;
 const rel=p=>path.posix.relative(path.posix.dirname(file),p);
 const fsFor=[...new Set(assigned.flatMap(m=>m.workflows))];
 const introduction=`${title}\n\n<!-- architecture-scope-20261013 -->\n## 当前架构职责\n\n目标profile：huawei_ict_agentarts。工程责任：${assigned.map(m=>`${m.id}（${m.owner}）`).join('、')}。产品流程：${fsFor.join('、')}；逐节点流程见[WORKFLOWS](${rel(design+'/WORKFLOWS.md')})，主架构见[DESIGN](${rel(design+'/DESIGN.md')})，模块接线见[MODULES](${rel(design+'/MODULES.md')})。\n\n${assigned.map(m=>perModule(m).split('接线责任：')[1].split('\n\n验收责任')[0]).join('\n\n')}\n\n统一语义裁决默认在华为国内MaaS唯一决策配置；本模块提供实际能力或候选，模型不能代签授权/宣布主任务成功。调用仍经既有公开端口、Runtime/Policy/ToolGateway或ModelGateway；同资源写入、取消、版本、结果未知与Evidence沿用既有语义。独立节点按真实依赖并行，影子/历史评估默认后台。\n\n本轮仅重写架构说明。具体方法/配置/真实证据以当前源码与下面技术参考为准；这些参考的历史阶段不覆盖[当前接口状态](${rel('docs/interfaces/CURRENT_INTERFACE_CATALOG.md')})，也不证明新责任/语音/影子接线已经完成。\n\n## 现有API、运行说明与历史验证参考\n<!-- /architecture-scope-20261013 -->\n`;
 body=body.slice(title.length).trim();
 if(file==='packages/cognition/README.md')body=body.replace('## Provisional Laya advice consumer','## Legacy Laya advice consumer (migration pending)').replace('`ProactiveDecisionService` takes a bounded local decision model.','Legacy implementation: `ProactiveDecisionService` takes a bounded local decision model. The 2026-10-13 target replaces Laya as the default; these exports remain until a compatible implementation migration.');
 if(file==='packages/models/README.md')body=body.replace('后续需提供最小 `ModelPort`，让 MOD-04B 不依赖具体网关实现。','公开源码已有 `ModelPort = ModelProvider`；调用方具体依赖迁移仍需逐项核对。').replace('流式输出和 PA-012 专业 Agent 委派仍未完成。','当前流式/Live与PA-012宿主工厂按实际部署和消费状态核对，不由历史离线验收推定全链完成。');
 set(file,introduction+'\n'+body);
}

// Source-level policy references the actual new design, not the archived SVG bundle.
const policy=JSON.parse(original('scripts/review/design-policy.json'));
policy.designDirectory=design;
policy.requiredFiles=['index.html','DESIGN.md','WORKFLOWS.md','IMPLEMENTATION.md','MODULES.md','modules.json','DOCUMENTATION_INVENTORY.md'];
set('scripts/review/design-policy.json',JSON.stringify(policy,null,2));

const originalRequirements=original('docs/PRD.md').split('\n').filter(line=>/^\| PA-0\d\d \|/.test(line));
const revisedRequirements={
 'PA-003':'| PA-003 | 文本任务与唯一语义决策 | P0 | AgentArts/国内MaaS实际配置与调用可追溯；最终语义裁决唯一，执行模型输出为候选；不伪装Provider/profile |',
 'PA-007':'| PA-007 | 基础语音与确认 | P0 | 最终转写、主动播报、同意/拒绝/修改绑定当前问题/参数/revision；回声/沉默不放行，直接本地停止有效 |',
 'PA-012':'| PA-012 | 执行模型与专业任务协作 | P1 | 按真实依赖分派，候选回传唯一模型，独立验证；所有调用经ModelGateway并保留配置/取消/期限 |',
 'PA-020':'| PA-020 | 作用域记忆与流程改进 | P1 | 来源/版本、纠正/撤回/删除、语义排序、候选验证与回滚，不称权重训练 |',
 'PA-023':'| PA-023 | 授权与数据范围 | P0 | 责任或一次性授权可查/撤销；责任内不重复确认，模型不能签发权限或扩范围 |',
 'PA-027':'| PA-027 | Workflow、知识、执行协作与评估 | P0 | 真实职责/依赖、候选交接、来源、固定评估与trace；不以多角色引入第二最终决策模型 |',
};
const requirementRows=originalRequirements.filter(line=>!/^\| PA-0(28|29|30|31) \|/.test(line)).map(line=>revisedRequirements[line.split('|')[1].trim()]||line);
set('docs/PRD.md', `# PersonalAgent 产品需求

版本：2026-10-13 · profile：huawei_ict_agentarts · 主架构依据：已合并#347及用户确认。历史PA编号保留；本次重写需求表达，不宣布产品重构完成。

## 1. 产品目标

Windows常驻个人助手。用户通过主对话和语音提出目标，系统在预先授权责任内自行选路、并行分派、执行、核实和跟进。界面简洁，日常只展示目标、结果和必要的问题，模型/图/Scope在高级详情中。电脑运行时承担本机责任，不承诺关机后操作本机。

唯一语义决策配置参与目标、记忆、上下文、分派、路由、恢复与影子比较，默认华为国内MaaS DeepSeek-V4.1-Flash；执行候选优先国产模型。配置入口保留，不新增模型封锁、角色白名单或审批限制。模型提供语义建议，代码负责版本、权限、锁和终态。

[DESIGN](design/workflow-architecture-20261013/DESIGN.md)定义架构，[WORKFLOWS](design/workflow-architecture-20261013/WORKFLOWS.md)覆盖28功能154节点，[总图](design/workflow-architecture-20261013/index.html)连接全部流程。F功能和MOD工程模块不互相替代。

## 2. 功能需求与验收

P0为核心闭环优先，P1为主要能力，P2为额外验证/扩展。交付顺序不取消用户确认的完整设计；保留PA-001—027含义，增加责任、影子、分派与上下文要求。

| ID | 需求 | 优先级 | 验收条件 |
| --- | --- | --- | --- |
${requirementRows.join('\n')}
| PA-028 | 自主持续责任 | P0 | 自然语言创建/修订/撤销，责任内自动；范围外或关键歧义只询问缺项，独立分支继续 |
| PA-029 | 三类后台影子 | P1 | 决策影子/回放/隔离执行，主状态/主授权隔离，无未来数据，反事实未知、比较与回滚可追溯 |
| PA-030 | 主对话选择模型与思考 | P1 | 用户选择或唯一模型推荐，厂商/模型/原生参数可追溯；步骤/上下文/验证预算与原生思考区别可见 |
| PA-031 | 上下文管理与恢复 | P0 | 有来源的排序/摘要，模型窗口反馈、版本缓存失效与可恢复引用；不因压缩丢失当前目标/责任/未知副作用 |

## 3. 28功能范围

F01主对话、F02语音、F03世界状态、F04 Wiki记忆、F05检索、F06待办、F07日历、F08邮件、F09订阅、F10研究、F11天气、F12通知、F13诊断、F14电脑操作、F15编码、F16 CI、F17测试定位、F18 PR、F19 Issue、F20文档一致性、F21扩展接入、F22影子、F23评估/配置、F24调度恢复、F25账户配置、F26部署、F27上下文、F28模型分派。各自的正常/条件/失败/取消/未知与恢复节点见WORKFLOWS，不用一条串行流水线代替。

## 4. 语音与简洁交互

本地立即受理并展示真实状态，推理异步运行；区分已完成、部分结果、等待用户、待核实与失败。责任覆盖当前操作时直接推进，不重复弹框。

需要决定时主动语音说明动作、对象和关键参数，同时显示文字；口头同意/拒绝/修改与文字共用当前操作。修改使旧确认失效，条件同意先处理条件。中途转写、TTS回声、旧回答、否定句和沉默不能放行。停止播报、取消任务与结束语音不同；ASR不可用时保留直接本地停止，不保证任意口头停止仍能识别。

## 5. 代用户决策与范围

唯一模型可在已授权责任内选择信息优先级、记忆取舍、模板、执行模型、计划修订、通知与恢复路径；真实授权核验继续由既有Runtime/Policy完成。外部网页/邮件/工具/模型内容不能新增权限。撤销阻止后续动作，已发生副作用如实保留。

保存记忆与出机许可分开；来源版本、参数和目标改变使相关摘要/缓存/旧同意失效。未公布能力按不支持，不用Fake伪造可用。

## 6. 非功能要求

| 面 | 设计与验收 |
| --- | --- |
| 延迟 | 本地受理/直接停止不等待云；合批独立判断、真依赖并行、影子后台；量首响/P50/P95/队列，不保留模拟500ms |
| 资源 | 默认云API，不强制本机加载权重；事件去重和有效决定复用；按用户预算与实际平台能力 |
| 国内执行 | 镜像拉取、模型、语音和连接器分别国内读回；无CDN查看器不证明全产品网络可达 |
| 可靠性 | 稳定操作身份、版本/取消/未知结果核实，重启不重复写入 |
| 可观测性 | 目标、配置、来源、模型/工具、trace与Evidence关联，不依赖隐藏推理日志 |
| 隐私 | 凭据隔离、既有范围/删除/出机许可沿用，正文与SQLite投影分别恢复 |
| 易用性 | 日常只看目标、结果和必要问题，高级图/模型/接口留在详情 |

本轮不设用户未确认的固定金额、Token、耗时、步骤或性能阈值。普通云端语义任务有秒级等待风险，真实延迟待测。MaaS配置改进不能直接改变远端权重；训练研究另定数据/算力/评估工作包。

## 7. 当前状态与变更

main 3275aa91为文档核对基线，已有局部Runtime/云/业务/Wiki/Skill/语音/Windows资产；完整责任、统一决策、影子及28功能验收未完成。Local/已授权DEV-WORKFLOWS留存，不作为比赛失败静默回退。PA-018按2026-09-17用户修订排除，不集成TraceGuard。

2026-10-13采用唯一国内决策、责任图和后台影子，旧Laya/盘古单默认与双人本机阅读不是当前要求。比赛外部通知/日期不由本次文档重新确认；账号/设备/真实数据/端点验证另行记录。本次只重写文档并提交PR，实施顺序见IMPLEMENTATION和ROADMAP。
`);

const makePatch = ([file,text]) => {
 const full=path.join(root,file).replace(/\\/g,'/');
 if(!fs.existsSync(full))return `*** Add File: ${full}\n${text.split('\n').slice(0,-1).map(l=>'+'+l).join('\n')}\n`;
 const before=original(file);if(before===text)return '';
 const oldLines=before.trimEnd().split('\n'),newLines=text.trimEnd().split('\n');
 let prefix=0,suffix=0;
 while(prefix<Math.min(oldLines.length,newLines.length)&&oldLines[prefix]===newLines[prefix])prefix++;
 while(suffix<Math.min(oldLines.length-prefix,newLines.length-prefix)&&oldLines[oldLines.length-1-suffix]===newLines[newLines.length-1-suffix])suffix++;
 const contextBefore=prefix?[' '+oldLines[prefix-1]]:[];
 const contextAfter=suffix?[' '+oldLines[oldLines.length-suffix]]:[];
 return `*** Update File: ${full}\n@@\n${[...contextBefore,...oldLines.slice(prefix,oldLines.length-suffix).map(l=>'-'+l),...newLines.slice(prefix,newLines.length-suffix).map(l=>'+'+l),...contextAfter].join('\n')}\n`;
};
const generated=[`${design}/modules.json`,`${design}/WORKFLOWS.md`,`${design}/MODULES.md`];
if(process.argv.includes('--check')) {
 const drift=generated.filter(file=>!fs.existsSync(path.join(root,file))||original(file)!==updates.get(file));
 process.stdout.write(JSON.stringify({generated:generated.length,features:features.length,nodes:features.reduce((sum,f)=>sum+f.nodes.length,0),modules:modules.length,drift}));
 process.exitCode=drift.length?1:0;
} else {
 const index=process.argv.indexOf('--batch');
 const chosen=index<0?[...updates]:[...updates].slice(Number(process.argv[index+1]),Number(process.argv[index+1])+1);
 const patches=chosen.map(makePatch).filter(Boolean);
 process.stdout.write(JSON.stringify({total:updates.size,files:chosen.map(([file])=>file),patch:patches.length?'*** Begin Patch\n'+patches.join('')+'*** End Patch':null}));
}

# PersonalAgent

## 2026-10-09 当前交付与目标设计

当前工作包同时提交自有 AgentArts 镜像源码、公开接口与必要接线，完整常驻自主设计和 Wiki 记忆交接。`97aa51a6` 预览镜像已发布到 GHCR，提供 `/ws` 与受保护状态查询；当前源码已接线 WSS 客户端与显式 HTTPS 备用、本地 Runtime 的审批/工具/证据和未知结果防重发。已发布 AMD64/ARM64 镜像分别通过容器测试 21/21 与生产入口合成 TLS 9 次请求；公网 Upgrade、真实华为验收、自动 status 协调、持久云端恢复、Wiki 自动接入和完整常驻监管仍待完成。详细实现见 [接口说明](docs/competition/OWNED_IMAGE_INTERFACES.md)，固定来源、digest 与下载见 [新版发布记录](docs/competition/OWNED_IMAGE_WSS_RELEASE_20261009.md) 和 [GitHub 预发布页](https://github.com/zemeng5208/PersonalAgent/releases/tag/agentarts-preview-97aa51a6)；GHCR 发布、PR 合并与真实华为验收分别记录。

使用入口：[当前设计与状态](docs/CURRENT_DESIGN_CONTEXT.md)、[镜像接口](docs/competition/OWNED_IMAGE_INTERFACES.md)、[GHCR 分享](docs/competition/OWNED_IMAGE_SHARING.md)。Wiki 由 goo122 实施；两位协作者必须在自己的电脑阅读当前设计并确认/审批，禁止强制合并或管理员绕过。下文 2026-10-07 的提交和验收记录是历史基线。

<!-- current-design-20261009 -->
> 当前目标与协作规则（2026-10-09）：[完整设计](docs/design/resident-developer-agent-20261008/DESIGN.md) · [离线阅读/全部 SVG](docs/design/resident-developer-agent-20261008/index.html) · [两人确认与本机阅读门槛](docs/reviews/DESIGN_READING_GATE.md)。WSS 主通道、HTTPS 备用；Wiki 记忆由 goo122 接入。goo122 与 Potatos498 均确认后才可按授权合并，禁止强制合并/管理员绕过。设计不等于已实现；本文历史验收与作者记录保留，旧合并规则以当前门槛为准。

面向 Windows 的持续型私人 Agent 助理：以动态悬浮球为入口，结合版本化个人世界状态、AgentArts 云端编排、平台连接器与受控电脑操作，提供主动提示和有限自动执行。

项目参加**华为 ICT 大赛创新赛道**，选择“基于华为云 AgentArts 智能体开发平台的 Agent 设计和应用”赛题。[Huawei ICT AgentArts Competition Profile](docs/competition/HUAWEI_ICT_AGENTARTS_PROFILE.md) 是当前唯一实施和验收优先级：AgentArts 必须真实承担智能体构建、编排、评估和部署。通用 Local Profile 及现有 `runAgent()`、`ModelGateway`、盘古/自有模型代码只作为可选基线留存，当前不新增能力，也不构成比赛退出条件。本地 Runtime 始终拥有授权、真实执行、读回和 Evidence。

## 2026-10-07 历史基线

截至 2026-10-07，本地已同步到 `main@4d15f063`，该提交的 Foundation CI（run 37563282512）已读回成功。项目主要负责人为 **zemeng / zemeng5208**，用户继续负责核心与 AgentArts，goo122 和 Potatos 各自独立负责基础与业务主线；[模块分工](docs/MODULE_ASSIGNMENTS.md) 是负责人和文件所有权的唯一登记。

主分支已包含 AgentArts Adapter、Competition Runtime/审批工具循环、Desktop、语音与业务连接器，以及知识/记忆、认知和 DEV-WORKFLOWS 增量。#294 的撤回记忆管理与恢复、#297 的开发工作流修复均已合并；这纠正了旧文档中“尚无 Adapter”和“未合并”的描述。代码存在、CI 成功与真实功能验收分别记录。

整体 MVP 仍为 `in_progress`。真实 Competition 全链、原生 Desktop/Live、目标账号、设备及恢复读回按各自证据推进；本轮仅做同步、文档和清理，没有重跑真实模型或桌面验收。开放 PR 为 #298（CI 增量）与 #291（明确不合并的验收草稿）。最新任务状态见 [ROADMAP](docs/ROADMAP.md)，清理备份与继续入口见 [接手记录](docs/PROJECT_TAKEOVER_20261007.md)。

## 文档入口

- [华为 ICT AgentArts Competition Profile](docs/competition/HUAWEI_ICT_AGENTARTS_PROFILE.md)：参赛主路径、比赛与可选 Local 边界、实施顺序和验收矩阵。
- [产品需求 PRD](docs/PRD.md)：产品范围、需求编号、优先级和验收条件。
- [架构设计](docs/ARCHITECTURE.md)：模块、进程、协议、数据与技术验证项。
- [模块分工](docs/MODULE_ASSIGNMENTS.md)：主模块、DEV-WORKFLOWS 及独占工作面；三人各自负责完整交付，当前合并须 goo122 与 Potatos498 两人完成本机阅读确认及审批，禁止强制合并或管理员绕过。
- [公共开发协议](docs/DEVELOPMENT_PROTOCOL.md)：`goo122` 维护的任务、事件、工具、连接器契约与联调交付要求。
- [当前接口目录](docs/interfaces/CURRENT_INTERFACE_CATALOG.md)：逐接口冻结状态、生产可用性、证据和未提供能力。
- [协作开发规范](CONTRIBUTING.md)：任务分配、分支、PR、评审和完成标准。
- [开发计划与进度](docs/ROADMAP.md)：阶段门槛、首批工作包和当前状态。
- [Agent 协作规则](AGENTS.md)：在本仓库工作的自动化开发者必须遵循的约束。

阅读顺序：Competition Profile → PRD → 模块分工 → 当前接口目录 → 公共开发协议 → 架构 → 协作规范 → 开发计划。`goo122` 与 `zemeng` 从同一冻结接口提交使用 Fake 独立开发；Potatos 独立交付业务连接器与业务接线，三人可按公开契约自行补齐 Fake 和必要集成。当前新增实现只面向 `huawei_ict_agentarts`；Local Profile 仅留存现有代码，除非产品负责人以后明确启用，否则不新增、不扩展、不作为当前验收对象。任何实现变更必须关联需求编号、profile 和验收证据。

## 开发入口

默认通过分支与 Pull Request 协作，不直接向主分支提交实现。当前基线为 Node.js 24.15.0、npm 11.12.1；开发依赖由 package-lock.json 锁定。

在仓库根目录运行（PowerShell 中如脚本策略阻止 npm，可使用 npm.cmd）：

```sh
npm ci
npm run check
npm run dev
npm run demo:protocol
npm run demo:runtime
```

check 校验生成类型一致性，按依赖顺序构建并执行严格类型检查与全部工作区测试。dev 是一次性存储示例；demo:protocol 展示 mock 消费者取消往返和连接器注册；demo:runtime 展示持久任务、检查点、进度和终态事件。这些不是桌面、模型或真实平台启动命令。

MOD-02 接入入口：[contracts](packages/contracts/README.md)、[client](packages/client/README.md)、[testkit 六场景与验证](packages/testkit/README.md)。

MOD-03 接入入口：[Runtime 任务核心](apps/runtime/README.md)。

MOD-05 接入入口：[授权策略](packages/policy/README.md)、[工具网关](packages/tool-gateway/README.md)、[连接器宿主](packages/connector-host/README.md)。

接口状态以 [当前接口目录](docs/interfaces/CURRENT_INTERFACE_CATALOG.md) 为准。Schema 中存在但握手未公布的 operation 不可调用；Fake 成功不能提升为生产可用。

当前源码入口为 packages/storage/src，保留的 src/.gitkeep 不承载另一套实现。模块测试和夹具位于 packages/storage/test；开发缓存与验证产物位于项目内 .cache，并已忽略。详见 [存储包说明](packages/storage/README.md)。

文档相对链接以仓库内位置为准；不在可公开内容中记录个人绝对路径、账号或密钥。

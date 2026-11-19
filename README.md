# PersonalAgent

**面向 Windows 的常驻型个人认知智能体系统（Resident Cognitive Agent System for Windows）**

PersonalAgent 是一款构建于 Windows 桌面环境的持续型个人智能体助理与认知工作台。系统以非侵入式**动态悬浮球（Dynamic Orb）**与**多窗口指挥中心**为交互入口，深度融合**版本化个人世界状态（Versioned Personal World State）**、**端云协同混合编排（Cloud-Edge Hybrid Orchestration）**、**多源生态连接器**与**零信任本地受控执行引擎**，将自然语言意图、跨源事件流与个人长期目标转化为可感知、可审计、可恢复的受控行动。

<!-- current-design-alignment-20261015 -->

---

## 核心架构特性

### 1. 端云协同与多 Profile 混合编排（Cloud-Edge Hybrid Orchestration）
- **分层解耦执行链路**：采用 `Desktop UI` → `本地可信 Runtime` → `CloudAgentPort / 容器化高代码编排运行时` 的清晰边界。云端或容器化工作流负责复杂图推进、多 Agent 协同编排与动作提案；本地 Runtime 独占权限审批、工具执行、状态持久化与可信证据（Evidence）生成。
- **本机轻量化裁决与 Teacher 协同**：引入本机轻量化多语言语义判断组件（Local Laya）处理高频、有界候选路由；当领域资格未满足或面临复杂模糊场景时，自动按受信策略升级至高阶大模型（Teacher Model），且严禁在远端编排异常时发生未经授权的静默降级。
- **灵活的 Profile 架构**：支持面向云端高代码编排与评估的云端协同 Profile，同时保留基于本地 `ModelGateway`、多模型 Provider 与 `runAgent()` 的通用本地基线架构，共用底层安全策略与任务运行时。

### 2. 持续认知与版本化个人世界状态（Proactive Cognition & World State）
- **事实—决策—计划依赖图谱**：连接器持续观测带来源与版本戳的外部事件，关联用户原始引文、长期目标（Goals）、职责锚点、记忆（Memory）与上下文，驱动动态计划演进与最小计划修复（Minimal Plan Repair）。
- **无人值守与智能抗打扰机制**：在已授权边界内支持后台静默信息摄取（Feed Ingestion）与持续推进；用户归来时自动生成有效变化与新增证据的增量摘要。用户可精细控制通知窗口、频次配额、安静时段与投递渠道。
- **机会影子与增量自修复编码**：支持主任务优先调度与双方案对比评估；内置隔离沙箱编码与自动化研发工作流（[F15 V6 最小修复接线](docs/competition/CODING_MINIMAL_REPAIR_V6.md)），基于真实检查回执执行增量代码修复并完整记录主/影子执行证据。

### 3. 零信任本地宿主与可验证证据（Zero-Trust Host & Verifiable Evidence）
- **严格的进程与模块边界**：渲染层（Renderer）仅通过安全 Preload/IPC 提交请求与订阅事件，绝不直接接触模型凭据、数据库、Shell 或连接器；敏感凭据由本地受信宿主加密托管，永不进入模型提示词或公开日志。
- **事务级一次性授权与防重放**：工具调用统一经由 `Policy` 与 `ToolGateway` 拦截校验。需要人工介入的操作通过会话审批卡完成事务级消费（绑定任务、工具、作用域、参数、版本 revision 与有效期），确保幂等执行并杜绝未知副作用的盲目重试。
- **三级证据可信度体系**：由可信执行路径统一记录 `mock`、`conditional` 与 `verified` 证据，严格区分“模型自报生成”、“Schema 校验通过”与“外部真实状态读回验证”。

### 4. 模块化生态与全场景能力矩阵（Modular Ecosystem）
- 围绕 **28 项核心工作流**与 **39 个工程模块**构建，覆盖个人效率与研发全链路：
  - **知识与生产力**：Obsidian 笔记双向协同、日程管理（Calendar）、待办与生产力工具。
  - **信息与通信**：邮件（Mail）、跨源资讯订阅（Feeds）、实时天气（Weather）、深度研究（Research）与桌面通知。
  - **多模态与系统交互**：语音唤醒与受信语音指令（Voice）、受控 Windows 窗口观测与桌面操作、MCP（Model Context Protocol）与可扩展 Skills 体系。
  - **自动化工程工作流（DEV-WORKFLOWS）**：GitHub 连接器、Issue 诊断分流、自动化代码评审、隔离沙箱编码与 CI 故障自修复。

---

## 系统架构与设计全景

```
+-----------------------------------------------------------------------------------+
|                            Desktop Client (Electron)                              |
|        Dynamic Floating Orb  ·  Workspace Command Center  ·  Approval Cards       |
+-----------------------------------------+-----------------------------------------+
                                          | Safe Preload / Typed IPC
                                          v
+-----------------------------------------------------------------------------------+
|                        Trusted Local Runtime (apps/runtime)                       |
|   TaskRuntime (Checkpoints/State)  ·  Policy Engine  ·  ToolGateway  ·  Evidence  |
+-------------------+-------------------------------------------+-------------------+
                    |                                           |
                    v                                           v
+---------------------------------------+   +---------------------------------------+
|   Cognition & Hybrid Orchestration    |   |    Connector Host & Local Sandbox     |
|  - World State / Goals / Memory Graph |   |  - Obsidian / Mail / Calendar / Feeds |
|  - Local Laya Bounded Choice Router   |   |  - Weather / Research / Notifications |
|  - CloudAgentPort (WSS / TLS Stream)  |   |  - Controlled Windows UI / Voice      |
|  - Containerized Workflow Runtime     |   |  - Remote MCP / Skills / Coding Tools |
+---------------------------------------+   +---------------------------------------+
```

- **架构可视化与工作流全景**：[28 项工作流交互架构图](docs/design/workflow-architecture-20261013/index.html) · [架构图运行与编辑说明](docs/design/workflow-architecture-20261013/README.md) · [所有设计演进导航](docs/design/README.md)
- **当前详细设计与状态看板**：[当前详细设计规范](docs/design/CURRENT_DESIGN_20261015.md) · [28 项工作流逐项状态](docs/design/WORKFLOW_STATUS_20261015.md) · [当前接口冻结目录](docs/interfaces/CURRENT_INTERFACE_CATALOG.md)

---

## 工程演进与实证基线

项目严格遵循“**契约先行、证据驱动、源码与真实验收分离记录**”的工程准则，所有架构演进与集成测试均保留可追溯回执：

| 阶段与主题 | 核心工程交付与技术指标 | 验收证据与技术文档 |
| --- | --- | --- |
| **隔离编码与最小自修复（F15 V6）** | 完成主 Agent 任务分派、隔离工作区编码、基于真实检查失败的增量修复闭环，以及主/影子与原始 Evidence 独立记录接口（PR #376 已合入）。 | [最小修复与 F15 V6 接线](docs/competition/CODING_MINIMAL_REPAIR_V6.md) |
| **端云工作流与本机 Laya 协同** | 发布容器镜像 `local-laya-v3-244ca434` 及 ARM64 云端版本目录校验；完成本机 Runtime/Policy/Tool/Laya 与远端模型代理联调，沉淀 41 条持久化工具 Evidence。 | [工作流与协作者接线](docs/competition/LOCAL_LAYA_WORKFLOW_WIRING.md) · [V5 端到端证据](docs/competition/evidence/desktop-agentarts-v5-20261016/README.md) · [V3 运行指南](docs/competition/TEST_IMAGE_V3_RUN.md) · [实测汇总 JSON](docs/competition/evidence/test-image-v3-20261015/full-workflow-results.json) |
| **自有容器镜像与安全传输（WSS/TLS）** | 发布 GHCR 预览镜像（AMD64/ARM64），提供 `/ws` 双向流与受保护状态查询；客户端接线 WSS 与显式 HTTPS 备用通道，通过 21/21 容器测试与 9 次合成 TLS 生产入口验证。 | [镜像公开接口](docs/competition/OWNED_IMAGE_INTERFACES.md) · [WSS 发布记录](docs/competition/OWNED_IMAGE_WSS_RELEASE_20261009.md) · [GHCR 镜像共享](docs/competition/OWNED_IMAGE_SHARING.md) · [GitHub Release](https://github.com/zemeng5208/PersonalAgent/releases/tag/agentarts-preview-97aa51a6) |
| **核心底座与多模块联调基线** | 完成云端编排 Adapter、审批工具循环、Desktop 桌面端、语音、知识/记忆撤回恢复（#294）与研发工作流（#297）主线集成，Foundation CI 全绿通过。 | [当前设计上下文](docs/CURRENT_DESIGN_CONTEXT.md) · [模块分工与接线包](docs/competition/COLLABORATOR_WIRING_PACKAGE.md) · [历史基线记录](docs/PROJECT_TAKEOVER_20261007.md) |

---

## 文档导航

### 核心规范与架构设计
- [产品需求文档（PRD）](docs/PRD.md)：产品愿景、功能范围、需求编号（PA-001+）、优先级与验收条件。
- [系统架构设计（ARCHITECTURE）](docs/ARCHITECTURE.md)：模块划分、进程模型、通信协议、数据流向与安全信任边界。
- [当前接口目录（INTERFACE CATALOG）](docs/interfaces/CURRENT_INTERFACE_CATALOG.md)：逐接口冻结状态（Frozen / Provisional / Unavailable）、生产可用性门槛与验证证据。
- [公共开发协议（DEVELOPMENT PROTOCOL）](docs/DEVELOPMENT_PROTOCOL.md)：任务生命周期、事件流、工具调用、连接器契约与跨模块联调规范。
- [云端编排 Profile 与验收规范](docs/competition/HUAWEI_ICT_AGENTARTS_PROFILE.md)：端云协同主路径、云端编排与本地 Profile 边界及验收矩阵。

### 研发管理与协作准则
- [开发计划与路线图（ROADMAP）](docs/ROADMAP.md)：阶段里程碑、工作包状态与演进计划。
- [模块职责与分工（MODULE ASSIGNMENTS）](docs/MODULE_ASSIGNMENTS.md)：39 个模块的负责人、目录所有权及交付边界。
- [协作开发与评审规范（CONTRIBUTING）](CONTRIBUTING.md)：分支策略、PR 独立评审要求、技术 CI 门禁与合并标准。
- [自动化开发 Agent 规范（AGENTS）](AGENTS.md)：仓库内辅助研发 Agent 必须遵循的架构与安全约束。

> **推荐阅读顺序**：[产品需求 PRD](docs/PRD.md) → [系统架构设计](docs/ARCHITECTURE.md) → [当前详细设计](docs/design/CURRENT_DESIGN_20261015.md) → [当前接口目录](docs/interfaces/CURRENT_INTERFACE_CATALOG.md) → [公共开发协议](docs/DEVELOPMENT_PROTOCOL.md) → [模块职责与分工](docs/MODULE_ASSIGNMENTS.md) → [协作开发规范](CONTRIBUTING.md)。

---

## 快速开始与开发指南

### 环境基线
- **Node.js**：`24.15.x`（参见 `.node-version`）
- **npm**：`11.12.x`（依赖由根目录 `package-lock.json` 严格锁定）
- **操作系统**：Windows（桌面端与原生宿主特性优先面向 Windows 构建）

### 常用命令

在仓库根目录执行（若 PowerShell 脚本执行策略受限，可使用 `npm.cmd`）：

```sh
# 1. 安装锁定依赖
npm ci

# 2. 执行全量检查（架构边界门禁、契约生成校验、全工作区构建、严格类型检查与单元/集成测试）
npm run check

# 3. 构建全部工作区并启动桌面客户端
npm run build
npm run start:desktop

# 4. 运行核心机制演示脚本
npm run dev            # 存储层（Storage）生命周期与迁移演示
npm run demo:protocol  # 公共协议消费、取消往返与连接器注册演示
npm run demo:runtime   # 持久化任务状态机、检查点、进度流与终态事件演示
```

> [!IMPORTANT]
> **拉取新代码或切换分支后请先执行 `npm run build` 再启动桌面端**：
> 各 workspace 的 `dist/` 为本地构建产物（不纳入 Git 版本控制），桌面端与 Runtime 启动时直接加载编译后的 `dist/` 产物。若源码更新后未重新构建，会因导出符号或策略常量不匹配触发 `initializeRuntime` 异常（如设置页空白或状态停留在 `failed`）。

### 核心基础模块接入入口
- **契约与测试套件（MOD-02）**：[contracts（公共 Schema 与类型）](packages/contracts/README.md) · [client（IPC 与客户端 SDK）](packages/client/README.md) · [testkit（标准场景与夹具验证）](packages/testkit/README.md)
- **任务运行时核心（MOD-03）**：[runtime（任务状态机与编排应用层）](apps/runtime/README.md)
- **持久化存储层（MOD-01）**：[storage（SQLite 有序迁移与状态存储）](packages/storage/README.md)（源码位于 `packages/storage/src`，测试位于 `packages/storage/test`，缓存位于 `.cache`）
- **安全策略与工具宿主（MOD-05）**：[policy（授权策略引擎）](packages/policy/README.md) · [tool-gateway（工具执行网关）](packages/tool-gateway/README.md) · [connector-host（受控连接器宿主）](packages/connector-host/README.md)

---

## 安全与开源合规声明

- 接口可用性严格以 [当前接口目录](docs/interfaces/CURRENT_INTERFACE_CATALOG.md) 与运行时握手公布的能力（Capabilities）为准；未经握手公布的 Operation 严禁调用，测试替身（Fake）通过不代表生产环境就绪。
- 仓库内所有文档链接均采用仓库内相对路径；严禁在任何公开文档、测试夹具或提交记录中写入个人绝对路径、真实账号凭据或 API 密钥。

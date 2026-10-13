# 项目目录与模块开发规范

## 2026-10-09 当前目录增量

- `packages/agentarts/`：公开契约消费与自有 fast/world/plan/review 编排，不包含本地工具宿主或任务库。
- `apps/agentarts-runtime/`：8080 HTTP/WS 部署入口、独立传输校验、受保护状态查询、可信 Provider 配置、ARM64/AMD64 Dockerfile 与裁剪镜像上下文；公网 WSS 另验收。
- `packages/contracts/agentarts-transport`：独立 provisional 0.1.0 Schema/生成类型/严格帧解析；既有本地 wire 1.0.0 保持兼容。
- `packages/coordination/src/agentarts-websocket.ts`：可信宿主会话连接、逐次凭据读取、发送边界核验与有限 HTTPS 备用；持久任务/核实状态仍归 Runtime。
- `docs/design/resident-developer-agent-20261008/`：完整方案、四张 SVG、离线阅读、模块估算和 Wiki 交接，可编辑生成器一并保留。
- `scripts/review/`：本机打开/声明、内容清单及两人 review 校验；不是产品 Policy 或运行时依赖。
- `scripts/docs/`：文档导航同步生成器，保留历史事实。
- `.github/workflows/owned-image-preview.yml`：指定工作分支的 GHCR 预览构建；不合并 PR。

Wiki 接入复用 `packages/knowledge/`、`packages/memory/` 与 `packages/learning/`，由 goo122 实施。此设计不提前创建空 Wiki workspace 或第二套数据库/调度器。

<!-- current-design-20261009 -->
> 当前目标与协作规则（2026-10-09）：[完整设计](design/resident-developer-agent-20261008/DESIGN.md) · [离线阅读/全部 SVG](design/resident-developer-agent-20261008/index.html) · [两人确认与本机阅读门槛](reviews/DESIGN_READING_GATE.md)。WSS 主通道、HTTPS 备用；Wiki 记忆由 goo122 接入。goo122 与 Potatos498 均确认后才可按授权合并，禁止强制合并/管理员绕过。设计不等于已实现；本文历史验收与作者记录保留，旧合并规则以当前门槛为准。

> 维护入口（2026-10-07）：项目主要负责人为 zemeng；当前分工以 [模块分工](../docs/MODULE_ASSIGNMENTS.md) 为准，最新状态见 [ROADMAP](../docs/ROADMAP.md)。历史日期、作者和验收结论按原记录保留。

版本：1.2 · 日期：2026-09-09 · 状态：只实施 Competition Profile、Local Profile 可选留存的目录与依赖基线

本文是 PersonalAgent 目录布局、包边界和新增模块结构的唯一规范。当前实现优先级以[华为 ICT AgentArts Competition Profile](competition/HUAWEI_ICT_AGENTARTS_PROFILE.md)为准，需求范围以 [PRD](PRD.md) 为准，运行语义以 [公共开发协议](DEVELOPMENT_PROTOCOL.md) 为准，负责人以 [模块分工](MODULE_ASSIGNMENTS.md) 为准，跨模块接口可用性以 [当前接口目录](interfaces/CURRENT_INTERFACE_CATALOG.md) 为准。

## 1. 设计目标

- 一个目录只有一种职责，开发者能从路径判断代码所属模块。
- 模块通过公开端口协作，不读取其他模块的内部文件、数据库表或密钥。
- 业务能力可逐个开发、独立测试、独立评审，再由应用层装配。
- 保持模块化单体；独立进程必须由真实生命周期或安全需求驱动。
- 目录不提前创建空模块，模块开工时再创建对应 workspace。

## 2. 仓库根目录

```text
PersonalAgent/
├─ .github/                  GitHub 模板、CODEOWNERS 与 CI
├─ .worktrees/               本地隔离工作树，禁止提交
├─ apps/                     可启动应用与可信装配入口
│  ├─ desktop/               Electron 桌面应用
│  ├─ runtime/               当前 Runtime 应用与本地组合入口
│  └─ agentarts-runtime/     自有云端编排的 HTTP/ARM64 镜像组合入口，ADR-0012
├─ packages/                 可复用核心模块
│  ├─ contracts/
│  ├─ client/
│  ├─ agents/
│  ├─ coordination/          已有 provisional Competition 文字编排消费边界
│  ├─ goals/                 已有离线版本图及 provisional 存储端口
│  ├─ cognition/             已有离线依赖影响分析
│  ├─ agentarts/             自有云端语义编排；本地 Adapter 仍在 coordination
│  ├─ models/
│  ├─ policy/
│  ├─ tool-gateway/
│  ├─ connector-host/
│  ├─ storage/
│  ├─ testkit/
│  └─ connectors/            外部能力适配器
│     └─ weather/
├─ tests/                    跨模块架构、集成和 E2E 测试
├─ docs/                     需求、架构、ADR、接口、模块与验收文档
│  ├─ competition/           华为 ICT AgentArts Competition Profile
│  └─ interfaces/            接口冻结状态与 unavailable 登记
├─ scripts/                  可复现的开发、检查和发布脚本
├─ data/                     被忽略的本地运行数据
├─ package.json              workspace 与根级编排命令
├─ package-lock.json         全仓唯一 npm 锁文件
└─ tsconfig.base.json        TypeScript 公共严格配置
```

连接器继续使用已经投入协作的 `packages/connectors/<capability>/`，不迁移到新的根级 `connectors/`。这避免与现有模块分工、开放 PR 和导入路径产生无行为收益的冲突。

当前 `apps/runtime/` 同时保存 Runtime 核心和少量组合入口。核心文件不能导入具体连接器；具体连接器只允许出现在明确命名的组合文件。等后台生命周期、进程通信和安装方案经过验收后，再决定是否拆为 `packages/runtime-core/` 与 `apps/runtime-host/`，现在不创建空目录。

PR #36/#37 后已有 `packages/coordination/`、`packages/goals/` 和 `packages/cognition/`，分别提供 provisional 文字编排与离线版本图/影响分析。`packages/memory/` 在 MOD-09B 重建分支提供 provisional 查询/变化流端口与进程内 Fake，但没有生产事实库或持久确认；`packages/agentarts/`、`packages/knowledge/`、`packages/mcp/`、`packages/skills/` 仍未实现生产能力。`packages/agents/` 与 `packages/models/` 只作为可选 Local Profile 代码留存，当前不新增、不扩展，也不因参赛改名或删除。

## 3. 目录职责

| 目录 | 允许内容 | 禁止内容 |
| --- | --- | --- |
| `apps/` | 进程入口、UI、IPC、Transport、依赖装配 | 可复用协议和连接器业务规则 |
| `packages/` | Runtime、Agent、模型网关、策略、存储等模块 | Electron 页面、真实账号值、任意根装配 |
| `packages/connectors/` | 一个外部能力一个 workspace | 任务状态机、授权决定、UI |
| `tests/` | 跨模块架构、集成、E2E、人工真实验收 | 单模块普通单元测试 |
| `docs/` | 需求、决策、模块说明、验证记录 | 密钥、账号标识、个人绝对路径 |
| `scripts/` | 可复现且可在 CI 使用的工程命令 | 产品运行时业务逻辑 |
| `data/` | 本地数据库、缓存和检查点 | 源码、共享夹具、需提交的文档 |

根目录不保存生产 `src/`。单元测试跟随所属 workspace，根 `tests/` 只负责跨模块验证。

## 4. 依赖方向

```text
apps / 根 composition
  ↓
Runtime ──调用──> CoordinationPort <──实现── zemeng Coordination
                         │
             ┌───────────┴───────────┐
             ▼                       ▼
   CloudAgentPort / AgentArts    Local Agent（可选）
             │                       │
             ▼                       ▼
   Huawei ICT Competition       ModelPort/ModelGateway
             │
             ▼
      Memory / Tool / Evidence 等受限端口

所有模块只依赖公开 contracts 或消费模块声明的端口
```

强制规则：

1. `packages/*` 不得依赖 `apps/*`。
2. `packages/contracts` 不得依赖其他内部 workspace。
3. `packages/coordination` 拥有 Competition Profile 的消费语义，通过 CloudAgent/Memory/Tool/Evidence 端口协作；不导入 AgentArts DTO 或 Runtime 私有实现。
4. `packages/agents` 是可选 Local Profile，实现只依赖公共协议和最小 Model/Memory/Tool 端口，不以具体 ModelGateway 类作为冻结边界。
5. Runtime 核心不导入 Electron 或具体连接器。
6. 连接器生产依赖仅允许公共协议和未来统一的 Connector SDK；测试依赖可以使用 testkit。
7. Renderer 不能导入 Runtime、模型 Provider、Storage、Node 系统 API 或连接器。
8. 跨包只能按 `@personal-agent/<name>` 及目标包显式 `exports` 导入，禁止跨包相对路径和私有深层导入。
9. 生产依赖图不得有循环。
10. Runtime 通过注入的 CoordinationPort 调用 zemeng 实现；根 composition 之外不直接导入具体 AgentArts/Coordination 实现。
11. AgentArts package 不导入 Runtime、Policy 私有实现或 SecretStore 具体实现，只接收受限端口；正式 Competition 运行不得静默回退 Local。

本地及 CI 使用 `npm run check:architecture` 自动检查可机械验证的规则。

## 5. 普通模块结构

```text
packages/<module>/
├─ src/
│  ├─ index.ts               唯一公共导出入口
│  ├─ <module>.ts            主要实现
│  ├─ errors.ts              模块错误映射，需要时创建
│  └─ ports/                 模块所需抽象端口，需要时创建
├─ test/                     单元和单模块契约测试
├─ README.md                 职责、接口、依赖、测试和限制
├─ package.json
└─ tsconfig.json
```

- `index.ts` 只组织公共导出，不堆放装配和演示代码。
- 只有被两个以上实现使用或用于隔离外部依赖时才新增抽象。
- 不为尚未实现的能力创建空目录或 `.gitkeep`。
- 包名统一为 `@personal-agent/<lower-kebab-case>`。
- 每个包只使用根 `package-lock.json`，不能产生模块锁文件。

## 6. 连接器结构

```text
packages/connectors/<capability>/
├─ src/
│  ├─ index.ts               公共注册入口
│  ├─ connector.ts           ConnectorPort 实现
│  ├─ service.ts             与供应商无关的业务规范化
│  ├─ provider.ts            Provider 端口
│  └─ <provider>.ts          真实或 Fake 适配器
├─ test/
│  ├─ connector.test.mjs
│  ├─ service.test.mjs
│  └─ <provider>.test.mjs
├─ README.md
├─ package.json
└─ tsconfig.json
```

连接器 README 必须声明工具名和版本、输入输出、Scope、副作用、取消、超时、重试、幂等、证据、Fake 与真实验收边界。连接器不能自行签发授权、修改任务终态、访问桌面 UI 或直接读取其他模块的持久化数据。

## 7. 应用目录

`apps/desktop/` 按信任边界组织：

```text
apps/desktop/
├─ electron/
│  ├─ main.js                可信主进程入口
│  ├─ preload.cjs            最小安全桥
│  ├─ ipc/                   IPC handler，出现多个 handler 时创建
│  └─ composition/           依赖装配，出现多个组合时创建
├─ src/
│  ├─ app/                   页面壳层
│  ├─ features/              按产品能力组织的 UI
│  └─ ui/                    共享视觉 token/原语
├─ test/
├─ README.md
└─ package.json
```

Renderer 只提交请求和展示 Runtime 事实状态。主进程负责安全配置与装配，但不复制 Agent、Policy 或连接器业务逻辑。

## 8. 测试布局

```text
<workspace>/test/             单元测试、单模块契约测试
tests/architecture/           目录和依赖门禁
tests/integration/            多模块 + 显式 Fake Provider
tests/e2e/                    应用入口完整链路
tests/manual/                 真实账号、网络、付费模型验收
tests/manual/agentarts/       Competition deployment/API/trace/Golden Path 验收
tests/fixtures/               无隐私共享夹具
```

真实 Provider 不进入默认 CI。Fake、Unavailable 和真实 Provider 必须显式选择，测试报告不能将 mock 结果写成真实能力。

## 9. 文档和 ADR

- `PRD.md`：需求与验收依据。
- `competition/`：当前优先的 Huawei ICT AgentArts Profile、Golden Path 和比赛验收矩阵。
- `ARCHITECTURE.md`：当前与目标系统边界。
- `PROJECT_STRUCTURE.md`：目录与依赖依据。
- `DEVELOPMENT_PROTOCOL.md`：跨模块运行语义。
- `MODULE_ASSIGNMENTS.md`：负责人和独占目录。
- `ROADMAP.md`：真实状态与证据。
- `interfaces/`：逐接口 frozen/provisional/unavailable 状态、冻结基线和兼容范围。
- `adr/`：已采纳的重要架构决策。
- `modules/`：模块模板和模块级设计。

会改变跨模块依赖、信任边界、公共协议或进程形态的方案必须先写 ADR。普通模块内部实现不需要 ADR。

## 10. Worktree 与本地数据

- 新工作树统一放入 `.worktrees/<task-slug>/`，目录已被 Git 忽略。
- 创建、移动或移除工作树前先执行 `git worktree list` 和目标目录 `git status`。
- 不用删除未跟踪文件、强制重置或覆盖他人分支解决冲突。
- `data/` 中除 README 外全部忽略；数据库、WAL、缓存、密钥和私人数据不得提交。

## 11. 新模块开工门槛

每个模块必须先登记：目标 profile、模块 ID、负责人、自审/可选同行评审、独占目录、依赖、公共输入输出、不在范围、Fake 验收和真实验收条件。当前新增模块只服务 Competition Profile；Local Profile 只有产品负责人以后明确启用才产生新增工作。随后按“接口状态登记 → 端口/Schema → Fake 和契约测试 → 实现 → 集成 → 真实条件验收 → 文档和 ROADMAP”推进。

完成定义：

- 只通过公开入口调用，依赖门禁通过。
- README、负责人、测试和已知限制齐全。
- 默认测试无密钥、无付费调用、可重复。
- 有副作用操作经过 Runtime、Policy 和 ToolGateway。
- PR 完成自审、必要检查与实际合并后，按完整验收更新 done；不等待指定协作者的 PR 批准。
- 依赖接口必须为 frozen；如只能消费 provisional，工作包记录精确提交和迁移风险。unavailable 接口不能作为开工前提已满足。

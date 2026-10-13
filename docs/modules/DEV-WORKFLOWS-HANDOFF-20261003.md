# DEV-WORKFLOWS 代码交付与集中验证交接

<!-- current-design-20261009 -->
> 当前目标与协作规则（2026-10-09）：[完整设计](../design/resident-developer-agent-20261008/DESIGN.md) · [离线阅读/全部 SVG](../design/resident-developer-agent-20261008/index.html) · [两人确认与本机阅读门槛](../reviews/DESIGN_READING_GATE.md)。WSS 主通道、HTTPS 备用；Wiki 记忆由 goo122 接入。goo122 与 Potatos498 均确认后才可按授权合并，禁止强制合并/管理员绕过。设计不等于已实现；本文历史验收与作者记录保留，旧合并规则以当前门槛为准。

> 维护入口（2026-10-07）：项目主要负责人为 zemeng；当前分工以 [模块分工](../../docs/MODULE_ASSIGNMENTS.md) 为准，最新状态见 [ROADMAP](../../docs/ROADMAP.md)。历史日期、作者和验收结论按原记录保留。

> 2026-10-07 最新规则：以下为原轮次记录；集中验证、指定评审和唯一集成槽已取消。MOD-33/36/37 由 goo122、MOD-34/35/38 由 Potatos498 各自负责实现、接线、验证和交付，zemeng 专注核心与 AgentArts（MOD-37 仍未开工），详见 [模块分工](../MODULE_ASSIGNMENTS.md)。

## 本轮授权与边界

2026-10-03 产品负责人明确要求：同步项目，审查 Potatos498 的规划 PR，按最新分工开始代码实现；所有执行子任务使用 GPT-6.1 Sol；执行端只做可完成的静态核对，集中运行验证交给 Potatos498。

规划来源为 [PR #276](https://github.com/zemeng5208/PersonalAgent/pull/276)，审查锚点 `72f77e6f90d7f64a3f4012053a0809abf3d130b7`；完整源码基线为 `main@3d4d917bd2789e47b23feaaa26dbf0a381f61204`。本次授权启动 MOD-33/34/36/38 的 Local Profile 增量，覆盖规划中“仅登记未开工”的历史状态；Competition、MOD-35/37 和既有 P0～P8 源码工作不由本轮接管。

| 代码包 | 本轮负责人 | 独占实现 | 评审与验证交接 |
| --- | --- | --- | --- |
| MOD-33 | zemeng | `packages/connectors/github/` | goo122 协议兼容评审；Potatos498 集中运行验证 |
| MOD-34 | zemeng | `packages/coding-tools/src/dev-workflows/ci-fix*`、`git-tools*` | Potatos498 |
| MOD-36 | zemeng | `packages/cognition/src/dev-workflows/code-review*` | Potatos498 |
| MOD-38 | zemeng | `packages/cognition/src/dev-workflows/issue-triage*` | Potatos498 |
| 新组合入口 | zemeng 集成槽 | `apps/runtime/src/dev-workflows-runtime.ts` | Potatos498 行为验证；goo122 Runtime 兼容评审 |

共享 package manifest、公共 exports、根 build 顺序和唯一 lock 由本轮主控串行维护。每个执行者使用独立 `.worktrees/dev-*` 工作树，保留其他协作者改动。MOD-35 可在自己的独立文件扩展，不能并发改上述 CI/Git 文件；MOD-37 不受此次接手影响。

## 交付状态与入口

本轮交付生产实现、公开工厂、显式注册与新 Runtime 组合，以及供集中运行的行为测试。状态是 **review / 待集中验证**，不表示已通过类型检查、Fake 测试、真实服务或整体 MVP 验收。新接口均为 provisional 进程内消费面，不新增 wire operation，不冻结公共协议。

本轮实际执行的静态检查为 `git diff --check`、新增 TypeScript 与测试文件的 `node --check`
语法检查、`node scripts/checks/architecture.mjs`（31 workspaces 无边界违规）。唯一锁文件通过
`npm install --package-lock-only --ignore-scripts --offline --no-audit --no-fund` 更新，仅更新 workspace
元数据，没有安装依赖或运行构建/测试。环境为 Node 24.19.0 / npm 11.9.0，锁生成器对仓库要求
Node 24.15.x / npm 11.12.x 输出 engine 提示；集中验证应使用仓库指定版本。

- GitHub：`@personal-agent/github`；只有显式注册的工具可以被 Runtime 调用。
- 编码修复与 Git：`@personal-agent/coding-tools` 的公开 exports。
- Review 与 Issue 认知：`@personal-agent/cognition` 的公开 exports。
- Local Runtime：`@personal-agent/runtime/dev-workflows`。由受信宿主提供模型、GitHub 凭据引用、工作区、验证 recipe、Git 远端及允许修改文件；不自动读取用户账号或替代比赛组合。

工具读取与写入均使用既有 Runtime / Policy / ToolGateway。模型仅提出诊断、补丁、分类或预审意见；GitHub、文件、提交和推送权限来自原任务授权。产品修复链仍要求真实验证回执，本轮不运行验证不等于产品跳过验证。

## Potatos498 的集中验证入口

以下命令是交接步骤，**本轮未运行**。先按 `.node-version` 与根 `package.json` 配置仓库指定 Node/npm，再在干净依赖环境执行：

```sh
npm ci
npm run build
npm run test:dev-workflows
npm run check:architecture
```

出现具体编译、契约或行为失败时，将精确命令、首次失败位置、对应 commit/PR head 回交本轮实现者；不为假绿修改断言，不并发重写共享文件。公共契约与整体集成的进一步检查仍按仓库既有协议安排，不把上述定向测试冒充全仓回归。

真实验收需要本机 gh、真实 GitHub Actions/PR/Issue、用户明确授权的工作区和 Git 远端、配置好的模型网关。写入验收使用专用分支和明确批准的目标；先核实只读，再检查本地验证失败时不会提交、目标变更时拒绝旧意见/旧补丁、取消和未知结果时不会重复写入、批准后读回实际提交/推送/PR/评论。

每个模块文档与 README 给出更细的输入输出和失败条件。一次集中收集真实证据即可，缺实际账号/硬件时保留 unavailable/conditional，不反复启动重型槽。

## 继续与恢复

### 本次真实验收反馈与 helper 接线（2026-10-03）

Potatos498 的 `7999446a0fd4da2adda3e8ab8d25c2d3b7151719` 保留 MOD-36 整体 JSON
围栏兼容、有效意见筛选与 changed-lines 提示。本轮增加 kind/side 的原生字符串校验，拒绝
被 String 强转伪装成合法枚举的 JSON 数组；补充围栏、混合保留/去重、空报告不可发表场景源码，
并同步 MOD-36 的 Local 授权、只读验收报告与未验证边界。新增场景未运行。

PR 评论 `5968380670` 报告 MOD-34 仓库根包含默认 helper 导致注册失败。本轮不解除可写
workspace 与受信脚本的隔离；受信宿主预先在 workspace/recovery 之外的独立已限权目录安装
本版本 `packages/coding-tools/scripts/locked-apply.ps1` 的字节一致副本，显式设置
`workspace.patch.helperScriptPath`。公开 apply factory 转交可选绝对路径，核对单硬链接常规
文件、canonical 隔离及摘要，执行前复核；无配置保持既有安全拒绝，不自动复制/安装或执行
未知脚本。宿主 Windows ACL、跨模块兼容（goo122）和最新 head 的实际闭环（Potatos498）仍待验。

本轮执行端仅运行 `node --check` 及 whitespace 静态核对，未运行 build/typecheck/tests、
PowerShell、模型或真实 GitHub 验收，也未手动触发 Actions。旧 head 的 Foundation PR run
`37116763675` / job `111184973242` 已完成并失败：全仓检查进入测试后，Desktop 14 个失败计数、
Runtime 6 个失败计数；现有 DEV-WORKFLOWS 样例（包括跨轮 confirmed 文件提交）在该外部日志中
通过。它们不替代本轮新增场景，范围外存量失败不在本轮接管。

### Foundation 构建顺序修复（2026-10-03）

PR #277 的 `68ec4184` 在 Foundation run `37099110353` / job `111134969136`
的 `npm run check` 中，首次失败为 `knowledge/src/write.ts:8:38` 与 `:9:69`
的 TS2307：无法解析 `@personal-agent/coding-tools` 及其类型声明。导入使用根公开
exports，并不存在 `@personal-agent/coding-tools/types` 子路径；NodeNext 的 `types`
条件指向尚未构建的 `dist/index.d.ts`。根构建顺序已将 knowledge 移至 coding-tools
之后，保留 coding-tools 的 GitHub / models / agents 前置顺序及原 exports、依赖和锁文件。

本次仅核对 workspace 依赖拓扑、目标 imports/exports、tsconfig 输出路径、语法与
架构边界；未运行构建、类型检查或测试，不能宣称 Foundation 已通过。Potatos498
请在干净依赖环境对最新 PR head 集中运行既有验证入口及 `npm run check`；goo122
请核对公开消费兼容。后续失败继续反馈精确 head、命令及首次失败位置。

后续修复沿本轮 `codex/dev-workflows-integration` 和对应交付 PR，不新建重复实现任务。用户旅游期间按本轮授权推进可独立处理的代码问题；需要用户创建可见对话、提供缺失连接或明确决定时，通知用户继续。子任务不是额外可见的 ChatGPT 主对话，不能据此声称创建了新的 Work 对话。

PR 合并、代码写齐、定向测试、真实模块验收与整体 MVP 完成分别记录。本轮没有自动合并实现 PR，也没有自动批准产品运行中的 Review。

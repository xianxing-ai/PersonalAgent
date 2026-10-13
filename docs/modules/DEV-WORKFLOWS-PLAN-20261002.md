# DEV-WORKFLOWS：开发工作流自动化功能群（2026-10-02 登记）

<!-- current-design-20261009 -->
> 当前目标与协作规则（2026-10-09）：[完整设计](../design/resident-developer-agent-20261008/DESIGN.md) · [离线阅读/全部 SVG](../design/resident-developer-agent-20261008/index.html) · [两人确认与本机阅读门槛](../reviews/DESIGN_READING_GATE.md)。WSS 主通道、HTTPS 备用；Wiki 记忆由 goo122 接入。goo122 与 Potatos498 均确认后才可按授权合并，禁止强制合并/管理员绕过。设计不等于已实现；本文历史验收与作者记录保留，旧合并规则以当前门槛为准。

> 维护入口（2026-10-07）：项目主要负责人为 zemeng；当前分工以 [模块分工](../../docs/MODULE_ASSIGNMENTS.md) 为准，最新状态见 [ROADMAP](../../docs/ROADMAP.md)。历史日期、作者和验收结论按原记录保留。

> 2026-10-07 最新规则：以下为原轮次记录；集中验证、指定评审和唯一集成槽已取消。MOD-33/36/37 由 goo122、MOD-34/35/38 由 Potatos498 各自负责实现、接线、验证和交付，zemeng 专注核心与 AgentArts（MOD-37 仍未开工），详见 [模块分工](../MODULE_ASSIGNMENTS.md)。

## 背景

2026-10-03 状态更新：产品负责人已明确授权 zemeng 立即实现 MOD-33/34/36/38，并要求所有执行子任务使用 GPT-6.1 Sol；运行验证交 Potatos498。源码与新 Runtime 组合已交 PR #277，状态为 review / 待集中验证。下文“仅规划、未开工”描述原登记时点，不再阻止这四个已授权模块；MOD-35/37 及 P0～P8 原职责保留。文件所有权、公开入口与未验证条件见 [交接](DEV-WORKFLOWS-HANDOFF-20261003.md)。

产品负责人 2026-10-02 提出 5 项开发自动化能力（原始评估见内部选题表：痛点强度/演示效果/工作量三维评估）。本文将其登记为 MOD-33～38 六个工作包（含一个共享底座），纳入模块执行台账。**本文仅为规划与分工登记，未获"做 modXX"指令前任何模块不得开工**（遵守 DEVELOPMENT_PROTOCOL 开工门槛）。

原始选题与评估结论：

| 选题 | 痛点 | 演示效果 | 工作量 | 对应模块 |
| --- | --- | --- | --- | --- |
| CI 构建失败自动修复 | 极高 | 极好（现场跑挂构建再修复） | 中 | MOD-34 |
| Issue 自动分类+修复 PR | 高 | 好（现场提交 PR） | 中高 | MOD-38 |
| API 文档自动维护 | 高 | 中（对比文档 diff） | 中 | MOD-37 |
| 测试失败自动定位 | 高 | 好（定位到代码行） | 中 | MOD-35 |
| Code Review 自动预审 | 高 | 好（展示 review 意见） | 中 | MOD-36 |

## 总体架构决策（适用全群）

1. **执行边界**：所有功能遵守 ADR-0003——模型只产出文本/工具提案；实际执行（读 CI 日志、改文件、提交 commit/PR）必须走 Runtime → Policy → ToolGateway → 连接器；写入类操作（commit/push/PR/review comment）一律需用户审批，pending/unknown 不得显示为成功。
2. **连接器形态**：MOD-33 底座按 PROJECT_STRUCTURE §6 连接器模板（index/connector/service/provider/适配器 + test/ + README），其余模块作为消费侧组合，不重复建连接器。
3. **凭据**：GitHub 凭据走既有 SecretStore 与声明式凭据白名单；gh CLI 本机已验证可用（Win 环境真实读回过），连接器优先复用 gh 协议层而非自造 HTTP 客户端。
4. **真实验收吃自己狗粮**：本仓库即真实目标——CI 修复用真实 Actions 失败、Review 预审对本仓真实 PR、文档维护对比本仓接口目录。Fake 验收只覆盖协议与失败语义。
5. **Profile**：全部属 Local Profile 生产路径（Competition 之外的产品化增量），不进入当前比赛退出条件；不改变 P0～P8 既有边界与在途工作。

## 模块清单与实现方案

### MOD-33：GitHub 集成连接器底座（前置，所有人依赖）

- 负责人：zemeng；评审者：goo122。（2026-10-02 分工调整：代码量大的底座包转 zemeng）
- 独占目录：`packages/connectors/github/`。
- 职责：提供 repo/CI/issue/PR 四类端口的规范化读写：`actions.run.list`（含状态/结论）、`actions.log.read`（失败 job 日志分页）、`issue.get/list/label`、`pr.get/diff/create/comment`、`pr.review.comment`。输出统一脱敏（不回传 token，日志截断上限）。
- Fake/真实验收：Fake 覆盖 404/限流/分页/部分失败；真实验收用本仓库 gh 凭据读回真实 run 列表与日志（只读先行），写操作在 MOD-34/36/38 各自验收。
- 关键边界：不做任何模型归因逻辑；写入操作必须声明 scope 与审批语义。

### MOD-34：CI 构建失败自动修复

- 负责人：zemeng（2026-10-02 分工调整：本群代码量最大的修复循环转 zemeng）；评审者：Potatos498（功能意图与验收）；Runtime 工具循环兼容由 MOD-33 评审（goo122）把关。
- 独占目录：`packages/coding-tools/`（扩展）+ `packages/connectors/github/` 消费。
- 流程链：`actions.run.list` 发现 failed run → `actions.log.read` 拉失败日志 → 归因 Agent（模型）产出假设与补丁提案 → 本地执行验证（`npm run check` 等仓内门禁）→ 验证通过后生成修复 commit + PR（审批后提交）→ 把修复 PR 链接回写原 run。修复循环上限（尝试次数/token/时长）复用既有 Agent 有界执行边界（MOD-04A 语义）。
- Fake/真实验收：Fake 日志→提案→验证循环全离线测试；真实验收人为构造一次真实失败（破坏 typecheck 的提交），Agent 修复并在真实 Actions 上读回绿。
- 不在范围：不自动 merge；不修复非本仓构建系统；多仓并行修复。

### MOD-35：测试失败自动定位

- 负责人：Potatos498；评审者：zemeng。
- 独占目录：`packages/coding-tools/`（扩展）。
- 流程链：`node --test` 输出解析（已有 test/*.test.mjs 套件）→ 堆栈帧映射源码行 → 收集上下文（相关模块/最近变更 diff）→ 定位报告（疑似根因行+置信度+证据引用），不直接改代码；可选与 MOD-34 组合成"定位→修复"链。
- Fake/真实验收：Fake 覆盖堆栈缺列/源映射缺失/超时用例；真实验收在本仓注入一个真实失败测试并给出正确行号定位。
- 不在范围：不改测试本身；不处理 flaky 自动重试策略（仅标注）。

### MOD-36：Code Review 自动预审

- 负责人：zemeng；评审者：Potatos498。
- 独占目录：`packages/cognition/`（扩展，评审认知链）+ 消费 MOD-33。
- 流程链：`pr.get/diff` 拉取 PR → 预审 Agent 按 DEVELOPMENT_PROTOCOL/AGENTS.md 规则生成结构化意见（分层：阻断/建议/疑问）→ 意见经用户确认后 `pr.review.comment` 回贴（审批制，不自动 approve）。
- Fake/真实验收：Fake diff→意见→回贴链；真实验收对一个真实 PR 完整预审并展示意见回读。
- 不在范围：不代替人工评审批准；不改他人 PR 分支。

### MOD-37：API 文档自动维护

- 负责人：goo122（契约/接口目录/check:generated 职责）；评审者：zemeng。
- 独占目录：`packages/contracts/`（工具侧扩展）+ 消费 MOD-33。
- 流程链：从 packages exports 与接口目录提取当前公共 API 面 → 与 docs/（ROADMAP/接口目录/模块 README 声明）比对 → 生成漂移报告与文档补丁 PR（审批后提交）。复用 check:generated/check:architecture 既有产物，不自建第二事实源。
- Fake/真实验收：Fake 覆盖漂移注入→报告；真实验收对一次真实 API 变更生成正确文档 diff PR。
- 不在范围：不改接口语义本身；不重写历史文档。

### MOD-38：Issue 自动分类+修复 PR

- 负责人：zemeng（分类认知，复用 MVP-P8 分类器经验）；评审者：Potatos498；依赖 MOD-33/34。
- 流程链：`issue.list` 拉新 issue → 分类 Agent（标签体系：bug/feature/docs/question + 置信度）→ bug 类走 MOD-34 修复链生成修复 PR → PR 描述回链 issue。分类写回与 PR 创建均审批制。
- Fake/真实验收：Fake issue 集（含中文/混合标签）分类准确率达标；真实验收在本仓库提一个真实测试 issue 走完全链。
- 不在范围：自动关闭 issue；处理安全敏感 issue（凭据类直接转人工）。

## 推进顺序建议

1. MOD-33（底座，约前置 1 个工作包周期）；
2. MOD-34（痛点极高+演示王牌，投入产出最高）；
3. MOD-35（与 34 共享解析底座，顺势交付）；
4. MOD-36/37 可并行（互不依赖）；
5. MOD-38 最后（复用面最大、工作量中高）。

## 开工门槛提醒

每个模块开工前需按 PROJECT_STRUCTURE §11 补齐：模块 ID、负责人、评审者、独占目录、依赖、公共输入输出、不在范围、Fake 与真实验收条件，并在此文件与 MODULE_ASSIGNMENTS 登记后由产品负责人明确说"做 modXX"。本文档不改变 P0～P8 在途工作优先级。

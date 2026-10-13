# P1 接线基线与边界确认请求

<!-- current-design-20261009 -->
> 当前目标与协作规则（2026-10-09）：[完整设计](../design/resident-developer-agent-20261008/DESIGN.md) · [离线阅读/全部 SVG](../design/resident-developer-agent-20261008/index.html) · [两人确认与本机阅读门槛](../reviews/DESIGN_READING_GATE.md)。WSS 主通道、HTTPS 备用；Wiki 记忆由 goo122 接入。goo122 与 Potatos498 均确认后才可按授权合并，禁止强制合并/管理员绕过。设计不等于已实现；本文历史验收与作者记录保留，旧合并规则以当前门槛为准。

版本：1.1 · 日期：2026-09-29 · 原提案作者：`Potatos498` · 技术接口确认人：`goo122` · 关联：Issue #212、接线方案 PR #88、#107（MVP 口径）

## 0. 本文目的与有效边界

2026-10-07 当前有效边界以 [MODULE_ASSIGNMENTS](../MODULE_ASSIGNMENTS.md) 为准：zemeng 负责核心与 AgentArts，goo122 负责底座，Potatos 独立负责业务连接器、业务接线和 MOD-35；各自验证并交付；Issue #212 的旧委派保留为历史，远程内容本轮未改写。

本文保留原 P1 接线讨论与接口请求，不改变任何现有写入权。**合并本文只保存讨论基线，不等于 goo122 已逐节确认、不等于完成 P7 交接，也不证明工具已注册或真实验收通过。** 原 PR #88 的方案需按当前 main、接口登记与 Issue #212 最新边界复核；已由 #206 组合带入主线的功能不得重做。

## 1. 目录与文件边界（不新增委派）

| 路径 | 当前边界 | 说明 |
| --- | --- | --- |
| `packages/connectors/**`（weather/feeds/mail/calendar/productivity 既有及后续 social） | `Potatos498` 的 P1 独立模块范围 | 业务逻辑、Provider、测试与必要注册/消费接线；保持公共兼容 |
| `packages/notifications/**`、`packages/productivity/**` | 沿用 P1 既有模块范围 | 不接管 P5/P7 消费或存储恢复 |
| `packages/memory/**`、`packages/learning/**` | goo122 保留 #209～#211 在途工作；后续由 P7 明确登记交接 | 不再默认交给 Potatos498，见 §4 |
| `apps/runtime/src/connectors-runtime.ts`（原方案建议的新文件） | 是否需要创建及唯一写入者由 P8 集成槽核定 | P1 先提交独立模块工厂和接线需求；避免重复现有组合入口 |
| `apps/runtime/src/index.ts`、`application.ts` 等 Runtime 根装配 | goo122 长期维护；P1 可在独立分支完成必要接线 | 固定公开契约，补消费验证，合并前对齐 main |
| 根 `package.json`、`package-lock.json` | P8 登记的唯一集成写入槽 | 依赖与 workspace link 变化统一生成和复核 |
| `apps/desktop/electron/main.js`、`apps/desktop/src/features/admin/view.js` | 按 Issue #212 登记共享集成写入槽 | P2 提接线需求；排除 P5/P7 专属消费与在途私人记忆代码 |

## 2. 接口请求（接线前按当前 main 核实）

下表是原方案的待核对接口清单，不代表本次重新确认实现状态或冻结接口。

| 接口 | 复用方向 | 需要的决定 |
| --- | --- | --- |
| `ConnectorHost` + `SecretStorePort.read` | mail 凭据经受信宿主读取 | 核对现有导出；`secretRefs: ['qq-mail-authcode']` 的 ref 命名待确认 |
| KV `StoragePort` 适配 | 优先复用现有持久存储与受信 namespace 绑定 | 核对是否已有适配，再决定实现位置；不得预占或复用迁移号，应按最终 main 的登记分配新号并保留既有迁移；`p1-connectors` 仅为待确认建议 |
| `TaskRuntime.listSchedules` / `reconcileSchedules` | productivity 提醒对账复用现有日程能力 | 核实当前 main 的导出和组合调用；区分功能经组合 PR 集成与原 PR #197 自身的合并状态 |
| `notifications.planSchedules()` → Runtime 日程创建桥 | 复用既有调度接口 | Phase 2 的共享组合点由 P8 核定，Phase 1 不另建第二套调度语义 |
| Runtime 启动凭据注入形态 | 受信环境配置及 SecretStore 可插端口 | 核对 `PA_QQ_MAIL_USER/AUTH_CODE` 现有约定；不读取或改写真实凭据，桌面共享接线经 P8 处理 |

## 3. Phase 1 接线提案

以下保留原方案的目标拆分；具体工具名、scope、注册状态和接入点必须与最终版本目录核对，不能把清单当作已经可用。

1. **模式**：收集 `RegisteredTool[]`，经既有 Competition Runtime 装配入口接入；不启用 Local 静默回退，也不重复已集成工厂。
2. **目标工具**：feeds.collect、feeds.subscriptions（feeds:read）；mail.inbox、mail.accounts（mail:read）；todo.list（todo:read）；todo.create、todo.update（todo:write）；notifications.status（notifications:read）；research.search（research:read）。这些名称是接线核对清单，不是新增公共接口许可。
3. **凭据**：mail 经受信 SecretStore 路径读取；取消与错误规范化、错误脱敏及合成哨兵回归按现有契约处理。
4. **无凭据行为**：mail 保持未注册/不可用，不能伪报已同步；其他包仅在各自配置和依赖齐全时注册。
5. **拆分建议**：先核对 feeds/mail/research 三包的独立增量；productivity/notifications 在存储适配与授权接口就绪后作为 Phase 1b。业务接线由 P1 随包完成；缺上游实现时先用固定契约与 Fake，不等待 P7 交接或 P8 的专属集成 PR。
6. **验收**：覆盖正常授权调用、scope 拒绝、缺配置不注册和凭据脱敏。优先复用已有测试，只补真实差异；合成证据与真实账号/云端验收分开记账。

## 4. goo122 在途记忆线与 P7 交接

Issue #212 明确保留 goo122 的 #209 → #210 → #211 在途工作与公共语义职责。该句描述旧委派；2026-10-07 最新分工下，记忆与学习由 goo122 独立负责，核心认知与 AgentArts 由 zemeng 负责，业务由 Potatos498 负责；旧在途记录不形成指定人员的集成或审批门槛。

需要由相关现有负责人在 Issue #212 登记并核对：

1. **在途状态**：三个 PR 的精确 head、实际剩余增量、冲突与未完成项；不能只按旧的增删行数判断。
2. **文件交接**：`packages/memory/**`、`packages/learning/**` 及测试仅在 P7 接手人明确后移交；交接前保留原分支、未提交差异与证据。
3. **保留职责**：私人记忆控制器、Memory/learning/Runtime 事实删除恢复及其测试继续按当前在途登记处理。
4. **集成顺序**：按 #209 → #210 → #211 的实际 base/head 关系串行复核；旧分片 PR 的批准不替代集成后最终 head 的审查。

备份删除、跨库恢复和真实来源路径均属于 P7 剩余工作，不再写作“交接后由 Potatos498 承接”。已被 #209 收拢的分片 PR 保留评审记录，避免重复集成旧迁移。

## 5. 优先级与顺序提案

1. **当前**：既有 Competition 主链推进与 P1 独立模块并行，保留各在途写入者工作。
2. **Phase 1**：在 P1 范围内补齐真实连接器与独立工厂；接口需求由 goo122 复核，共享接线交 P8 集成槽。
3. **Phase 1b / Phase 2**：依赖就绪后推进 productivity/notifications 接入及调度闭环，不以文档合并冒充执行完成。
4. **MOD-26**：首版平台由产品负责人确认后再登记独立子任务。

## 6. 待回复事项

- §1：核对是否准确反映 Issue #212 当前边界；不得据此恢复已撤回委派。
- §2：核对现有端口、StoragePort 适配状态及 namespace 建议。
- §3：确认首批与二批拆分是否符合当前已集成功能，避免重做。
- §4：由 goo122 与登记的 P7/P8 接手人核实在途状态与交接。
- §5：技术方案确认与实际写入槽登记分别留痕，不将文档合并解释为“全部按此实施”的授权。

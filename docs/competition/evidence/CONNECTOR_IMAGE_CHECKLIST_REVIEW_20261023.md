# 2026-10-23 镜像清单连接器事实核查

目标 profile：`huawei_ict_agentarts`。本轮树 `connector-review-20261023`，基线
`ad1a045e1ec65f9ef280125d9df78b9cb63b4e51`。仅本机合成夹具，不读取私人数据库、凭据、邮件或日历，不发送邮件、不创建真实日程。原始问题清单与 Gemini 原文均未改写。

## 核查来源与结论

通过 GitHub 正常只读 PR body、diff、评论及本地 Git 对象核对。下述结论针对源码和证据，不声称该代码已进入用户既有 ARM64 镜像。

| 清单项 | 当前事实 | 结论与剩余验证 |
| --- | --- | --- |
| 3 日历重复创建 | `calendar.create` UID 可省略；CalDAV 此时 `randomUUID()`。明确 UID 已走 `If-None-Match: *`，412 后按 UID、标题、起止、位置、备注读回，比对失败报 `REVISION_CONFLICT`，不覆盖。 | 已核边界，非已确认契约 bug。相同内容的新调用确会产生不同 UID；“完全没有幂等”不准确。跨新任务识别用户重发属于新增需求，不能按标题+时间消除合法同名日程。既有工具整体 `idempotencySupport:false` 仍准确。 |
| 5 mail.review 两次失败/批次收尾 | [#503](https://github.com/xianxing-ai/PersonalAgent/pull/503) head `06a0848ffa7d4ce84bb1f4454f3179eb0efd3eb4` 的 body 与 `pr503-cloud-mail-20261023/` 已记录后续真实云复核 3/3、自动新信复核及通知成功，另一次 `EXTERNAL_FAILURE` 原记录保留。源码及测试约束 failed/unknown 不自动再次派发。 | “当前100%失败”已被后续作者证据反驳；不等于早期两次失败不存在或全部云故障已修。本轮未独立重跑真实云；失败后批次收尾仍须在作者精确 head 的 Runtime/Host 测试及实际批次中核实。 |
| 8 重启读取许可/缓存 | #503 正常退出仍撤销本地读取 lease；`mail-review-restart-20261023.json` 证明云偏好、水位、绑定和原任务数保留，明确不等于恢复读取许可。生产 `mailHost.snapshot()` 本已从加密持久缓存提供分类数量，无须恢复读取许可。 | 本轮新增最小只读历史数量展示与需重新授权提示，复用卡片原连接设置入口。没有恢复旧许可、触发新邮件读取或创建新许可。上次更新时间未由当前公开 summary 提供，不虚构时间；时间展示仍待原接口支持。 |
| 9 每封邮件变化风暴 [#506](https://github.com/xianxing-ai/PersonalAgent/issues/506) | #503 diff 已将新 UID 汇成每个 confirmed inbox page 一事件；尚未开始的旧逐 UID 事件按 source/origin 合并。决策进独立 `connector-change:` 会话，`main.js` 用 `ownsDecisionTask` 排除用户对话投影；silent 策略在推理前拦截。完整信头超窗时按有界串行组调用 Laya，仍保留一个 Runtime 任务。 | 源码已修原“每封一任务+刷屏”机制，不应重复修。每页与每次同步不同，超窗组也可能多次本地推理；不能声称整次同步只一次调用或完全无模型调用。未独立验证作者 head 的运行。 |
| 13 天气配置 | [#509](https://github.com/xianxing-ai/PersonalAgent/pull/509) OPEN，head `6853c87ce92da3ce3e46d92f4c74e32142972628`，含首次配置/换城市及作者本机验证记录。 | 作者已有修复，尚不能称已合入或已进入镜像。本轮不重做。 |

以上 PR 查询时 #503、#509 无非 bot issue comments；不存在可引用的“最新作者评论”补充结论。[#507](https://github.com/xianxing-ai/PersonalAgent/pull/507) 为上下文压缩独立 OPEN PR，不是邮件重启缓存或天气修复；其 body 明确部分历史整仓检查受邮件超时影响，不把该记录当本轮连接器失败证据。

## 日历根因与边界

`ToolContext` 仅有 `taskId`、`runId`、授权引用、可选授权参数 `argumentsDigest`、期限与 scopes，没有跨新任务的 caller stable operation key。Runtime 原任务/工具运行记录与 provider UID 是两层身份：用户重新发送自然语言导致新任务时，不能仅凭内容摘要认定是原操作。由参数摘要直接生成 UID 会合并合法独立请求；用 runId 派生 UID 也不能解决两次不同任务。

因此本轮保持生产行为与 Policy digest 绑定，不从连接器偷偷注入未授权模型参数，不把 unknown 自动 retry。未来完整修复应在原调用方生成/持久化操作身份，纳入原授权输入，再传递既有显式 UID；unknown 先按原 UID 读回核实。该跨模块变更不在本轮独立包内伪装完成。

这里的“未来完整修复”是对新产品需求的实现建议，不表示现有契约已被证实违反。既有同 run 记录和固定 UID 的幂等边界应保留。

新增一个生产 CalDAV provider 合成回归：两次同标题/时间且未指定 UID 保留两条合法事件；显式复用其中一个 UID、改变输入，报 `REVISION_CONFLICT` 且资源原文不变。既有测试另覆盖同 UID 同内容重放。这既复现清单中的机制，也防止 naive dedupe 引入数据丢失。

## 本轮验证与实际入口

- 当前树独立 `npm ci --ignore-scripts --no-audit --no-fund`，未借用其他树 dist/依赖。
- contracts、client、testkit、calendar build 及 calendar typecheck 通过。第一次 testkit build 缺 client dist，先补建依赖后成功，未改源码掩盖。
- `npm run test --workspace=@personal-agent/calendar`：130 项，127 pass，3 原真实服务门控 skip，0 fail。Node `24.19.0` / npm `11.9.0` 与仓库 pinned `24.15.x` / `11.12.x` 不同，不能称 pinned 环境验收。
- 新增回归位于 `packages/connectors/calendar/test/caldav-write.test.mjs`；现有 `显式 uid 创建重放幂等`、`write-tools.test.mjs` metadata 测试也通过。
- #503 后续本机合成入口：`apps/desktop/test/connector-change-host.test.mjs`（页面聚合、legacy 合并、silent、重启）；`mail-review-host.test.mjs`（失败/unknown 不重派、显式有界重试）；`apps/runtime/test/mail-review-task.test.mjs`（失败云尝试持久化、重启不重发）；`inbox-triage.test.mjs` 与 `mail-triage-analysis.test.mjs`（批次及分析收尾）。须在 #503 对应源码自行 build 后运行；本树未冒称执行这些新增测试。
- 没有真实账号、AgentArts 平台评测、Windows UI、ARM64 镜像运行或新镜像发布，本轮不提升真实证据等级。没有新公共接口、迁移或依赖。

## #8 最小实现与增量验证

`mail-history-card.js` 只消费现有 `counts.total`、许可、监测及执行状态；空闲且无许可时显示“历史分类 N 封 · 非实时”“需重新授权”。`connectors.js` 仅增加 import 和邮件 render 的两行调用。等待审批、读取、分类、停止未确认及失败不会被该历史分支覆盖；活动监测与现有许可保持原展示。历史未读数不能冒充当前未读数。卡片继续走 `connectorDestination('mail') → connections`，未新增读取动作。

独立树完整 `npm run build` 通过。增量 consumer 测试与既有空状态测试 10/10、无跳过；生产 pipeline 将合成信头分类写入临时加密存储，重新打开生产 QQMailTriageHost 后读取公开 snapshot，再传入生产卡片 renderer。断言历史总数 1，旧 analysis/startBatch 为 UNAUTHORIZED，provider connect/fetchPage 调用 0，preparePage 新许可创建 0。夹具加密为明确 Fake safeStorage，不代表操作系统真实加密验收。首次在 build 尚未完成时运行曾缺 runtime dist，完成当前树构建后全部通过。

本轮读取 frontend-testing-debugging 与 browser 技能；可发现工具中无 Browser `js`，无法初始化扩展浏览器。按任务允许的本地夹具验证，使用现有 Playwright 和系统 `/usr/bin/chromium`；默认 Playwright browser binary 不存在，未安装新依赖。生产 renderer + 现有 surfaces.css 的隔离合成页面在 1280×900 和 390×844 均显示历史提示，点击邮件卡片返回 `connections`，pageerror 为 0，截图在 `/tmp/connector-review-mail-history-{desktop,mobile}.png`。不是完整 Electron 设置页、IPC、真实重启或整工作台视觉验收。

截至本轮交付前再次查询，#503/#509 heads 仍分别为 `06a0848f`/`6853c87c`。用 `git merge-file` 对本改动、基线及两份准确 head 的 connectors.js 顺序三方合并无冲突，语法检查通过；合成结果同时保留历史分支、#503 监测展示、#509 天气配置及换城市按钮。未改任一作者分支。

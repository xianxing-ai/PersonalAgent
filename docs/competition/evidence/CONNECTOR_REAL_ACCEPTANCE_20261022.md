# 连接器及知识/开发消费入口真实验收前置核验

UTC：2026-10-22T04:21:26Z；源码：`c15855f5ccceb76d6bf794203d9ebfbe9cb83cb3`；分支：`codex/connector-real-acceptance-20261022`。目标 profile：`huawei_ict_agentarts`。本记录是当前 Linux 工作树的真实前置检查，不是业务全链通过。

已读取根 AGENTS、CONTRIBUTING、MODULE_ASSIGNMENTS、CURRENT_MOD_WIRING_HANDOFF、PRD/当前设计/接口目录及相关模块 README；`rg --files -g AGENTS.md packages apps docs` 没有额外子规则。初始 `git status --short` 输出为空，exit 0。Node v24.19.0 / npm 11.9.0。工作树没有 node_modules 或 apps/runtime/dist；未装依赖、构建、启用 Fake、新建 Runtime 或调度器。

## 逐项实际消费入口与阻塞

| 范围 | 当前源码消费入口 | 当前真实验收状态/缺项 |
| --- | --- | --- |
| MOD-20 calendar | `connector-conversation-tools.js` 的 calendar.events/create/update/cancel；main.js 原 conversationTools | blocked：没有当前受信 CalDAV 配置、原任务/Runtime transport。写/取消本轮未执行。 |
| MOD-20 todo | main.js 的 todoHost 原工具组合 | blocked：没有当前原任务与持久宿主。未以合成待办替代真实条目。 |
| MOD-21 mail | mail.inbox/accounts/mark_seen/save_draft/reconcile_send；mail-config 原 safeStorage、conversation 与 task 绑定；main.js 仅 configuredMail 存在才装 QQ 分类宿主 | blocked：没有可消费的原受信账号配置/Runtime。未读凭据文件或邮件正文；未真实发信/标记/保存草稿。 |
| MOD-22 feeds | feeds-host.js 的 feeds.collect/subscriptions，原 source grant 与 confirmed source receipt；main.js 原 conversationTools | blocked：缺原已配置订阅、精确任务来源批准与 Runtime。未自行新增订阅。 |
| MOD-23 notification | main.js 的 notificationApplicationHost 原工具及通知组合 | blocked：缺原事件/设备宿主；未用模型文字或 OS API 直调充当投递读回。 |
| MOD-24 research | public-connector-host.js 实际 OpenAlexProvider → product-tools-composition → main.js 原 Runtime 工具组合；research.search | blocked：当前工作树无依赖/产物、原任务/transport。OpenAlex 是论文来源，不能声称通用网页正文。 |
| MOD-25 weather | public-connector-host.js 实际 OpenMeteoProvider(strict) → 原 Runtime 工具组合；weather.forecast | blocked：当前缺原任务/transport 与明确地点。公开天气服务无账号不等于能绕过 Runtime/Policy；未 curl 充当产品验收。 |
| MOD-26 social | 当前接口目录仍 unavailable | unavailable：未选平台，不创建实现或假账号。 |
| MOD-06 MCP | reference-tools-host.js 本地只读 MCP 与 remote-mcp-host.js 受信远程绑定 → 原 Runtime 组合 | blocked：缺当前已选 server/目录摘要/原确认与 Runtime；未安装或自行选远端服务器。 |
| MOD-07 Skills | main.js referenceSkillSnapshot、publicSkillAvailability/原 manifest 与受信 source candidate，PUBLIC read run 派生 | blocked：缺真实已安装选择、源路径与原确认/Runtime；SKILL 本身不授予权限。 |
| MOD-08 Knowledge | knowledge-source-config.js → Obsidian pairing → createTrustedKnowledgeTools → 每次 withAuthorization/assertAuthorization → 原 Runtime | blocked：缺受信知识源及当前任务配置。未读用户 vault/私有数据库；未向云端发送笔记。 |
| MOD-09 Memory/Learning | Runtime application/memory.ts 的 MemoryQueryPort、FactChangeFeed、确认与 projection；main.js privateConsumption 出机重验 | blocked：没有当前原 memory namespace/真实来源及任务链。未读取私有数据库或构造事实替代真实事实。 |
| MOD-18 workspace | workspace-config-host.js 原 root identity、task binding、recipe/command/write 门禁 → main.js 原工具组合 | blocked：缺原可信 workspace 选择和 Runtime 任务。本轮 repo 静态读取是开发检查，不冒充产品 workspace tool 成功。 |
| MOD-33 GitHub | developer-deployment-config.js 原 provider/repository/credentials 配置与 exact metadata/result export → main.js | blocked：插件可读 GitHub 不等于产品 github.* 已经经 Runtime 执行；无原开发部署配置，不找旧 gh token 绕行。 |
| MOD-34/35 CI/test locate | 原 developerDeployment host / coding-tools dev workflows 与原 workspace/recipe/log scope | blocked：缺原真实失败 run、固定 recipe、工作区及 Runtime；未触发 CI 或修复 Git 写入。 |
| MOD-36 review / MOD-38 issue | 原 developer.workflows 与 GitHub 公开 port，精确资料出机/写入门禁 | blocked：缺原部署与 task binding；未发表评论、打标签、提交审查或创建 PR。 |
| MOD-37 API docs | 当前目录仍 ready 待开工 | unavailable：无已实现专属 consumer，不能虚报通过。 |

GitHub 当前普通注册操作逐项为：repo.get、actions.run.list、actions.job.list、actions.log.read、issue.get、issue.list、issue.label、issue.comment、pr.get、pr.diff、pr.create、pr.comment、pr.review.comment。repair.link/get 是独立 opt-in 接线，不从普通 GitHub 配置继承。上述全部未取得产品工具 run/Evidence，不计真实产品通过。

## 自然事件提醒全链

当前 weather/src/connector.ts 明确 `syncStrategy: 'on-demand'`；fetchChanges 抛 `UNSUPPORTED_CAPABILITY`，因此 forecast 两读不是自然显著天气变化监听。当前 mail 有 fetchChanges/原分类及单次消费入口，不代表新来源包的持续 watch 已到位。未取得主控给定的完整来源包前，不猜测 d9d07e5/docdb8085 的实现，不据未合并源码给通过。

逐段状态均保留：自然新邮件/显著天气变化来源 **blocked** → 原 Scheduler/watch 执行 **blocked** → durable event 与重启读回 **blocked** → Laya 判断 **not run（Desktop worker 串行专属）** → 主对话通知 **blocked** → 设备实际显示/读回 **blocked**。没有产生 eventId/taskId/runId/notificationId，不能用历史 QQ 单封信头、天气 query/watch 作者记录或 synthetic event 替代。

恢复入口：主控取得完整来源包并完成受信配置现场转接后，只消费原 Runtime/Client/Policy/ToolGateway；记录精确来源配置 revision、task/run、durable event ID/重启读回，再交 Desktop worker 串行 Laya/通知设备读回。邮件仅使用原批准的最小信头范围；真实出站、删除与新增付费不在本轮范围。

## 本轮命令证据

所有命令仅在上述隔离树执行，未调用真实账号 API。`git rev-parse HEAD`、`git status --short`、`git branch --show-current`、`node --version`、`npm --version` 均 exit 0。源码定位命令有两次负向路径探测（runtime-application.mjs、dev-workflows.ts 不存在），随后定位到真实 main.js/runtime.js/application 源码；不把缺路径误判成模块缺失。

检查命令 `test -d node_modules` 与 `test -d apps/runtime/dist` 均 exit 1，说明本树尚不具备启动产品 Runtime 的产物前置。没有运行测试，0 项真实产品业务通过；原因是当前无可用受信产品现场，不是跳过已可执行的真实账号调用。最终文档一致性使用 `git diff --check`，结果在提交回执记录。

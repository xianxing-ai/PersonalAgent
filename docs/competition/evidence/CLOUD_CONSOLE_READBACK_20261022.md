# AgentArts 控制台只读读回（2026-10-22）

- Profile：`huawei_ict_agentarts`。
- 工作树：`D:\worktree\f809\PersonalAgent\.worktrees\connector-real-completion`；分支：`codex/connector-real-completion`；调查基线：`16853f69cfc12a2fc715283b1ae723186b196d8c`。
- 记录时间：`2026-10-22T05:50:04Z`。页面读回发生于本次会话，记录时间不是各页面数据的生成时间。
- 方法：现有 Chrome 登录会话中的独立临时标签，仅通过 CUA 页面 UI 读取必要元数据；调查后已关闭该临时标签，未操控主控原标签。
- 范围：运行时、固定版本、访问入口、Trace 筛选、已有评估和评估对象调用配置。未创建或执行评估、部署、调用或调试，未修改权限、付费配置或资源。
- 数据最小化：不保存账户、agency、凭据、环境变量、请求输入/输出或完整详情快照；镜像 namespace 已省略。未使用凭据或控制台内部接口。

## 运行时与版本

页面来源：[运行时列表](https://console.huaweicloud.com/agentarts/?region=cn-southwest-2#/home/runtime/list)、[目标运行时详情](https://console.huaweicloud.com/agentarts/?region=cn-southwest-2#/home/runtime/detail?id=9a65747e-05f0-475c-a2dc-f24dd3ed87ae)、[版本列表](https://console.huaweicloud.com/agentarts/?region=cn-southwest-2#/home/runtime/detail?id=9a65747e-05f0-475c-a2dc-f24dd3ed87ae&tab=version)。

| 项目 | 页面读回 | 可证明范围 |
| --- | --- | --- |
| 区域 | `cn-southwest-2`，页面显示“西南-贵阳一” | 本次目标对象所在区域；精确目标已找到，无账号或区域不匹配证据 |
| 运行时名称 | `pa-owned-bindings-0dae0ff5-api` | 目标对象存在 |
| 运行时 ID | `9a65747e-05f0-475c-a2dc-f24dd3ed87ae` | 平台对象身份 |
| 运行时状态 | `正常` | 平台状态，不能代替真实调用与本地完成回执 |
| 创建时间 | `2026/10/12 21:37:38 GMT+08:00` | `2026-10-12T13:37:38Z` |
| 更新时间 | `2026/10/20 17:58:05 GMT+08:00` | `2026-10-20T09:58:05Z` |
| 固定版本 | `arm64-v5-d92a17a4-r3` | 版本列表与该版本详情均存在此版本 |
| 固定版本创建时间 | `2026/10/16 20:02:27 GMT+08:00` | `2026-10-16T12:02:27Z` |
| 固定版本镜像 | 区域 registry `swr.cn-southwest-2.myhuaweicloud.com`；repository `personal-agent-owned`；tag `workflow-v5-d92a17a4` | 固定版本详情字段读回；namespace 不公开 |
| 固定版本 digest | `unknown` | 未取得独立镜像制品 digest 读回；其他版本说明文字中的 digest 不作为本版本制品证明 |
| `Latest` 访问入口绑定版本 | `arm64-context-1-7-1020` | 访问入口表格的当前配置，区别于固定 r3 版本 |
| 该绑定版本镜像 tag | `context-owned-1.7-20261020` | 初始详情字段读回 |
| 入站鉴权方式 | `API Key 认证` | 配置类型；未复制或使用 key |
| 日志配置 | `已开启` | 配置状态；不证明指定调用已经产生 Trace |

`Latest` 与固定 r3 是不同的平台版本选择。本次只读未更改入口，也不能由该差异推断 Desktop 的固定版本请求是否生效；仍需具体请求与结果读回。平台描述文字中的源码版本或修复说明不是本地代码、整图执行或工具闭环证据。

## Trace 筛选

页面来源：[调用链分析](https://console.huaweicloud.com/agentarts/?region=cn-southwest-2#/home/observability/trace)。

实际筛选：时间“近1天”，对象类型“单智能体”，对象 `pa-owned-bindings-0dae0ff5-api`，Span `ALL Span`；自动刷新关闭。表格行数为 `0`，页面显示“暂未匹配到数据”“没有匹配到符合条件的数据”。

该结果仅证明当时上述窗口和筛选条件无匹配行。“近1天”没有被替换为 UTC 自然日，不能据此声称当日所有调用、其他版本或全部历史无 Trace。目标运行时能够出现在对象筛选器中，不能把无匹配行解释为平台不支持运行时。未读取任何请求输入、输出或会话内容。

## 已有评估与运行时调用配置

页面来源：[评估任务列表](https://console.huaweicloud.com/agentarts/?region=cn-southwest-2#/home/evaluation/evaluation-task)、[已有任务详情](https://console.huaweicloud.com/agentarts/?region=cn-southwest-2#/home/evaluation/evaluation-task/detail/21ff75e7-78f9-4af2-85d8-e3f29aec081c)、[创建页的对象选择窗口](https://console.huaweicloud.com/agentarts/?region=cn-southwest-2#/home/evaluation/evaluation-task/create)。创建页仅查看，未提交。

| 项目 | 页面读回 |
| --- | --- |
| 已有任务 | `PA-MVP-Rubric-v17-20260930` |
| 任务 ID | `21ff75e7-78f9-4af2-85d8-e3f29aec081c` |
| 类型 | `离线评估` |
| 评估对象 | `PA-MVP-协议与合法失败-20260930`；版本 `0.0.2`；对象类型 `评测集` |
| 状态与进度 | `成功`，`100%` |
| 执行时间 | `2026/09/30 20:25:56 GMT+08:00`（`2026-09-30T12:25:56Z`） |
| 结束时间 | `2026/09/30 20:26:14 GMT+08:00`（`2026-09-30T12:26:14Z`） |
| 运行时评估对象卡片 | “智能体运行时”页签列出 `pa-owned-bindings-0dae0ff5-api`，创建时间与目标运行时一致 |
| 目标卡片调用配置 | `未配置`，有“去配置”入口；未进入配置或调试 |

对象选择窗口提示：“针对运行时智能体，需先行完成相关配置，待调用配置调试验证通过后方可选择；当前暂不支持选择鉴权方式为 JWT 类型的智能体；”。本次运行时页签加载后实际有卡片，不应沿用早期空列表观察作为最终结论。

历史评估证明该指定评测集曾完成离线评估，不能证明当前固定 r3、当前代码、真实工具闭环或整图验收通过。运行时调用配置尚未配置，后续若要平台评估，需在另行授权的执行阶段完成所需配置与调试并读回评估任务结果。

## 本次结论与剩余项

已取得真实平台对象、固定版本与镜像 tag、`Latest` 绑定差异、指定 Trace 筛选空结果、历史离线评估和运行时评估调用配置未配置的安全元数据。该调查是平台配置读回，不是运行时调用或功能验收。

仍为 `unknown` / `not_run`：固定 r3 的独立制品 digest、当次固定版本调用与 Trace 关联、本地任务完成读回、真实工具闭环、当前运行时平台评估结果。未用 Fake、历史任务、说明文字或无数据页面代替这些项目。按主控新优先级停止进一步页面探索，保留以上继续入口。

验证：纯文档差异检查；无需启动服务、构建或真实 provider。

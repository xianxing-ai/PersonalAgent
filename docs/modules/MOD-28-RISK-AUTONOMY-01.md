# MOD-28-RISK-AUTONOMY-01：用户可调风险档

- 状态：`review`
- Profile：`huawei_ict_agentarts`
- 负责人：zemeng5208
- 目录：`packages/autonomy`；Runtime 可选钩子在 `apps/runtime/src/application/runtime-application.ts`
- 不在范围：Desktop Renderer / 设置界面、MOD-20～26 业务连接器、MOD-19、Policy 的 grant/authorize/revoke 语义、PR #531 的仓库级常驻授权

## 行为

`AutonomyPolicyConfig` 默认 `autonomous`。产品 Desktop 在创建 Runtime 时传入这一档；库构造不传或传入 `false` 时只保留 `automaticTools`。分类表里的低风险直接做，有补偿的中风险在成功后通知。未列入分类表、且用户没有撤销或改成先问的工具，仍按 `automaticTools` 自动执行。

设置由桌面加密存储 `risk-autonomy.json` 跨重启保留。中风险通知使用现有 `createDesktopNotificationPort`。用户点击通知后，宿主提交已保存的补偿调用，并按原审批接口确认这一次。

设置页在通知页上方，只有档位、收起的「只读 / 可回滚的本地修改」、一个停止或恢复按钮，以及最近记录。没有统计面板、保存按钮或每条记录上的按钮。不可逆动作只用一句话说明，不提供控件。

`setCategoryOverride` 拒绝把 `message_send`、`payment`、`delete`、`external_submit`、`presence`、`local_write` 设成 `execute` 或 `execute_and_notify`。`revoke` 让后续决定全部先问。自动执行写入审计和通知，不保存参数正文。

`applyAutonomyGrant` 是给现有 `AuthorizationPolicy.grant` 的输出。Runtime 的 `riskAutonomy` 未安装时，`automaticTools` 保持原样。

## 设置接口

前端可调用 `describeSettings()` 读取档位、撤销状态、revision，以及每个类别允许的处置。本工作包不实现设置页面，也不写 Desktop IPC。

## 验证与限制

包测试覆盖分类、三种档位、覆盖、撤销、不可逆动作不能自动、审计/通知/补偿，以及 `applyAutonomyGrant`。Runtime 测试覆盖未安装钩子时仍先问、自主档执行低风险和可补偿写入、外部写与错误放行仍先问、撤销和保守档可以收回 `automaticTools`。

未做：设置界面、配置的跨重启持久化、真实通知渠道投递、补偿动作的实际执行与外部读回。补偿请求只返回动作名和摘要，仍要走原来的 Policy / ToolGateway。接口保持 provisional，不把 Fake 通过写成冻结或真实验收。

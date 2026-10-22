# 连接器变化到主对话的本地提醒判断

状态：in_progress；Profile：`huawei_ict_agentarts`。实际工作树
`D:\worktree\f809\PersonalAgent`，分支 `codex/autonomous-change-loop`。
本轮由 Owner 授权 Codex 实施并委派三个有界子代理；既有模块归属不变。

## 已实现的生产链

`connector.watch.start` 原工具审批 → 原 Scheduler 唤醒 → 原 ToolGateway 读取 →
原 Runtime 确认记录/缓存/Evidence → 变化基线与去重 → Runtime Application 中的本地 Laya 判断 →
主对话原任务与既有通知策略/渠道/投递回执。

`connector.watch.start/list/stop@1.0.0` 为 provisional 工具，不是新增 Core wire operation。
start/stop 不列为 automaticTools。原 Client 的精确参数审批确认后，宿主才可消费该订阅许可，
为准确查询签发逐次单用读取授权。start 的 source 为 `mail` 或 `weather`，必须给
`intervalMs` 和 `expiresAt`；天气还必须给用户指定的 `query.location`，可选 locationQuery/units。
list/stop 按原用户对话隔离。注册目录、保存设置、具有账号均不构成开始读取的许可。

示例意图是“在指定截止时间前，每十分钟关注指定城市天气；变化由 Laya 判断是否提醒”。
地点、间隔和期限须进入原批准参数，不推断用户位置、不因单次天气查询创建订阅。
两种来源目前均为 **poll-only**，不宣传成 IMAP IDLE、供应商 webhook 或即时天气推送。

| 来源 | 变化和权限边界 |
|---|---|
| 邮件 | 复用原 QQ 信头读取/加密分类存储；首次完整同步及 UIDVALIDITY 变化只建基线，后续新 dedupeKey 才触发。分页、已读状态及抓取时间不制造新邮件。同邮箱仅一项活动订阅，真实 Runtime 页绑定原订阅与主对话；普通/手动读取在实际读取前冻结原配置散列和主对话，历史结果不可套用新账号。stop、到期、配置撤权后不再告知。 |
| 天气 | 同地点坐标/时区、日期、单位建立基线；8°C 温差、降水概率达到60%且上升40个百分点、强风增幅、严重天气码变化进入候选。阈值只是候选筛选，Laya 仍可忽略。缓存时间、普通波动和 stale 回退不触发。积压或推理中被新显著变化取代的旧事件不再通知；天气反转后再次恶化形成新的观察版本。 |

Laya 使用当前已启动的本机端口选择 notify/defer/ignore，没有新增 Local Agent profile。
缺模型保持 pending；不确定结果暂缓。候选不是业务动作、Policy grant 或完成证明。
只有 notify 的判断任务进入原用户主对话；通知正文使用固定的本地摘要，不把邮件主题、
发件人、地址或正文复制到 OS 通知、额外 host-state 或云端。defer 保留事件和状态计数，
尚无专用的返回摘要入口。

## 恢复与架构

- 来源基线、事件和订阅保存于原 TaskRuntime host-state CAS；无数据库迁移、独立任务库或新定时器。
- 来源基线按原 watch 及主对话责任隔离；相同地点的两个订阅不会互相吸收变化，停止一项不会吞掉另一项的提醒。
- 本地判断和 Scheduler 唤醒收口由 `apps/runtime/src/application/connector-change-task.ts` 执行，
  Desktop 不直接运行 Runtime worker。仅无工具/云调用的纯本机判断可在原 deadline 内恢复；
  已保存决定只补原任务收尾，不重复推理。过期未决明确暂缓，取消/未知执行保持原围栏。
- pending weather 读取的 prepare/finalize 两侧崩溃均读回同一 task/command；unknown 不重发。
- 邮件本地读取许可与活动 token 不跨重启恢复。旧 pending token 无法附着到另一批读取，
  需要显式新订阅/许可；不自动续期。停止、到期、账号/查询配置变化会撤回未用授权。
- 原通知 Host 保留静默、暂停、额度与渠道规则。未知 native show 只查同一 interruption round，
  不因重启重发；记录 intent 或对话卡片不等于 OS 已展示。
- 应用退出先停止订阅调度，再取消本地判断并等待收敛，最后按原退出流程关闭 Runtime。

接口依据见 [ADR-0035](../adr/0035-connector-change-triggers.md)。没有新依赖或锁文件变化。
`QQMailTriageHostOptions.onReadTask` 是可选宿主回调，只给实际 taskId/sessionId；
绑定失败立即停止该页租约，不返回邮件内容。普通连接器宿主另有同步可选
`onReadTask({taskId,runId})`，在真实读取前冻结原配置/主对话；回调失败不访问 provider，
不改变原独立批准的普通读取与本地分类许可之间的边界。

## 子任务的多工具续接

默认真实鹈鹕验收发现旧云续接只能汇总一次读取，已补原目标与初始目录绑定的显式
`continuationContext: 'goal'` 协议。实际子 worker 可继续提案；普通父对话保持汇总，
每次重查原目录和权限，不引入新工具或延长预算。详见
[ADR-0036](../adr/0036-goal-bound-tool-continuations.md)。
当前没有改动用户云部署 pin，也没有把旧部署默认为新协议兼容。源码回归与云端发布
分别记账，仍不能据 Fake 多步成功宣布默认实际云端的个别工具循环通过。

## 本地验证与真实边界

Node 24.15.0 / npm 11.12.0。实际 Runtime/SQLite/Scheduler/Policy/ToolGateway 与原业务注册器：

- 变化判断及恢复 25/25；持续订阅及恢复 17/17；完整 watch→读取→Laya 选择服务→原通知回执 2/2；同地点多对话责任 1/1；邮件原配置绑定 3/3，共48项。
- 邮件原宿主回调/读取/退出组合 34/34；工具目录及真实部署工厂 7/7。
- 多工具续接新增20项及既有受影响回归140项通过；AgentArts新旧续接/模型选择回归39项通过。
- 完整 `npm run check` 最终 exit 0：架构、契约、生成类型、全工作区构建/类型检查/测试、跨模块集成均通过。
  该次 Desktop 1631项（1624通过、7跳过）、Runtime 1053/1053、集成51/51；原生helper采用当前外部bundle，TEMP/TMP在仓库外。
  原始日志保留在 `.cache/connector-check-final.log`。检查启动后的退出收口增量（关闭后迟到事件不再访问已关闭数据库）
  另以变化判断25/25复验通过，未为单行收口重复全套检查。
  首轮架构门禁正确拒绝 Desktop 直接启动 worker，已将执行移回 Runtime，没有削弱门禁。

以上提供者、协调器、推理及 native 展示为显式 Fake/合成端口；不是实际邮箱、真实天气变化、
真实 Laya 判断质量或 Windows 人工查看的验收。新两项整链测试使用原 Client 提交和批准、
真实 LayaActionChoiceService 配合 Fake inference；停用后的已确认事件仍受原来源围栏拒绝。

默认 Desktop 的真实鹈鹕验收单独记录在
[真实入口证据](evidence/CONNECTOR_TRIGGER_PELICAN_20261021.md)。验收发现统一命令仅注册时
误隐藏固定测试命令，已改为按同任务实际 readiness 折叠 alias；原 alias 权限检查保留。
原始失败、未变的产物以及后续续接问题全部保留，父/子 succeeded 不能代替真实修复与检查。

当前默认 UI 聚合入口已实际进入原 F15，原 start 已审批确认；N01 因本地 Laya 未启动失败。
随后在隔离实例通过原设置页启动被原2 GiB可用内存门禁拒绝（实测约1.67 GiB），没有降门禁、
关闭用户应用或修改云 pin。默认真实鹈鹕仍未通过。另原 Local/Pangu Desktop 组合冒烟在
取消任务后等待服务端 HTTP 提前关闭断言超时；原取消任务约5ms内到 cancelled，不能把这个
终态冒充传输关闭。短时独立回环探针中的原Pangu/ModelGateway及原生fetch取消均关闭连接，
不足以对原Desktop场景归因；该组合冒烟保持未通过，未改Local生产路径或放宽断言。

用户先选择“先保留代码和证据，真实验收稍后继续”，随后明确恢复“真实验收”，并授权从应用发到云端。
恢复后的当前真实记录如下；旧失败和延期记录保留于各 Evidence，不作为当前通过证据。

- 默认天气真实查询、原审批订阅、两轮 Scheduler 读取、同订阅重启后新一轮读取、原审批停止和停后17秒无读取通过。
  首轮两次调度读取命中原有效缓存；增强复验的重启后sequence2由原Scheduler产生新host任务，
  原单次授权已消费，冷缓存下Open-Meteo真实fetched。未覆盖同一进程TTL自然到期重新抓取；
  未出现自然显著变化，未启动Laya。
  详见[天气真实记录](evidence/CONNECTOR_WEATHER_LIVE_20261021.md)及[独立复核](evidence/CONNECTOR_LIVE_REVIEW_20261021.md)。
- 真实QQ认证、一次INBOX信头读取、原出机门禁、实际AgentArts结果续接与原父子成功已通过。
  仅处理一封信头，未读取正文或写入邮件；原私有结果只在隔离SQLite，公开证据脱敏。
  详见[邮件到云端真实记录](evidence/CONNECTOR_MAIL_CLOUD_LIVE_20261021.md)。
- 默认鹈鹕已实际加载Laya；真实目录暴露固定worker配置字段的问题已收窄Schema，并保留原防替换guard。
  修正验收器审批后，新独立fixture的原start与decision均confirmed/allow；决策工具返回owned-review，
  F15停在sequence2/N01 unknown，原子任务waiting_reconciliation，未执行业务读取、补丁、N05或CAS。
  该返回值不能区分模型主动选择复核与uncertain/abstain/unavailable的安全fallback，原回执未保存此细分原因。
  原候选保留项owned-review的Runtime路由已修复，28项定向回归通过，未强行选择业务候选。
  默认鹈鹕真实修复仍未通过，详见[最新实际记录](evidence/CONNECTOR_TRIGGER_PELICAN_20261021.md)
  与[独立复核](evidence/CONNECTOR_LIVE_REVIEW_20261021.md)。

恢复验收后的最终根 `npm run check` 完成架构、契约、生成类型、构建、类型检查和其余workspace测试，
但 `apps/agentarts-runtime/test/test-version-controller.test.mjs` 原生进程退出
`3221226505 / 0xC0000409`，整条命令exit1，根integration因原`&&`尚未运行。
Desktop为1632项（1625通过、7跳过），Runtime为1074/1074。
无其他app/模型时保持原脚本和断言复跑：原失败文件2/2，整个AgentArts Runtime包213项
（207通过、6跳过、0失败），均exit0；未复现原生退出，不能据此确定根因。
日志保存在`.cache/connector-check-live-final.log`、`.cache/connector-test-version-controller-rerun.log`、
`.cache/connector-agentarts-runtime-workspace-rerun.log`；详见独立复核末节。

用户最终要求提交本轮修改，随后做最后测试，并将全部剩余工作移交“同步仓库”。
源码本地提交为`d9d07e5098a9ecd645ea40842bfe27b14fa3f827`，包含51个本轮文件；
未纳入`.codex`、缓存、真实配置、凭据或数据库。提交后执行原根`npm run test:integration`，
51/51通过，exit0，33157ms；日志为`.cache/connector-postcommit-integration.log`。
三个manual runner的`node --check`及`git diff --check`均通过。没有为这次测试改变生产源码、
断言或预算，也没有将前述根check的exit1改写为通过。

后续唯一接手对话为“同步仓库”。待办包括默认鹈鹕unknown的真实原因诊断/修复与完整复验、
自然新邮件/显著天气变化经Laya到实际提醒的验收、其余连接器的持续来源适配，以及新续接
协议的云端部署兼容/发布验收和PR集成。原私有邮箱SQLite与加密配置不随交接公开或传输，
后续真实账号范围仍须依照用户已有授权。原未决任务不重放，不强选Laya候选或降低权限门禁。
当前工作包保持in_progress；本轮不推送、不创建PR、不部署或合并。

其他连接器的持续来源、所有外部系统即时推送、自动完成任意修改，以及云端多工具续接和发布
仍需各自的生产适配与实际证据。本工作包不据这两项来源宣称全部连接器或完整自主闭环完成。

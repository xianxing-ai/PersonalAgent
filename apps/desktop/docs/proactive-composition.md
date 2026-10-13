# Desktop 主动认知装配增量

<!-- current-design-20261009 -->
> 当前目标与协作规则（2026-10-09）：[完整设计](../../../docs/design/resident-developer-agent-20261008/DESIGN.md) · [离线阅读/全部 SVG](../../../docs/design/resident-developer-agent-20261008/index.html) · [两人确认与本机阅读门槛](../../../docs/reviews/DESIGN_READING_GATE.md)。WSS 主通道、HTTPS 备用；Wiki 记忆由 goo122 接入。goo122 与 Potatos498 均确认后才可按授权合并，禁止强制合并/管理员绕过。设计不等于已实现；本文历史验收与作者记录保留，旧合并规则以当前门槛为准。

> 维护入口（2026-10-07）：项目主要负责人为 zemeng；当前分工以 [模块分工](../../../docs/MODULE_ASSIGNMENTS.md) 为准，最新状态见 [ROADMAP](../../../docs/ROADMAP.md)。历史日期、作者和验收结论按原记录保留。

负责人 zemeng；MOD-11 消费 MOD-17、MOD-27/28，目标 profile 为 `huawei_ict_agentarts`。
入口为 `electron/proactive-composition.js`。无新增包、Schema、数据库迁移或模型入口。

## 已复用的实现

- `CompetitionFactHost.drain/processImpacts/listImpactReceipts/readCompletedImpact`：复用公开事实流的持久确认、精确投影和影响传播；不另建 feed 或访问私有数据库。
- `client.call('task.submit')`：复用 Competition Runtime 与 AgentArts 路径；保存确定性幂等键、原始请求及返回 taskId，`refresh` 读 Runtime 的真实任务状态。
- `RuntimeApplication.readRepairCandidate/submitLocalRepair`：复用已有最小修复候选与本地执行边界。候选须已有 source task、工具证据及可信 binding；缺失时原接口拒绝。提交后可能仍 `waiting_approval`，不能算执行成功。
- 系统观察仅接受可信宿主调用 `readHostToolTask` 得到的成功、已确认 `computer.system.observe@1.0.0` 结果。禁止将 Renderer、模型或 IPC 提供的对象直接传入该入口。
- 状态使用宿主注入的现有同步 `StoragePort.get/set`，单键保存游标、异常状态、建议和分析请求。生产必须用户隔离且持久化；测试 Map 只是显式 Fake。

初次核对本地 `origin/main` 为 `0aceae8`；主代理更新后已核对 `9c40a08`，其中 `1185e29`（#177）提供受信 Competition Fact host，并固定装配时 scope 防止后续配置变更。依赖 `5afaccb`（#162，公开事实流及撤回）、`9a18131`（#135，Goal 范围修复）、`cfc7863`（原子修复）均已存在于当前工作树历史。远程 main 没有 Desktop 主动认知装配；本工作树已有 `competition-fact-bridge.js` 只处理合成会议来源的恢复。

## 主进程注入

```js
const proactive = createProactiveComposition({
  application, client, storage, factHost,
  cloudEnabled: () => settings.proactiveCloudAnalysis === true,
  // 可选：将用户批准的公开事实范围转换为现有 AgentArts 可消费的输入。
  // 不可直接 JSON.stringify 完整建议（含本地 namespace、图引用、证据）。
  projectFactImpact,
});
proactive.start();
const release = proactive.subscribe(suggestion => showLocalSuggestion(suggestion));
// 由现有 Runtime 调度或可信事实源变化触发；此模块不创建定时器。
await proactive.drainFacts();
// 仅在已授权系统观察工具完成并经 Runtime 读回后调用。
proactive.acceptObservation(application.readHostToolTask(observationTaskId));
// 应用退出：release(); proactive.stop();
```

生产 Fact host 通过 `application.createCompetitionFactHost({memoryPath, memoryNamespace, graphNamespace, consumerKey})` 获取，使用独立于 Runtime 的 SQLite 文件、绑定当前用户的命名空间，以及独立于合成演示的 consumerKey。同一实例交给可信源接入与此消费者。可信源调用 `recordPublicSource` 前须独立读取已批准公开来源，取得 SHA-256 内容版本及当前 `readPublicSourceHead`；没有真实来源时不得调用合成桥接并声称生产观测。

观察工具的 Runtime 装配需 `hostUserNamespace`，用户命名空间及每次采样的 `commandId` 均满足 `[A-Za-z0-9._:-]{1,128}`。采样提交使用 `submitHostToolTask({commandId, toolName: 'computer.system.observe', toolVersion: '1.0.0', arguments: {}, deadline})`；同一次调度重试保留 commandId，新样本使用新 commandId。保存 taskId 并等待真实终态；Runtime 自行绑定工具参数、审批和证据，消费者不能提供授权令牌。

持续监控使用新增的受信 Runtime 专属入口，避免每次创建待审任务：

```js
// 仅由受信 IPC 校验过的用户明确启用操作调用；不从历史设置自动恢复。
const lease = application.startSystemObservationSession({
  expiresAt: new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString(), intervalMs: 30_000,
});
// 现有宿主 tick；Runtime 自行拒绝过密或重叠采样。
const sample = application.sampleSystemObservationSession(lease.sessionId);
// sample.state: sampled / busy / not_due；前两者包含 sample.sample 的任务读回。
// 用户关闭：同步撤销租约、撤销当前一次授权并取消当前采样。
application.stopSystemObservationSession(lease.sessionId);
```

该入口严格固定 `computer.system.observe@1.0.0`、空参数及 `computer:system:read` scope，且要求注册工具是 read 且无需 presence。拒绝额外配置字段；间隔至少 1000ms，期限必须晚于当前时间且覆盖一个间隔。每次生成独立持久任务、一次性 Policy grant、ToolGateway 执行和 Evidence。租约仅在当前进程内存在，Runtime 关闭会撤销；到期阻止后续采样并限制当前执行 deadline。重复 start 报 `REVISION_CONFLICT`，不会刷新原许可。失效/撤销报 `UNAUTHORIZED`，首次检测到期报 `TIMEOUT`。没有新增 wire operation、迁移或任意工具授权入口。通用 `tool.invoke` 也校验租约，持久化授权不能在重启后绕过此检查。

`list()` 可恢复未展示建议。`subscribe` 只发送后续变化，展示失败不会删除持久建议。
主进程可将建议交给现有通知服务，其 `ingest/drain/acknowledge` 负责安静时段、聚合及交付确认；本模块不伪造 `notification.created` 或自动确认已展示。

默认 CPU/内存达到 90% 且连续至少 60 秒才提醒；两个有效样本间最多 45 秒。
同一持续异常只提醒一次。降到 80% 以下（含 80%）后允许新的异常周期，仍遵守 5 分钟冷却。
重复、乱序样本忽略；过期、未来、注入源或未确认样本拒绝。阈值及持续时间由可信宿主参数配置。

## 云端与执行边界

云分析默认关闭。设置文案应明确：**启用主动云端分析后，仅发送 CPU/内存占用比例、采样来源、采样时间和持续异常起点。** 不发送机器名、进程、路径、证据标识或账户标识。开启设置后由宿主显式调用 `analyze(id)`；设置本身不授权系统调整。事实分析另需 `projectFactImpact`，缺失时报 `FACT_CLOUD_PROJECTION_UNAVAILABLE`，不自动外发整张图。

`analyze` 返回受理状态，`refresh` 返回 Runtime 真实状态和已存在候选；分析成功也不代表修复成功。传输失败保留 `submission_unknown`，只允许宿主明确重试同一持久化请求和幂等键。停止会取消尚在等待的 Client 请求，但已受理任务仍须通过已有任务取消/读回路径处理，不能声称已停止执行。

`submitRepair(id, {evidenceId, deadline})` 是显式用户/可信宿主动作，调用既有 Runtime 修复接口；不会创建授权，不会自动调用。未知结果和审批由 Runtime 决定。当前没有持续副作用授权装配，因此后台不会自动执行修复。

## 未交付与验证

当前交付可运行的事件消费者、持久建议恢复和受限 Runtime 持续观察租约；宿主 tick、通知展示及设置接线由主进程集成。事实云投影、source tool 证据与 repair binding 未注入时，完整事实→云候选→本地修复链仍受阻；不把本地影响分析冒充云端最小修复。

专项离线测试：`node --test apps/desktop/test/proactive-composition.test.mjs`。
覆盖持续异常、毛刺、采样中断、恢复冷却、重启去重、合成/未确认来源拒绝、默认禁云、最小聚合出机、真实任务状态映射、事实回执重放及未知提交幂等。未调用真实云、采集真实机器指标或启动 Electron。

Runtime 专项 `node --test apps/runtime/test/system-observation-session.test.mjs` 验证独立采样证据、一次性授权消耗、单执行与关闭取消、期限及进程关闭、重启后通用工具入口拒绝遗留授权；使用显式 Fake 观察工具。接口仍为 provisional。

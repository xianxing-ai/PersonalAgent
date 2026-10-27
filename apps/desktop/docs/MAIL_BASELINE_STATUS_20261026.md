# 新邮件首次基线的私有状态展示

主集成状态：Root 已应用五文件增量，`main.js` 的 `mailSnapshot()` 已接入指定 watch 的基线投影。Desktop 语法检查和 68 项受影响回归通过；后续状态文案调整的 17 项回归通过，实际 Renderer/Admin/CSS 的 Edge 渲染检查通过。渲染使用合成 IPC；独立真实 WatchHost／MailTriageHost／Runtime／Policy／ToolGateway 至 Main AST 的夹具使用 Fake QQ、Laya 与审批。下文“尚未应用”的文字保留为作者交付时记录，当前接线及证据以[主集成增量回执](../../../docs/competition/evidence/desktop-integration-20261025/mail-baseline-ui-20261026.json)为准。该 UI 晚于 A11 整仓源码快照，不沿用 A11 的全量通过声明。

2026-10-26，`huawei_ict_agentarts` Competition Profile，隔离工作树 `codex/large-runtime-repair-20261026`。本包只增加 Desktop 私有投影和邮件设置页文案，不增加公共 Schema、任务库、轮询器、读取许可或模型能力。`connector-change-host.js` 的 observe/UID epoch/授权判定继续沿用已审 v4c 语义。

## 状态来源

`connector-change-host.js` 只在原 `readWatchOrigin` 给出邮件 watch 绑定、来源配置匹配且已确认的 `mail.inbox` 结果进入现有 CAS 更新后，保存按 watch ID 哈希索引的私有 `{watchId,domain,configurationRef,readySource?,readTaskId,originTaskId,originRunId,conversationId}`。它只用于显示；是否产生新邮件事件仍由原 `mailEpochs` 当前指针、`sources[source].initialized` 和已确认 UID 水位决定。新建的 source 另带仅供展示的 `baselineProjectionVersion:1`；旧 source 不回填，避免升级前宽松 `initialized` 状态被误读为新版基线证明。

仅 `snapshot({mailWatchId})` 投影该 watch 的 `mailWatchBaselines: [{watchId,state}]`；无参数的原快照保留计数、返回空数组，避免每次 UI 帧扫描旧 watch。单个 watch 的事实按 host 写入版本缓存，来源原始映射不回传 UI。每次投影仍调用可信 `readWatchOrigin(readTaskId)`，由原 watch host 复验批准、启停、到期、来源配置与原任务，并再次比对 watch/source/config/原 task/run/conversation；失败即 `unknown`。`state` 有 `establishing_baseline`、`ready`、`epoch_pending`、`unknown`，无账户、标题、UID、游标、邮件内容或配置哈希。旧持久状态无映射或无新版来源标记时不推断 ready。`waiting_first_read` 由 Main 在当前启用 watch 尚无已确认读回、也无 `lastCheckedAt` 时投影；已检查过却无映射为 `unknown`。`ready` 只反映 v4c 已审的本轮当前 epoch 基线判定与新版展示来源，不由分类任务 `complete` 或轮询器 `monitoring` 推断。

邮件设置页在原监测状态为 `monitoring` 而基线未确认时显示“监测计划已建立”或“监测状态待核实”，并分别提示等待首次读取、建立首读基线、基线已建立、当前 UID 历元待确认或状态未核实。`ready` 只确认基线，后续是否提醒仍取决于本机判断和通知设置，不声明当前通知权限。旧 watch 同 epoch 可能持续显示 unknown，文案不承诺下一轮自动解除，提示持续未恢复时重新启动监测。停止/撤销、配置和分类按钮原有条件不变。

## 必需的 Main 装配

当前 `main.js` 的 `mailSnapshot()` 只返回 `connectorWatchHost.snapshot().watches`，没有把指定 watch 的 `connectorChangeHost.snapshot({mailWatchId}).mailWatchBaselines` 接入 `mail.monitoring`。因此必须由 Main 负责人应用本包旁置的精确 hunk：`.cache/xhigh-mail-baseline-status-20261026/main-mail-snapshot-hunk.patch`。该补丁只在 `mailSnapshot()` 中为当前 enabled 邮件 watch 设置 `monitoring.baselineState`，没有复制或覆盖 Main 其他修改；对当前隔离树 `git apply --check` 已通过。未应用它之前，本包页面会保守显示“基线状态未核实”，不会声称已经展示实际 watch 阶段。

原 `connectorChangeHost` 配置了 `onUpdate:publish`；CAS 观察更新会触发 SnapshotPublisher 的全量投影。Admin 由 `snapshot(undefined).mail` 接收 `mailSnapshot()`，SnapshotReceiver 每次接受版本后调用 `mountAdmin.render`；连接页每次调用 `mailControls.render(data.mail)`。Admin 的记忆页早退键和模型正文保留键不拦截连接页。定向测试用真实 SnapshotPublisher → SnapshotReceiver → mountAdmin → mail controls，在仅 `baselineState` 改变时验证文字随之更新。

## 验证与边界

- 先红：`xhigh-mail-baseline-status.test.mjs` 在修改前有 2 个行为失败，host 无投影，视图把缺映射显示为“监测中”；日志 `.cache/xhigh-mail-baseline-status-20261026/before-tests.log`。更早的 `fixture-first-failure.log` 是夹具把外部写工具列为 routine 的配置错误，已修正并保留。
- 修改后定向 5 文件（本包、connector-change-host、mail-monitor-startup、UID epoch、持久游标）共 68/68 通过，日志 `.cache/xhigh-mail-baseline-status-20261026/after-tests-reviewed.log`。最后将 ready 文案收紧为仅确认基线后，本包及 mail-monitor-startup 两文件 17/17 通过，日志 `after-ui-final2.log`。覆盖同 epoch 旧持久状态、新 epoch、撤销/错 watch/到期的 fail-closed 投影；包含真实 Runtime/Policy/ToolGateway + 显式 FakeMailProvider、合成 DOM、原 Admin 快照发布与接收路径；没有真实邮箱、Electron GUI 或模型验收。
- 原 `frequent UI snapshots` 用例通过，未把每次 UI 帧变成邮箱 heads 状态重读。`git diff --check` 对本包源码通过。Main 装配 hunk 尚未应用，因此真实产品全链显示待 Root 合并后再核。

必要风险：新私有映射仅从本次以后经验证的 watch 邮件读回建立；旧 DB 的同源 `initialized` 不回填 ready，可能直到重新启动获批 watch 或新 epoch 建立新来源才可显示阶段。UID 历元同一时间戳冲突时显示待确认；不以 UI 文案扩大实际通知权限。

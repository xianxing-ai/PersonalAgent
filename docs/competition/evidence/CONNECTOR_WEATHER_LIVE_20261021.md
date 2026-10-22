# 默认 Desktop 公开天气持续订阅真实验收

第一轮回执状态：`passed_real_default_desktop_public_weather_watch`，只对应当时的验收门槛。该轮于 2026-10-21 15:01:12.224–15:02:25.166 UTC（北京时间 23:01–23:02）真实执行，runner exit `0`。目标为 `huawei_ict_agentarts`；工作树 `D:\worktree\f809\PersonalAgent`，分支 `codex/autonomous-change-loop`。没有提交或推送。

已验证默认主对话经真实 AgentArts 子任务查询公开天气、精确批准持续订阅、原 Scheduler 两次确认读取、Desktop 重启后订阅存在、默认 UI 停止及停止后无新增读取。第一轮没有等待重启后的新读取，因此“重启后自主继续读取”为 `not_run`；持久订阅存在不能证明该项。没有出现自然显著变化：`no_significant_change`；真实天气变化后 Laya 是否提醒仍为 `not_verified`。

增强 runner 已于 2026-10-21 15:18:44.782–15:20:41.091 UTC（北京时间 23:18–23:20）在主控 GO 后真实执行，exit `0`，满足重启后新读取的增强门槛。第一轮原回执、SQLite 和截图保持原样；增强结果另存唯一目录 `desktop-weather-watch-live-k3MKzk`，详见本文末尾。

入口：[desktop-weather-watch-live.cjs](../../../tests/manual/connectors/desktop-weather-watch-live.cjs)。固定公开测试地点为北京/Beijing，不代表用户位置。

验收沿生产默认主面板提交天气查询、精确持续订阅和停止请求。订阅明确指定 15 秒只读间隔及 UTC 截止时间；首次启动采用当前加密 AgentArts 配置，仅复制 `agentarts-config.json` 和 `Local State` 到独立 `.cache/desktop-weather-watch-live-*` 目录，不复制邮箱配置、邮件凭据、用户历史或其他业务数据库，不启动第二个 Laya 模型，不注入 Fake Provider/模型/协调器。

成功门槛：

- 原默认父子任务及 AgentArts 请求身份持久化，实际子目录公布所需能力；请求和审批都从默认 UI 发出，原 ToolGateway 返回 Policy allow/confirmed。
- 原 `weather.forecast` 结果的提供者为 `open-meteo`，缓存状态为本轮真实取得的 `fetched` 或 `fresh`，不接受 stale/失败结果。
- 原 Scheduler 至少产生两轮不同序号的已确认读取；完整订阅参数和原责任保存在原 SQLite。
- 关闭并重启本 runner 自己创建的 Desktop，读回同一持久订阅；重启后必须产生新 taskId、递增序号且读取开始时间晚于重启标记的已确认天气读取。读回其精确 fired Scheduler admission、原冻结查询/配置/责任、对应单次授权 `usesRemaining=0` 及一条本任务工具执行，才计为重启后继续读取。
- 上述新读取确认后，在默认主对话提交精确 stop，通过原审批，观察 `17000ms` 后无新增读取，关闭后继续只读核对 SQLite。
- 未出现自然显著天气变化时记录 `no_significant_change`。不制造天气数据，不强制 Laya 选择；该运行即使通过，也不证明真实天气变化提醒已完成。

本轮主控已授权加密配置输入并释放运行资源。启动前 `node:os.freemem()` 读到约 2.66 GiB 可用内存；CIM 内存查询受限，未将其失败输出当作实际内存值。首次沙箱内 `realpath` 返回 `EPERM`，通过平台提权审查后执行同一 runner，没有修改访问保护。

复现使用显式授权的本机路径设置环境变量。路径和加密文件只留本机，不向聊天提供解密凭据。

```powershell
$env:PA_MANUAL_DESKTOP_WEATHER_WATCH_LIVE='1'
$env:PA_WEATHER_ELECTRON='<absolute path to electron.exe>'
$env:PA_WEATHER_SAVED_CONFIG_DIR='<authorized encrypted AgentArts config directory>'
& '<absolute path to node.exe>' tests/manual/connectors/desktop-weather-watch-live.cjs
```

每次运行保留唯一目录中的 `receipt.json`、隔离 SQLite 和公开测试截图，不提交原始 user-data。回执仅投影任务/请求标识、原工具状态、目录名称、公开天气、订阅和调度信息；不包含 Authorization、加密配置正文或邮箱数据。

原始本机回执为 `.cache/desktop-weather-watch-live-xfbPX6/receipt.json`，隔离数据库为同目录 `user-data/runtime.sqlite`；另有 `weather-watch-before-restart.png`、`weather-watch-stopped.png`。这些原始材料在忽略目录保留，未提交加密配置或完整 user-data。

实际调用方记录：

| 默认 UI 请求 | 主任务 | 真实子任务 | 原工具结果 |
| --- | --- | --- | --- |
| 北京公开天气查询 | `19bde657-c934-4834-b766-047ffef9e5ef` | `1a219c95-ca45-4711-ab51-adff00154cf4` | `weather.forecast`，`confirmed` / Policy `allow` |
| 精确创建订阅 | `28139fa2-d3c1-4f23-8a9f-50dd9d0548fa` | `8878cf40-ebe2-48f5-8597-c6e269b36f4b` | `connector.watch.start`，原 UI `allow_once`，revision `1` |
| 重启后精确停止 | `acc029c3-0100-4050-ac48-6182b6d96dfe` | `dd46d938-6144-4344-b65e-5c2f4c9b26ce` | `connector.watch.stop`，原 UI `allow_once`，revision `1` |

六个父子任务最终均为 `succeeded`；每次父任务的原 `subagent.dispatch` 为 `confirmed` / Policy `allow`。主目录为 1 项调度能力，实际子目录为 9 项且包含当次能力；未提高 64 项目录边界。子任务持久化的真实云请求身份包括查询请求 `38d36384-6fa8-4c9c-951f-895a74a9b101` 及工具后续接 `da7b1859-38de-42c9-ab2e-faa33c6c287d`，相同 session `pa-353ee07e8039eb6a3089546d879aa5b1`，各 `attempts=1`。完整各轮 `requestId/sessionId/payloadDigest/revision` 投影见回执。配置快照显示 WSS、deployment version `arm64-v5-d92a17a4-r3`；本项没有做平台独立版本或 Trace/API 对账。

本轮唯一订阅为 `watch-bc3ceb13f4ecba60c91b31f0ed1c7593a78867a8cc6940f0ed681904d850c120`。冻结参数为 `source=weather`、`query={"location":"北京","locationQuery":"Beijing","units":"metric"}`、`intervalMs=15000`、`expiresAt=2026-10-21T15:11:30.173Z`，原责任为 `desktop-panel` 和已批准的创建子任务。停止后数据库为 `enabled=false / state=stopped / sequence=2`。

| 天气读取 | 原任务 | 序号 | 原缓存回执 |
| --- | --- | --- | --- |
| 默认子任务首次读取 | `1a219c95-ca45-4711-ab51-adff00154cf4` | 单次查询 | `fetched`，`2026-10-21T15:01:22.957Z` |
| Scheduler 第一次 | `aafe1ac6-435f-4082-931d-0d651ca7f5be` | `0` | `fresh`，age `18585ms` |
| Scheduler 第二次 | `a9fc0c74-ddd6-48f9-9cd8-38722fde1f51` | `1` | `fresh`，age `33817ms` |

三条读取均为 `confirmed` / Policy `allow`，`executionStarted=true`、provider `open-meteo`。公开预测为北京 2026-10-21、metric、最低 `3.9` / 最高 `15.7` °C、降水概率 `0`；只记录本次实际返回值，不代表用户所在地。两次 Scheduler 读取复用原 600000ms TTL 内的新鲜缓存，证明原授权读取与调度成功；它们不构成两次独立上游网络抓取，也未覆盖 TTL 后重新抓取。

两条原 schedule 为 `fired`，对应 admission 任务 `354cbe6d-01e2-4bc5-bf71-aa1ffccc6932`、`bdf71106-d0b7-4df3-be05-72c572ba2f27`。关闭并重启同一隔离 Desktop 后，相同订阅仍启用；第一轮随后立即提交停止，没有等待重启后的新 Scheduler 读取。默认 UI stop 经原审批完成，下条 schedule 为 `cancelled`。停止后观察 `17000ms`，订阅读取记录数仍为 2；最后关闭应用后以只读 SQLite 再核对。

变化观察器已装配，数据库持久化两个分别属于单次主对话和订阅的来源基线；`weather.changed` 事件为 0。本轮未加载 Laya，未制造天气值或选择结果，因此没有验证自然显著天气变化、TTL 后变化检测、Laya 判断或真实提醒投递。审批由 runner 在原授权页面进行精准点击，没有物理人工点击；平台独立 Trace/API 对账仍为 `not_run`。

增强 runner 的 `node --check` 和 `git diff --check` 通过；新的只读 exact admission/原参数/单次授权检查回读第一轮公开天气两条记录均通过（`2/2`）。该静态阶段未启动应用，之后按主控 GO 另行完成下述真实验收，未覆盖第一轮回执。

第一轮验收时生产入口 SHA256：main `656da5f4ecd08682c43b31dc015060f8cb1d4322b2d072c1d1855ea5ec2180bf`；watch host `0b84d991f09208869eea0d5ee2c069b3179f25c709ab28b22762eab336e07551`；public provider host `e14c1c70cce6edfc4934af9f6678348ba5899c594418989ccbad01c8e88dda72`；当时 runner `4861f4433fecee240b7aecd4323e5291c6752e9bfc1f6ff3987e406c0e494777`。

增强轮真实回执为 `.cache/desktop-weather-watch-live-k3MKzk/receipt.json`，原 SQLite 为同目录 `user-data/runtime.sqlite`，另存重启前、重启后新读取完成、停止后三张截图。回执 status 为 `passed_real_default_desktop_public_weather_watch`；创建、读取、停止均沿生产默认 UI/Client/Runtime，未加载 Laya、注入 Fake 或复制邮箱/历史。

| 增强轮默认 UI 请求 | 主任务 | 真实子任务 |
| --- | --- | --- |
| 单次公开查询 | `8648eaaf-0f40-411f-814f-0e00480fb4e6` | `f5f32fba-c6eb-4b22-9bc9-5bec8f34dfcc` |
| 创建订阅 | `8967222c-8d8a-4a6e-8958-fdb72c161c6e` | `16b7b82c-e0a6-4b62-9270-ab5994d8cab8` |
| 重启后新读取完成再停止 | `8e8a05c8-c22d-40ae-9c70-b5d7a37e9c44` | `bb804940-b367-4185-a1aa-97463eaf4f57` |

父子任务全部 `succeeded`，原 `subagent.dispatch` 及各目标工具均 `confirmed` / Policy `allow`，子目录仍为 9 项。查询子任务初始云请求 `b4cb1078-f985-467e-8eca-4068fb22965d` 和结果续接请求 `47585e9d-41e9-46e5-aac1-9bc7d29add5e` 同属 session `pa-73b6d2f1d490ae166a7bcb1ef58609ed`，各 `attempts=1`；其余主/子请求身份见原回执。当前配置读回仍为 WSS / `arm64-v5-d92a17a4-r3`，不是平台独立部署版本对账。

增强轮原 watch 为 `watch-510a310c712d418e681841977e529a59a674c552ca1365089902f2c26b6355c1`，精确北京查询和 15000ms 间隔不变，截止 `2026-10-21T15:29:31.142Z`。创建和停止分别通过原授权页面的单次批准（revision `1`），原审批 ID 为相应子任务的 `competition-tool-<taskId>-1`。最终 `enabled=false / state=stopped / sequence=3`。

| 增强轮原 Scheduler 读取 | 原 host task | 缓存回执 |
| --- | --- | --- |
| 重启前 sequence `0` | `fd6abaf4-9dad-4bb8-ba9d-7c711e222270` | `fresh`，原 fetchedAt `15:19:25.766Z`，age `10074ms` |
| 重启前 sequence `1` | `9ee06044-7c6c-44b0-a555-e12b82f33cb5` | `fresh`，同 fetchedAt，age `25328ms` |
| 重启后新 sequence `2` | `a76624ad-76b3-411f-8924-865ea81a10f9` | `fetched`，新的 fetchedAt `15:20:10.798Z` |

关闭后的只读基线保存了前两条 taskId 和 max sequence `1`；重启标记为 `15:19:51.905Z`。新序号 `2` 的原读取开始于 `15:20:06.320Z`，taskId 不在重启前集合中。其精确原 schedule 为 `connector-watch-77454d9173f4d59539875aa4e447b6ff4d4d89781cd1dac1cc0060d2d408adb6`，状态 `fired`；绑定 admission 任务 `a0192423-9bb6-4ab2-8875-0e01d92aa509` 为 `succeeded`，仍绑定原订阅截止和 schedule 身份。该 admission 只证明唤醒；读取成功另由原 host tool 记录证明。

三条订阅读取均核对同一 watch 原责任、配置、冻结 query 和 readTool；每个任务只有一条工具执行。各原 grant 绑定本 task/`weather.forecast`/`weather:read`/原截止、参数 digest `143a4b594b834763855f9c56be7823a08bd704b3261f8b9061a1114bb369a301`，`usesRemaining=0`。新序号 `2` 的 grant 为 `host-tool-a76624ad-76b3-411f-8924-865ea81a10f9`，到期 `15:21:06.276Z`。该轮已证明重启后自主继续原 Scheduler 和已授权真实读取。

新进程的重启后读取为缓存冷启动后的真实 `fetched`，因此增强轮有两次独立上游取得（最初查询、重启后读取）；重启前两次 Scheduler 仍仅是 TTL 内 `fresh`。该结果没有覆盖同一进程缓存 TTL 自然到期后的重新抓取，也没有制造或观察到显著天气变化。持久化来源基线为 2、`weather.changed` 为 0；`no_significant_change`，真实 Laya 判断/提醒仍 `not_verified`。

新读取确认后才发出默认 UI stop；下条原 schedule 已 `cancelled`，停止后观察 `17000ms` 没有新增订阅读取。最终只读回执中订阅读取为 3 条，加首次查询共 4 条。runner 正常关闭后按本轮唯一命令行标识检查 `ownedElectronCount=0`，原 DB 已关闭并交独立审阅者只读复核，没有关闭其他应用。

增强轮生产入口三项 SHA256 与第一轮相同；本轮 runner SHA256 为 `7121d3ee2738029a8613b03b29127be8b8b14ff0831f38acfb9c4275d0f12a3d`。本轮不产生提交、推送或平台发布。

# Developer Harness 云端接续：实际接线与验证边界

目标 profile：`huawei_ict_agentarts`。初始核对源码 `3897f4fc`、tree `54bc4723174b68a0ce7b66774b95ba3f2e6d873b`；最终产品 bundle `afa0bb9a`，统一执行合并 `afb0ab3d2a13552bc89229915e3b00b34c02ab52`，tree `17c476686f78294c0d2d34669dc6e79995ff2873`。代码及定向验证不等于真实云、Windows 或完整业务验收。保留既有 Windows 交接证据，不覆盖其历史结果。

## 用户入口与真实返回路径

1. `apps/desktop/electron/main.js` 将公开 RegisteredTools、availability 和受限 exports 一并交给原 Runtime Application；`apps/runtime/src/application/tool-catalog.ts` 投影完整公开输入 Schema，隐藏 `modelExposure:'internal'` 的模型目录项，内部注册并不因此删除。注册、已配置、已授权、已执行分别判断。
2. 文字请求由原 `task.submit` 形成 parent 锚点，`delegateUserTasks:true` 强制原持久化 `user-work` child 执行工作；`apps/runtime/src/application/subagent-host.ts` 保留同一 WorkerContext、审批、期限、取消和恢复事实，不创建第二任务库。
3. Live 在 Main 的 `initializeLiveVoice` 中读取同一 `readConversationToolCapabilities()` 目录，通过原 `request_work/read_context/wait_for_task` 交接任务；目录发现不直接授予业务权限，也不在语音层复制业务执行循环。完整 Schema 分页仍受既有大小上限约束。
4. Runtime 继续经 Policy → ToolGateway → 原 RegisteredTool；涉及确认时等待原 task/run、参数 digest、revision 和期限绑定的批准。未知写入只读原 operation，不重发。完成结果由原 TaskRuntime、Evidence 与受限结果出口回到 child、parent 汇总及原 conversation/Live；模型自报成功不是执行成功。

## 可交付接线清单

| 范围 | 已有生产接线 | 条件与未验边界 |
| --- | --- | --- |
| 开发 trial / compare / adoption / publish | `apps/runtime/src/application/developer-harness.ts`、`harness-candidates.ts`、`harness-candidate-bindings.ts` 消费原受信配置与候选；Desktop `harness-configuration.js`、开发设置及 Main 装配进入同一 Runtime | trial/compare 不自动 adoption；发布仍需原验证、用户基线 CAS、逐文件读回及原授权。缺真实候选、固定 recipe、工作区或部署绑定不能报可用；影子 artifact 不等于发布 |
| 开发经验 | Runtime `harness-experience.ts`、`harness-experience-bindings.ts` 与 Desktop `harness-experience-host.js` 接入原经验消费、受限记录和确认 | 原私有内容及精确出口许可保持；经验存在不代表已采纳或真实收益已验 |
| H6 通知与事件接续 | Runtime `harness-events.ts`、`harness-event-delivery.ts` 和 Desktop `harness-events-host.js`；Main 通过进度 flush、原 native maintenance start、退出 close 接生命周期 | 原任务是事实源；取消、过期及 unknown 不重新执行。通知事件不构成新的任务库或全业务调度器，真实设备/云事件仍需验收 |
| GitHub repairLinks | `3897f4fc` 的设置公开仍缺 repair 描述符；最终 bundle 已整合 `c5e4f9bc`（包含 c331）补 `readDeveloperToolDescriptors` 的公开 `registerGitHubRepairLinks` 枚举。实际 Settings → Deployment → DesktopToolsHost → SQLiteRuntime → RuntimeCompetitionToolCatalog.prepare 及 Main 同 surface 两例通过，最终 settings 三文件 10/10 | 上游 version/schema/sideEffect/scopes deepEqual；默认 off 不见，true 的新 task 可见，旧 task/off/revoke 拒绝。合法原 read scope 的 Fake 末端一次调用不代表实际 Policy 批准；写仍须原 Policy 审批。未将 repair 加入 automaticTools，原权限与 unknown 核实不变；本记录不宣称已远端发布 |
| Calendar 三项写操作 | `apps/desktop/electron/connector-conversation-tools.js` 包含 `calendar.create/update/cancel`，Main 经同一工具目录与原 Runtime 审批执行 | 账号配置、逐任务授权、原 metadata/result 出机许可分开；真实 CalDAV 写回未以本记录证明。业务 owner 为 Potatos498，不接管重写 |
| Windows-MCP 独立工具 | `windows-control-host.js`、`computer-control-lease.js` 及 Main 已组合独立七项控制工具（含 `computer.request_access`），沿原目录进入文字/Live | 依赖受信 Python/固定 MCP 配置、界面出机许可、唯一输入锁及真实观察；缺项继续 unavailable。Notepad 强目标工具与 MCP 观察不能互相冒充，真实 Windows/DPI/设备并发未由 Linux检查证明 |
| 28 图公开 catalog | `image-workflow-catalog.js` 的 `workflow.image.catalog` 接 Main 的 tools/availability/exports 和显式只读 allowlist；输入枚举 F01–F28，只读取原注册表与公开设计 | 28 图、185 节点、152 项 adapter requirements（111 host、41 guard）是设计/契约目录。缺 host/guard/入口明确 unavailable，不执行 readiness/advance，不声称全部业务已接通 |
| F15 | 原 `coding-repair-worker-capability.ts` 在同一 user-work 复用 `coding-repair-application.ts` 和 `owned-workflow-driver.ts`，保留 HostBridge、原审批及恢复 | 仍依赖固定 image/deployment、Laya ready/资格、工作区、metadata/精确源码出口和本地完成读回。Synthetic 或历史单图证据不证明当前文字/Live/云整链完成 |

## 所有权与明确未交付

以 `docs/MODULE_ASSIGNMENTS.md`、`docs/competition/IMAGE28_CONVERSATION_WIRING_20261018.md` 为准：zemeng 负责 AgentArts/镜像、Desktop/语音/Windows 与核心执行；goo122 负责公共 Runtime/协议、知识记忆及 MOD-37 API 文档；Potatos498 负责业务连接器及 MOD-34/35/38。共享组合不意味着接管他人业务模块。

F20 API 文档一致性业务归 goo122 / MOD-37，当前仍是待开工规划。现有通用驱动和显式 Synthetic F20 验证只证明推进契约，未交付可信 schemaFile/codeFile、固定 recipe/inputRef 提供者、生产模型入口和结果消费。不能用无 host/guard 要求推断业务完整，也不能用 PR #277 的 MOD-33/34/36/38 完成记录替代 MOD-37。

F13/F14 已有独立系统观察/Windows-MCP 用户工具，不等于 graph aliases/guards 已齐；其他图依逐 owner 提供真实 host、guard、可信输入和完成证据。此记录不新增假 host、固定 selected、模型许可或平台能力。

## 验证事实与未验边界

- 首轮 root check 源码 `93061fbc`、tree `7ee4704f93891caf9c9cbfc6f4b9e1adb2d3ae09`：build/typecheck 通过，但整体 exit 1。两处真实 fixture case，父子计数共三项失败；Runtime 1007 pass / 7 skip，Desktop 1508 pass / 1 fail / 22 skip；root integration 未到达，不能记为通过。
- 首轮原始日志保留在统一验证树 `.cache/cloud-takeover-validation/check-93061fbc.log`，SHA256：`59c6d375842c3deb37e587f0d153acdd713a521447f922a707fc507237e1a5b7`（由统一验证执行方提供）。
- 前一轮源码 `ce625da2e83553f3dc88ed899de22425ed3b20a7` 与 `3897f4fc` 同 tree `54bc4723`。执行方提供的最终定向均 exit 0：coding 23 项（20 pass / 3 skip）；Desktop 45 项（44 pass / 1 Windows-helper skip）；event-readback 3/3；Runtime 8/8；root integration 51 项（48 pass / 3 Windows skip）。后续最终组合及 UI 结果见下节；不将定向通过写成整体 root check 通过。本文件自身没有运行 build/test。
- 原 root check 共 34 workspace、4890 tests：4803 pass / 3 fail / 84 skip / 0 cancel；失败保留为 coding 父子两项及 Desktop 一项。integration 的三项 skip 位于 `tests/integration/wiki-write-recovery.test.mjs:82/98/118`，要求 Windows 和 PATH 中真实 pwsh.exe；本 Linux 未验真实写回/读回投影失败恢复、配置 revision 独立 finalization、unknown 中断写 trusted finalization。
- 最终定向复用原 `93061fbc` root check 实际 build/typecheck 产物，没有重新 build 最终 head。361 项 TS/package/lock/tsconfig gitblob 相同，清单摘要 `2a7bee6fe6d03fc64437ce7e26e9e38182b156b582f378d225ac4eaac4c55d39`，见 `build-source-identity-54bc4723.json`。Runtime artifact identity 是加载 dist 的路径/bytes 长度前缀 hash，不含 sourceCommit，不能宣称已更新构建提交身份；最终产品包 CI 仍须 fresh build 最终 head。

最终日志位于同一 `.cache/cloud-takeover-validation/`，执行方提供 SHA256：

| 日志 | SHA256 |
| --- | --- |
| `final-coding-54bc4723.log` | `4f8a5c0a6055e911ce0e2c58c93c522ee69742f02901dae07da18e5f6cd799e3` |
| `final-desktop-54bc4723.log` | `f880e8d403cb5edddd8f716c275fa41c807372166de91fc2ad7e59bd2f3a5531` |
| `final-panel-event-54bc4723.log` | `f12f63abf1f64117867d2a63a8e15f49176e4b739f90aa2946b8711903ea3d03` |
| `final-runtime-54bc4723.log` | `40d17422ed3674aa95701dad94ccd911c0f830f9eb7e9444335f2fa2b2f2fffc` |
| `final-integration-54bc4723.log` | `d112bb5ae618c43d27314eeac7d73d012bac7d9f96132c1a8d168ea92c3980d0` |

## 独立补丁与最终组合验证

- repair 描述符单 factory 实测 2/2、0 skip；日志 SHA256 `867f636949dc06f9018580166aab3417f5a24689e9f5126ec0660156a2753a23`。
- 干净基线 UI：`/tmp/personal-agent-final-ui-20261020/160329-410991/report.json` PASS。实际截图发现 Harness 保存按钮深底深字；独立补丁 `d9b9b5e` 仅为两个按钮复用 `.btn`，未改保存逻辑。
- 独立修后 UI：`/tmp/personal-agent-final-ui-20261020/160415-106463/report.json` PASS；执行方实际查看 normal/compact/Panel/经验截图。最终报告无 pageerrors、无外网；前期 preload scope、sessions/pin 错误属于忽略目录中的 fixture，不是最终报告结果。
- 最终产品 tree `17c47668` 的 settings 三文件 10/10、0 skip，integration 51 项：48 pass / 0 fail / 3 Windows skip，均 exit 0。日志 `final-settings-17c47668.log` SHA256 `bbc4facde6c80844a71f6e6f040d7a90293afc769c3c13800e672620058162be`；`final-integration-17c47668.log` SHA256 `5f4f46810196658c90a6a748ff6b939d5cc1dd6c75cd8dd99910122808c11486`。无 TS/package/lock/tsconfig 改动，仍复用前述实际构建，不宣称重新运行整个 root check。
- 最终合成页面 `/tmp/personal-agent-final-ui-20261020/160831-529017/report.json` PASS / exit 0，SHA256 `65699b4af2580b64f0a54b9d96f461379a4ce901b1ad12f9d33ecdea3b4cc94d`。六组检查，全部 src JS/CSS/index/preload 哈希首尾一致，页面错误与外部请求均为空。执行方实际查看最终 Harness 及两尺寸 Panel 截图；保存按钮前景灰度 23 / 背景 238，可读。此前 UI pending 已由本轮最终报告取代。
- 真实 Electron Main/safeStorage **NOTRUN**，页面重开不代表原生生命周期通过。不将独立补丁或 UI 报告写成已 push、整体 root check 成功或真实账号验收。
- 当时源 PR #450 的另一 Windows 依赖准备 `ready:false` 根因仍待新 CI 诊断；后续定位与夹具修复见下节。最终源 PR 当前 head CI / 非作者批准未满足时仍不能合并。产品代码交付、PR 合并及真实能力验收分别记录。
- Windows 原生 helper、音频/输入设备、真实账号、云模型、Laya、真实整图和实际发布的证据与本地代码检查分账；缺平台时如实记未验，不降低权限、期限、CAS 或 unknown 保护。

## 后续 Windows CI 夹具定位

- 源 PR #450 在 `cd370` 对应 Windows 失败日志中的唯一原因已定位为 `Workspace dependency link does not match the original locked workspace`；前一轮 Desktop canonical 修复不再失败。以上“待诊断”为当时状态，不代表最新定位仍未知。
- source450 新 head `2d30464b91edbd4979620b55f8ba2aa238cd44a6` 仅修改 `packages/coding-tools/test/isolated-dependencies.test.mjs`：以 `realpath` 后的规范 workspace target 创建 junction，并在准备依赖前通过 `lstat` 与 `realpath` 断言原链接身份和锁定 workspace 精确一致；没有修改生产校验或放宽安全门禁。
- 执行方提供该夹具 Linux 定向结果 7/7、0 skip，日志 SHA256 `db015379f4c9a65e1eb0918910df29406573f4da329c9708dd095f6ebd3e39ba`。Windows TEMP 的 8.3 别名路径解释及此修复的 Windows 效果仍待新 head CI 验证，不能由 Linux 结果宣称已经通过。
- 本轮整合仅合入上述测试夹具与此证据更新，未重跑构建、安装或整组测试，既有生产 tree `17c47668` 的产品内容保持不变；当前 head 的 CI 与非作者批准仍是实际合并门禁。

## 后续 Windows CI 内存证书后端准备

- source444 的 `65` 对应 GitHub 托管 Windows 运行出现唯一真实失败：首个 `ephemeralCertificate` 调用约 10.5 秒，超过原有 10 秒限制。该证据不是生产冷启动性能通过的证明。
- 合入 source444 `50569978f3cadc1e5061fdb367f4a18f054c3b78`：仅 CI workflow 四行、新增 `scripts/ci/warm-knowledge-certificate.mjs` 及其测试。原 check 前单独执行最多 30 秒的 Windows 内存证书后端准备；后续原被测函数仍独立调用，原 10 秒限制不变。先前扩大 diagnostic wrapper 超时的方案已经撤回、从未发布，本次生产源码及 diagnostic wrappers 均无改动。
- 准备脚本使用 Windows 系统目录固定 PowerShell，在内存生成、导出并释放临时自签名证书，不访问账户、网络或证书 store，不输出密钥材料、子进程 stdout/stderr 或命令行。日志仅记录阶段、状态、耗时及经过筛选的失败代码；准备失败会阻断后续原检查，不自动重试。
- 执行方提供纯 JS 兼容检查 6/6 通过。本次仅正常合并及文档记录，没有重新运行测试、构建或安装。初始整合时实际 Windows 准备效果和生产冷启动性能尚未验；后续跟进确认 source444 精确 head `50569978f3cadc1e5061fdb367f4a18f054c3b78` 的完整 Windows check、Linux image、aggregate 与 approval 均成功。该结果仅归属 `50569978`，不能转记为其后 main 同步 head 或当前451已经通过；当前451仍须新 head CI。准备后完整检查通过不等于生产冷启动性能验收，后者仍未验。

## Calendar458 联合验证与审查包后续

- source458 `b6ab5e1ba1d85448b795acbbebbc74e616b1b38f` 正常合入后，验证源码 HEAD `580b0a626e320f09a7a7248cccf138cd16dd0927`、tree `afd3e103063a0792dfa157742024b172997bb952`。独立工作树使用 Node 24.15.0/npm 11.12.1、仓库外 TEMP、私有 node_modules 与 dist；Calendar 原 tsc 构建通过，另 31 个无源码变化包的产物复制后逐文件哈希一致，没有通过链接写入旧验证树。
- Calendar 完整相关套件 124 项：121 pass / 0 fail / 3 真实服务 skip；Desktop 真实 Runtime/Gateway/SQLite 及本机 HTTP 消费小组 60/60、0 skip；原 integration 51 项：48 pass / 0 fail / 3 Windows skip。各命令 exit 0。合计六项真实平台跳过仍未验，未访问真实账号或运行全仓检查。
- 日志位于独立验证缓存 `.cache/calendar458-validation/`：`calendar-build.log` SHA256 `5ecbce429d89e7fed549aded67a6dbdda69c10e7ceee1e7b02c3b8cc82d58dd7`；`calendar-tests.log` `20a38d2fbe1db72636e7986585738caefc8c65341339f6d982f698f328818be8`；`desktop-consumer-tests.log` `8cde97d8c558047ce01133abd1f595e9db4be9625f3fc8742987e7376821b897`；`integration-tests.log` `22ea3916aa86e58264d9d2ad279c5056703fc65b84c97459eae0d72810af7102`。
- 用户可见“开发宿主”改为“代码开发工具”：主对话和语音可在选定工作区读代码、隔离试改、运行允许的命令，并按权限提交改动。此文案不增加权限；保存配置仍不授予执行、推送或出机权限。
- 后续正常合入 main `1a77ecfb96c5047a59981f7153cdb48ad736e9c5` 与 source442 `a93734c195ceaff56d3e7a5654e320f3007b35f3`，保留全部历史。main 的 #441 增加 Desktop 与 Runtime 对本机回环 HTTP 日历的既有兼容接线；非回环 HTTP 仍拒绝。为该实际源码变化单独重建 Runtime，calendar-read、Desktop calendar-config/read-approval 与 connector-conversation-tools 小组 52/52、0 skip、exit 0；未重复无关套件。日志 `.cache/review-bundle-validation/runtime-build.log` SHA256 `9f53b1dee684fed3851c7928656b1ac906ebf6cbe200d1b3932256cb809321e8`，`main441-tests.log` `58790c2bdb586402b96d38520ae049a5cc9289ddbe8b71c2421da9da6b32df39`。
- 同批正常合入 source450 `09d64aa015cd52bcfde9898f1975c21b2b01bcd1` 的原 Desktop failure reporter 双输出配置；原测试 glob、并发、断言和期限不变。旧 `2d30464b` 运行仍为失败，新 `09d64aa0` 的诊断 CI 待核；执行方提供的 6/6 与 2/2 仅证明诊断能力，不代表业务失败已经修好。未合入被要求修订的 #439 新内容 UID 补丁，也未合入 obsolete ARM smoke proxy 夹具修改。

## 既有 ARM 镜像证据边界

- 用户要求仅使用仓库已有 ARM 镜像，不新造镜像，不以 AMD 代替目标。历史 AMD 日志保留，但不计目标验收；该路线已经停止。
- 只读证据 `.cache/harness-cleanup-20261020/arm-image-existing/latest-existing-arm-evidence.json` 记录最新 owned-1.7 / `arm64-context-1-7-1020` 引用 digest `sha256:e99a48652f0dc58c6235775ef2577ead81362857e8b722c9eb18a0b4f9b1c004`。该 digest 与既有 SWR repository 拼接的引用未由本轮 manifest/config 核实，匿名读取为 401，精确 OCI source revision 不明，不能说它包含当前451。
- 历史 GHCR ARM 制品可以匿名下载和 inspect，但不是最新1.7的等价证明。本机既有 ARM 制品及官方 Node ARM 的运行前置遇到 `exec format error`，下载成功不等于运行通过。实际 ARM 执行与最新1.7目标验收仍未完成；不以新 build、新 tag、AMD 或新代理夹具替代既有制品要求。

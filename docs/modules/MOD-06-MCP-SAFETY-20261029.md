# MOD-06 MCP 只读基线与管理窗口隐私（2026-10-29）

目标 Profile：`huawei_ict_agentarts`；基线 `f0ba7d347075480a5850626ed1cebd1c22d08624`；状态 `in_progress`，接口 `provisional`。

## 本次增量

`apps/desktop/electron/remote-mcp-management.js` 的原任务读回只向管理窗口返回 taskId、任务状态、工具身份、审批状态和已确认 Evidence 引用，不返回原始业务参数或原始 MCP 结果。原对话授权卡、Runtime 任务/回执和工具结果持久化不变；本变更不新增授权、数据库或公共 wire 接口。

`apps/desktop/test/remote-mcp-management.test.mjs` 通过真实 IPC handler 传入合成参数与结果，验证敏感原文不进入读回，同时保留任务状态和 Evidence 引用；旧实现先出现断言失败，修改后通过。

后续增量允许受信服务定义显式启用 `allowMissingOutputSchema`，并固定目录摘要与本地 Schema；默认仍拒绝缺失声明，远端声明不符依然拒绝，工具只返回通过本地 Schema 的 `structuredContent`。选择策略与授权绑定相连；Desktop 保存该策略须原审批并重启，既有单服务密文仍可读取。当前没有把任意 text 转成结构化结果，因此还不能宣称 Context7 实际查询兼容。

## 范围和差距

2026-10-30 增量：Desktop 生产组合将受信远程 MCP 接入 Competition 工具发现及受控结果出口。Host 根据原 `competition-tool` 的 Runtime 持久调用记录核对工具、参数、任务和 run；不匹配时拒绝发送。出口默认关闭，仅显式配置 PUBLIC、固定参数及本地输出 Schema 的工具可进入受控出口；原任务的出口许可绑定结果摘要与目标，撤销、目录变更和结果未知均不输出成功结果。本地集成覆盖真实 Runtime、Policy、ToolGateway、原对话审批及合成 AgentArts；这不是实际云端验收。

主进程和管理窗口已装配多服务加密配置注册表与内存 Manager：旧单服务密文以 `legacy` 入口原位保留，新服务使用独立加密配置；重启默认断开，新增或迁移配置须重启才能装配工具。显式旧配置迁移复制并验证原密文而不删除原文件；迁移失败或中断时，未完成副本不会在重启后自动载入。同名本地工具身份冲突明确拒绝；两项合成服务已验证独立连接、原任务调用与撤销。管理窗口只展示脱敏状态及 Evidence 引用，不展示原始参数、凭据或未经授权的结果。

已开始执行但 Runtime 标记 failed 的原记录，远程 Host 读回为 `RESULT_UNKNOWN`；未开始执行的失败保持 `EXTERNAL_FAILURE`。这只约束 Host 后续处理，不改写原 Runtime 记录，也不证明第三方是否收到请求。`mod06-receipt-test-migration-crash-1` 本地定向测试 36 通过、0 失败、0 跳过，日志与进程记录位于 `.cache/`；MCP 工作区测试 33 通过。未新增第三方或 AgentArts 请求。

实际 Electron 产品回归 `mod06-product-final-after-pending` 退出码 0；通过管理窗口隐私断言、原任务审批及本机 HTTPS 证书、主机名、目录变化和重定向负例。测试 CA 仅限合成 loopback 服务，系统信任未修改，TLS 验证未关闭；不是云端或第三方验收。

完整 `npm run check` 两次退出码均为 1。第一次测试 PATH 缺少 Git 且临时目录位于仓库内，导致相关测试失败；第二次补齐 Git、PowerShell 7、.NET 8 并将临时目录移到仓库外，Desktop 2259 通过、12 跳过，Runtime 1323 通过，但 MCP 的 `manager.test.mjs` 子进程以 3221226505 异常退出。随后该测试独立运行 3/3 通过，使用相同工具链的 MCP 工作区独立运行 33/33 通过；异常根因未确定，不能把整仓检查记为通过。日志与 PID/退出码在 `.cache/mod06-check-*.{log,meta.json}`。

后续完整检查 `production-composition-final` 退出码 1：Desktop 2260 通过、8 失败、12 跳过；失败为两组现有 VM 测试夹具未注入新增 MCP 组合及多服务释放接口，Runtime 1323 通过。已补充夹具依赖，保留原断言，相关回归 `main-fixture-regression-1` 为 38 通过、0 失败、0 跳过。修复后完整 `npm run check`（`production-fixtures-final`）退出码 0：37 份测试汇总合计 6249 通过、0 失败、44 跳过，其中 Desktop 2268 通过、12 跳过，Runtime 1323 通过。跳过项及日志以该次记录为准；这些不是第三方或云端验收。

| 能力 | 当前依据 | 剩余工作 |
| --- | --- | --- |
| 本地固定 filesystem / 单远程只读 Host | packages/mcp 已实现，经过 Runtime/Policy/ToolGateway；现有调用保持兼容 | 真实第三方远端完整执行单独验收 |
| 远程 Desktop 管理 | 多服务 safeStorage、显式保留原配置的迁移、独立生命周期、原任务审批和 Runtime 读回；已用合成服务验证 | 当前版本真实服务与设备环境验收 |
| AgentArts 消费 | 生产组合已接入工具发现与受控 PUBLIC 出口；本地合成调用验证原任务及出口许可 | 隔离部署身份核实后进行真实 AgentArts 闭环验收 |
| 协议与发现 | 固定身份、Schema 和目录摘要；已有 capability.search | 受信多工具、分页与稳定服务身份；不信任服务器权限声明 |
| 平台原生 MCP | 尚无当前真实闭环证据 | 单独核对平台支持与 trace，不暴露本机服务到公网 |

## 本次验证与限制

2026-10-30 最终生产组合定向测试 `mod06-receipt-test-production-composition-1`：56 通过、0 失败、0 跳过，覆盖生产组合、原对话卡、目录漂移、出口撤销和未知结果。Electron 产品烟测 `mod06-product-composition-final` 退出码 0：两个合成服务各执行一次调用，原任务审批生效；证书、主机名、目录和重定向负例被拒绝，测试 CA 仅用于指定 loopback 地址，系统信任未更改，TLS 校验未关闭。本轮未新增真实第三方 MCP 或 AgentArts 调用。

以下是先前阶段的验证记录，保留其当时的适用范围与限制：

- `npm run build`：通过；Node 24.15.0，使用隔离工作树及锁文件依赖。
- `npm run typecheck --workspace=@personal-agent/mcp`：通过。
- `npm run test --workspace=@personal-agent/mcp`：27 通过、0 失败；包含官方 filesystem stdio 测试及本机合成 HTTP 服务。
- Desktop 配置、管理和 Runtime 定向测试：15 通过、0 失败，使用合成数据与本机服务。
- Runtime 工具发现、Competition 目录及 Desktop 公共参考绑定定向测试：50 通过、0 失败；只验证合成任务与公开出口逻辑，不代表远程 MCP 已接入云目录。
- `npm run test:mcp-tls-smoke`：5 个 case 通过；使用本机 HTTPS、进程专属测试 CA 和合成服务，非真实第三方验收。
- `npm run test:remote-mcp-product-smoke --workspace=@personal-agent/desktop`：未通过。首次实际 Electron 44.2.0 的进程身份读取将可执行文件路径中的中文错误解码，触发 `owned executable identity mismatch`；改用同版本英文路径后通过进程身份核验，Runtime ready，但连接状态等待 15 秒超时（测试第 99 行）。一次诊断重跑显示管理窗口 `EXTERNAL_FAILURE`、保持断开，底层原因尚未确认。失败记录保留在 `.cache/remote-mcp-product/`，身份校验和原断言未被放宽。
- 随后定位连接失败在握手阶段，HTTP 请求 0、`DEPTH_ZERO_SELF_SIGNED_CERT`；Electron 能读取测试 CA 文件但额外 CA 集为空，同路径 Node 的额外 CA 集有证书。隔离烟测入口显式将合成 CA 加入该进程的默认 CA 集，未改系统信任或关闭 TLS；最终产品烟测通过，包含新增窗口不显示原始参数及结果断言、1 次合成服务调用以及证书/主机名/目录/重定向四类拒绝。对话框是合成响应，不是第三方服务验收；回执 `.cache/remote-mcp-product/case-GFsCya/receipt.json`。
- 进一步收紧测试 CA 后重新运行产品烟测：合成 CA 只通过测试 dispatcher 用于指定 loopback URL，其他请求不使用该 CA；原 fetch 执行请求，目标未重写。正向、隐私断言和四类负例均通过，其他请求 0、系统信任未改且 TLS 校验未关闭；回执 `.cache/remote-mcp-product/case-a30sMx/receipt.json`。该回执的 `remoteTransport` 旧文本写为 default fetch，应按此处的目标限定 dispatcher 理解。
- 公开 Context7 `https://mcp.context7.com/mcp`：真实 HTTPS 初始化和 tools/list 成功，协议 `2025-11-25`，服务自报 Context7 4.4.3；目录的两个工具均未声明 outputSchema。现有 Host 要求远端输出 Schema 匹配，因此没有将它作为已批准工具或调用 tools/call。该结果只证明当次握手和目录，不证明真实执行、Desktop 端到端或云端验收。
- 公开 Cloudflare 文档 MCP `https://docs.mcp.cloudflare.com/mcp`：真实握手和目录满足固定身份及输入/输出 Schema；使用独立 SQLite Runtime、默认网络 fetch 和公开查询，连接及 waiting_approval 时未发送 tools/call。使用显式合成的本地 Runtime 审批后，原任务 `31979dd0-913f-486a-b955-308f49cda9ce` 失败，执行记录 `executionStarted=true`、`policyDecision=allow`、`state=failed`，错误 `EXTERNAL_FAILURE`。执行是否到达第三方服务尚无服务端读回或可靠本地次数回执，未重试；该测试不是真人审批卡、实际 Electron 或 AgentArts 验收。隔离数据库及临时探针在 `.cache/cloudflare-live-c4l2c6/` 和 `.cache/cloudflare-live-mcp.mjs`，原查询只含公开测试文字。
- 已获准使用隔离 AgentArts 部署和公开合成数据；当前环境中的运行时身份尚未证明属于隔离部署，因此没有发起云调用，也未向云端发送数据。

真实服务的目录读回已执行；实际工具结果与第三方服务端次数 `unconfirmed`。AgentArts 端到端和平台原生 MCP 保持 `not_run`。未自动使用本地凭据或扩大其授权范围。

## 2026-10-30 安全复核与真实验收准备

- 出口阶段复现目录在工具执行后、授权阶段发生变化仍可发送的问题，现于投影许可前后复核固定目录；回归 `audit-directory-drift-before-export` 为 18 通过、1 失败，修复后 `audit-competition-fixed` 为 19 通过、0 失败。`audit-final-mcp-integrations` 为 57 通过、0 失败。目录读回与最终发送之间不具备跨系统原子性，不能证明服务不会在最后一次检查后变更。
- 原 task/run 的持久回执与重连防重放已覆盖；Host 按 taskId/runId 关联运行，不能声称跨新任务或任意新 run 的相同参数已全局去重。未知结果必须保留原身份并人工核实，禁止通过创建新身份重发原调用。
- 候选 Context7 的 `resolve-library-id` 仅作受控只读候选；原始握手和目录为历史证据，固定版本及目录须验收前重核。官方实现描述返回 text 内容，现有 Host 只接受经本地 Schema 校验的 structuredContent，不能仅启用缺失 outputSchema 选项就视为具备真实兼容性；不得实际调用以制造通过。
- 当前进程存在 AgentArts 网关、Runtime 名和授权配置；只读解析显示 HTTPS、区域 cn-southwest-2、模式 published，但未得到可信部署版本与隔离归属证明。配置存在不等于授权或验收；未调用真实 AgentArts、未发送工具正文。真实平台原生 MCP 另列验收。
- Cloudflare 原 taskId `31979dd0-913f-486a-b955-308f49cda9ce` 保持远端结果未知，不重试。此前 Windows 退出码 3221226505（0xC0000409）原因未定位，完整检查最终通过不能证明其根因已解决；本轮一次定向组合运行中的多服务测试进程异常退出，单独复跑 2/2、组合重跑 57/57，原因未定位。
- 本轮新增真实第三方 MCP `tools/call`、AgentArts 请求均为 0；接口继续 provisional。变更前 34 文件备份及校验清单位于本机忽略目录，ACL 限制当前用户与 SYSTEM。

### 2026-10-30 交付验收矩阵

| 验收对象 | 证据 | 当前结论 |
| --- | --- | --- |
| MCP 工作区 | `mod06-npm-final-readiness-mcp`：33 通过，0 失败，0 跳过 | 本地测试通过，非第三方验收 |
| 生产出口与多服务 | `mod06-receipt-test-final-readiness-integrations`：57 通过，0 失败，0 跳过 | 本地 Runtime、原授权与合成服务验证；未知结果不能跨不同 task/run 全局去重 |
| Electron 产品窗口 | `mod06-product-final-readiness-electron`：退出码 0，两个 loopback 服务各一次工具调用，四类 TLS/目录负例拒绝 | 本地产品与合成对话框验证，不是真人或外部服务验收 |
| 完整仓库检查 | `mod06-check-readiness-final-source`：退出码 0；37 份汇总合计 6250 通过、0 失败、44 跳过 | 当前最终源码检查通过；跳过项名称和原因与下列历史记录一致 |
| 原始目标和许可 | 最终发送前同步核对配置绑定、任务、回执、投影、目标摘要和当前许可；目标摘要覆盖 gateway、runtime、已提供的 deploymentVersion 和模型选择 | deploymentVersion 未提供时不证明固定云部署版本；远程目录核对与发送不是原子事务 |
| 第三方只读工具 | Context7 官方工具返回 text，当前 Host 仍要求 structuredContent；Cloudflare 原请求为 unknown，不重试 | 未执行；须先确认工具输出、目录、授权额度及服务端回执能力 |
| AgentArts 工具提案链 | 当前配置只读显示 HTTPS、cn-southwest-2；隔离身份和确切部署版本缺乏可信对应证据 | 未执行真实云调用；实际工具选择、真人审批、出口许可及 trace 均待独立验收 |
| 平台原生 MCP | 无当前版本实际平台 MCP 证据 | 单独未执行，不能由工具提案链代替 |

本轮检查未使用运行环境中的凭据发起真实第三方 `tools/call` 或 AgentArts 请求。敏感内容签名检查仅覆盖已知模式，不等于能证明不存在所有密钥。完整检查日志与退出记录保存在 `.cache/mod06-check-readiness-final-source.*`。

### 完整检查的 44 项跳过记录

以下逐项保留最终 `production-fixtures-final` 日志中的名称和原因；测试只写 SKIP 而未说明原因的项按“原因未注明”记录，不推断通过：

- requested native sandbox fails closed on unsupported platforms — 原因未注明（测试标记 SKIP）
- real Windows PSEC boundary, generation guards and lifecycle — Explicit trusted PA_TEST_JOB_HOST_EXE unavailable
- WindowsJobProcessHost terminates grandchild process tree on abort — WindowsJobProcessHost.exe not compiled, skipping tree kill test
- WindowsJobProcessHost terminates grandchild process tree on abort after delayed readiness — WindowsJobProcessHost.exe not compiled, skipping tree kill test
- WindowsJobProcessHost runs fixed command successfully and returns complete output — WindowsJobProcessHost.exe not compiled, skipping success test
- WindowsJobProcessHost terminates grandchild process tree on deadline timeout — WindowsJobProcessHost.exe not compiled, skipping timeout test
- WindowsJobProcessHost closes its job when the root exits, before draining inherited output — WindowsJobProcessHost.exe not compiled
- exclusive helper can bind identity through the native process query helper — WindowsJobProcessHost.exe is unavailable
- native process identity helper reports the current PID token without PowerShell — WindowsJobProcessHost.exe is unavailable
- native process identity token matches the existing PowerShell token — WindowsJobProcessHost.exe is unavailable
- native query reports an exited process while another handle keeps its object alive — WindowsJobProcessHost.exe is unavailable
- selected-note locked write can use the trusted native process identity helper — 原因未注明（测试标记 SKIP）
- a selected note replaced with a symlink cannot redirect a write — Windows file symlink privilege unavailable
- a user edit between reconciliation reads returns unknown and retains both durable markers — WindowsJobProcessHost.exe is required to reach reconciliation readback
- live CalDAV read-back: ctag/etag poll, wide window, single-event roundtrip — set PA_CALDAV_LIVE=1 and PA_CALDAV_URL=<calendar collection url> (plus PA_CALDAV_USER/PA_CALDAV_PASSWORD when the server requires auth) to run against a real CalDAV server
- live CalDAV wrong credentials are refused as UNAUTHORIZED without retry — requires PA_CALDAV_LIVE=1, PA_CALDAV_URL and PA_CALDAV_USER (a server that enforces authentication)
- live iCal 订阅读回（真实公开源，免 key） — set PA_CALENDAR_LIVE=1 to run the real iCal read-back
- live read-back: two polls per source, proving both incremental paths — set PA_FEEDS_LIVE=1 to run the real source read-back
- live QQ mail read-back (read-only, no send) — set PA_MAIL_LIVE=1, PA_QQ_MAIL_USER and PA_QQ_MAIL_AUTH_CODE to run the real QQ read-back
- live QQ mail send (opt-in separately, sends a real message) — set PA_MAIL_LIVE=1, PA_MAIL_LIVE_SEND=1, PA_QQ_MAIL_USER, PA_QQ_MAIL_AUTH_CODE and PA_QQ_MAIL_TO to send a real test mail
- live OpenAlex read-back（真实学术源，免 key） — set PA_RESEARCH_LIVE=1 to run the real OpenAlex read-back
- live GeoNames tier resolves simplified names end to end — set PA_WEATHER_LIVE=1 and PA_GEONAMES_USERNAME=<geonames account> to run the tier against the real APIs
- live read-back against Open-Meteo — set PA_WEATHER_LIVE=1 to run the real provider read-back
- live read-back defaults the date to the destination local day — set PA_WEATHER_LIVE=1 to run the real provider read-back
- live read-back labels the reported misresolutions and the hint that repairs them — set PA_WEATHER_LIVE=1 to run the real provider read-back
- actual allowlist context is readable by the image USER under restrictive and ordinary umasks — POSIX permission bits and umask require a POSIX filesystem; Windows context isolation remains covered
- explicit Hugging Face blob link stays inside model trust root; escape is rejected — Windows symlink privilege unavailable; regular allowlist remains tested
- actual SIGTERM cancels accepted partial HTTP upload before any model dispatch — Windows child.kill(SIGTERM) is forceful termination, not POSIX graceful shutdown
- actual SIGTERM aborts in-flight HTTPS model and never publishes its late success — Windows child.kill(SIGTERM) is forceful termination, not POSIX graceful shutdown
- actual SIGTERM closes an upload that never supplies its remaining body after readable cancellation — Windows child.kill(SIGTERM) is forceful termination, not POSIX graceful shutdown
- actual production SIGTERM cleans an unfinished upload after its original deadline response — Windows child.kill(SIGTERM) is forceful termination, not POSIX graceful shutdown
- actual production shutdown closes incomplete headers before any HTTP dispatch — Windows child.kill(SIGTERM) is forceful termination, not POSIX graceful shutdown
- one real original question gates a production PSEC command and never replenishes authority — Explicit trusted Windows PA_TEST_JOB_HOST_EXE unavailable
- token-symlink — Local/Synthetic symlink permission unavailable; link rejection unverified on this host
- navigation and press feedback survive snapshots, rapid switching and reduced motion — 原因未注明（测试标记 SKIP）
- knowledge controls preserve read/delivery/binding distinctions and refresh exact subscriptions — 原因未注明（测试标记 SKIP）
- notification page submits current scope/revision, preserves draft and separates return from read — 原因未注明（测试标记 SKIP）
- actual panel and workspace show safe execution errors and only honest original-receipt actions — 原因未注明（测试标记 SKIP）
- actual panel renders only runtime voice controls; settings own all voice credentials and original IPC actions — 原因未注明（测试标记 SKIP）
- controlled write exception crosses actual Gateway, SQLite Runtime and production workspace UI without replay or private data — 原因未注明（测试标记 SKIP）
- direct-link — Host cannot create this link: EPERM
- workspace overview mounts no task composer while session actions retain existing drafts — 原因未注明（测试标记 SKIP）
- management IPC recovers the original cancelled SQLite task and publishes its fresh state — 原因未注明（测试标记 SKIP）
- actual admin page renders and clicks original patch recovery — 原因未注明（测试标记 SKIP）

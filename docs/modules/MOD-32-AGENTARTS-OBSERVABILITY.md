# MOD-32：AgentArts 请求级观测与恢复边界

## 2026-10-17：观测消费的生产接线（请求身份记录 + 可审查读回）

继续保持 2026-10-15 的离线观测包语义不变；本节把"生产路径发送请求 → 记录实际身份 → 受信读回
平台 trace/log → 绑定任务进入既有 Evidence/查询路径"闭环接线完成，仍然只做观测记录，
不改变任务执行结果、不用部署成功推断业务成功。2026-10-15 的离线观测包（PR #361）已合入
main（merge commit `fef57f61`）；本节交付在分支 `codex/mod32-observation-wiring` 上，
自 main `90fd2138` 起 cherry-pick 接线提交（工作树提交 `27dd5e3b`），
[PR #383](https://github.com/zemeng5208/PersonalAgent/pull/383)。

生产改动（全部走仓库既有装配与导出）：

- `@personal-agent/agentarts/observability/reader` 新增子路径 export：把 2026-10-15 有界 GET
  阅读器从 `tests/manual/agentarts/support/read-platform-trace.mjs` 整体提升为
  `src/observability/reader.mjs`（+ `reader.d.mts` 声明，build 经 `build-observability.mjs`
  复制到 dist）。手动支持文件改为薄 re-export，三个既有 reader 测试文件与两份
  `sdk-trace-authorizer*.test.mjs` 原样通过（唯一 skip 仍是 `PA_MOD32_SIGNER_PATH` 环境门）。
- `@personal-agent/coordination` 的 `AgentArtsCloudAgentPort` 第八个构造参数
  `identityObserver?`：宿主在每次实际发送时收到一次 `(receipt, request)`。触发点：
  HTTPS 主路径在 `beforeSend` 之后、fetch 之前 `createAgentArtsUnknownReceipt(init)` 一次；
  WSS/HTTPS-fallback 在 `guards.beforeSend` 内 receipt===非 undefined、导出守卫通过后，
  `stage='transport'` 前一次。参数校验失败在构造期即失败；观测记录自身失败被宿主吞掉。
- `apps/runtime/src/application/coordination.ts` 新增
  `recordCompetitionCloudRequestIdentity` / `readCompetitionCloudRequestIdentity`：
  checkpoint key `competition-cloud-request-identity`，格式
  `{formatVersion:'1.0.0',requests:[{revision,sessionId,requestId,payloadDigest,recordedAt,attempts}],conflicts:[requestId]}`；
  同 requestId 不同 payloadDigest 记 conflict（拒作对比依据），同一三元组重复发送累加 attempts，
  历史保留最新 32 条。该 key 不在 private-copy erasure 保留名单，擦拭后读回即显式 unknown，
  符合数据最小化既有语义。
- `apps/runtime/src/application/agentarts-observation.ts` 新增
  `createAgentArtsObservationHost`，经 `@personal-agent/agentarts/observability/reader` 读回：
  - trace 面默认用记录的 requestId 作 traceId（InvokeRuntime 官方定义 `X-Request-Id` 为
    本次调用链 ID）；配置了 `observationApplicationId`（应用 resource_id）时传
    `invocation` 做 exact join，未配置时不冒名代替，correlation 保持 `not_checked`。
  - `agent_run_log` 面要求显式 `agentRunId`（来自平台运行记录，不可用 runtimeId/sessionId/
    traceId 猜造）与 13 位毫秒窗 + limit 1..1000，缺失时显式 unknown，不发起请求。
  - 缺 `observationAuthorization` → 显式 `unavailable`（`observation_authorization_unavailable`），
    绝不把 invoke 用 Bearer 降级为观测签名；身份缺失/修订不存在 → `unknown_request`
    （`missing_request_identity` / `missing_revision_identity`），身份冲突时拒读
    （`identity_conflict`）。`deploymentVersion` 恒为官方事实 `unavailable`。
  - 成功读回写 metadata 证据 `trusted-readback-evidence:agentarts-observation-{trace|log}-<32hex>`
    （kind `observation`、verification `conditional`、summary 只含状态/计数），并落快照
    checkpoint `agentarts-observation-readback:<surface>`（querySha256、observedAt、binding
    与 shaRef 化的身份）。读回不改任务状态、不写任务结果。
- `apps/runtime/src/application/evidence-reader.ts`：`ScopedEvidenceReader` 将 trusted-readback
  证据按 evidenceId 去重后追加在执行记录之后；admin evidence.list 页面可读，工具输入输出
  checkpoint 仍不可读，既有分页/断言行为不变。
- 组合入口 `createAgentArtsRuntimeApplication` 返回 `AgentArtsObservationApplication`
  （`readTaskPlatformObservation` 方法），options 新增 `observationAuthorization /
  observationFetchImpl / observationApplicationId`；默认（local profile）
  `createRuntimeApplication` 无观测面。apps/runtime 增加
  `@personal-agent/agentarts` 依赖（apps→packages，架构门禁通过）。

Desktop 装配（`apps/desktop/electron/main.js`）保持默认不传观测授权：观测读回显式
`unavailable`，属如实呈现的缺口而非静默降级。生产读回需要：

1. **AK/SK 观测签名宿主**（官方 SDK + 逐请求凭据授权，见 2026-10-15 适配器）注入
   `observationAuthorization`——本地无 AK/SK 凭据，未取得授权前不能接线；
2. **平台 applicationId（resource_id）配置**，保证 exact join 可核对；
3. **agentRunId 来源**（平台运行记录），log 面才能执行。

验证记录（Fake 层，全部当日实跑）：

- 新增 `apps/runtime/test/agentarts-observation.test.mjs` 13/13：HTTPS 生产链路提交真实任务
  → fetch init 的 `X-Request-Id`/session 与 identity checkpoint 一致 → trace 读回
  `exact_id_match` 并进入证据路径；无 applicationId → `not_checked`；无授权 → `unavailable`
  且零请求；擦除身份 → `missing_request_identity`；记录失败不影响任务成功；修订绑定/缺修订；
  身份冲突拒读；log 面窗口/scope 与脱敏证据；平台 401 → `UNAUTHORIZED` 无证据无重试；
  deadline/取消/越界 deadline；默认组合无观测面；identity 记录去重/attempts/conflicts/32 条上限；
  WSS 双次发送逐帧记录，证据页顺序 execution→observation。
- 回归（ cherry-pick 到 `main@90fd2138` 后重新构建再跑）：`@personal-agent/runtime` 686/686、
  `@personal-agent/coordination` 154/154、`@personal-agent/agentarts` 183/183、架构门禁 3/3、
  手动 reader 与 apply-auth 既有测试通过（1 个既有环境门 skip）。测试分层：如上 Fake 合成宿主；
  真实宿主（WSS SyntheticWebSocket + 组合入口，行为与生产一致的瞬态 socket）覆盖在本套件内；
  真实云端读回未执行。
- `node --check apps/desktop/electron/main.js` 语法通过。

真实平台读回仍未验证（未授权、本机无 AK/SK）；`MOD32_OBSERVABILITY_20261015.json` 的历史
结论继续保留，当日交付记录见
[MOD32_OBSERVABILITY_PRODUCTION_WIRING_20261017.json](../competition/evidence/MOD32_OBSERVABILITY_PRODUCTION_WIRING_20261017.json)。
剩余最小现场验收：受信宿主提供同次 HTTP request/session/application 身份与 AK/SK 签名后，
对本节入口显式只读执行并保存脱敏结果；版本绑定、费用与回滚继续独立验收。

## 2026-10-15：请求身份比较与有界平台日志读取

Owner：zemeng。Profile：`huawei_ict_agentarts`。本离线工作包状态 `review`；MOD-32 仍为 `in_progress`，真实平台观测验收未完成。
隔离工作树登记：`.worktrees/mod32-observability`，分支 `codex/mod32-observability`。
开发基线为 `81dc72b60240d761070c39515ce112032b6b22ca`；交付时仅迁移本包到
`main@3275aa9116769386a93453d9370c0b17f828a834`，未带入 Laya 分支提交。
代码提交 `97777403fcc2a9c27df5f5ed689acd002d82245d` 已普通推送，独立
[PR #361](https://github.com/zemeng5208/PersonalAgent/pull/361) 的 base 为 `main`，共 12 个文件。
已完成自审及只读代理审查，没有 GitHub Approve；未等待 CI、合并或发布。

公开模块 `@personal-agent/agentarts/observability` 提供无 I/O 的 trace/log 投影、实际 HTTP invocation
身份校验和受限日志查询构造。该 package 新增指向 `dist/observability/index.mjs` 的子路径 export，
类型指向 `dist/observability/index.d.mts`。标准 build 在 tsc 成功后调用 `build:observability`，
将现有 ESM 实现及声明复制到 dist；不另加编译器或依赖。模块使用 Node 内置库，
不改根 Schema、锁文件、Runtime 装配或数据库，不增加生产实验 API。
手动 reader 经 package export 消费它；原 `readAgentArtsTrace` 返回结构和
`createAgentArtsTraceAuthorizer` 的仅 trace 签名范围保持兼容。

新增 `readAgentArtsTraceObservation` 与 `readAgentArtsRunLogs`，共用原 reader 的 1 MiB 上限、
绝对 deadline、取消竞速、单次 GET、禁重定向、无重试和脱敏错误。两者返回
`observedAt` 与实际查询 URL 的 `querySha256`，不保存原响应。

当天核对的官方依据：

- [InvokeRuntime](https://support.huaweicloud.com/api-agentarts/InvokeRuntime.html) 将实际发送的 `X-Request-Id` 定义为调用链 ID。
- [ShowOpsTrace](https://support.huaweicloud.com/api-agentarts/ShowOpsTrace.html) 公布 `trace_id/session_id/resource_id`、span 身份和逐 span 指标，没有请求命中 runtime version 字段。
- [ListOpsAgentRunLog](https://support.huaweicloud.com/api-agentarts/ListOpsAgentRunLog.html) 是独立的 agentRun 日志 GET，需要日志权限及 LTS 查询依赖权限。
- [认证分类](https://support.huaweicloud.com/api-agentarts/agentarts_07_0005.html)和[官方 JavaScript 签名 SDK](https://support.huaweicloud.com/devg-apisign/api-sign-sdk-nodejs.html)继续作为观测签名依据。

`invocation` 必须由受信宿主从**实际 HTTP 调用记录**取得 `{requestId, sessionId, resourceId}`；
resourceId 是应用 ID，不能填 runtime 名称、部署 ID 或版本。仅当查询到非空 spans，所有已返回
span 的 session/application 与快照相等，且 trace_id 与该请求的 X-Request-Id 相等，才返回
`exact_id_match`。结果注明 `scope=returned_spans`、`snapshotTrust=caller_supplied`，不认证调用者
提供的快照；仅配置了 header、时间接近、输入相似、同一 session 或 API 200 均不充分。
空结果或缺身份返回 `unknown`，身份冲突返回 `mismatch`，未提供快照则 `not_checked`。
该规则不适用于直接拿 WSS frame.requestId 充当 HTTP X-Request-Id。

trace/span/parent/session/application 仅返回 SHA256 引用。缺指标保持 null；重复 span、异 trace、
非法数字或少于已返回条数的 total 拒绝。`coverage` 根据 total/returnedSpanCount 区分完整与局部；
不合计父子 span 的 token，部署版本与费用一直 `unavailable`。SHA 引用是可关联指纹，不是匿名化保证。

日志范围由 `query={agentRunId,startTime,endTime,limit}` 明确指定，时间为 13 位毫秒时间戳，
limit 为 1～1000；固定 log_type=agent，一次只读一页。agentRunId 必须来自平台运行记录，
不可猜成 runtimeId、sessionId 或 traceId。结果仅含 count/returnedLogCount、queryComplete、
hasContinuation 和逐行 contentSha256/contentBytes/lineRef/labelCount；正文、标签值、原行号及
游标不输出。官方示例 count=10 只列一条，故两种数量保留，不自动补齐或分页；有游标或未完成标记
不等于读到全部日志。日志查询范围本身不证明请求、trace 或部署关联，仍为 `not_checked/unavailable`。

使用受信宿主已授权的 `sdk/readCredentials`，在仓库根的 Node 顶层 await 环境中显式调用：

```js
const {createAgentArtsObservationAuthorizer} = await import('./tests/manual/agentarts/support/sdk-trace-authorizer.mjs');
const {readAgentArtsTraceObservation, readAgentArtsRunLogs} = await import('./tests/manual/agentarts/support/read-platform-trace.mjs');
const authorize = createAgentArtsObservationAuthorizer({sdk, readCredentials});
const trace = await readAgentArtsTraceObservation({traceId, invocation, deadline, signal, authorize});
const logs = await readAgentArtsRunLogs({query: {agentRunId, startTime, endTime, limit:100}, deadline, signal, authorize});
```

新签名工厂显式支持上述两种受限 GET；旧工厂拒绝日志 URL。签名前后校验官方 SDK 的 path/query
及 headers，原 URL 与 SDK 返回路径完全相等。没有自动发现凭据、下载 SDK、启动服务或云写入。

定向验证命令（工作树依赖就绪后，无需全仓构建）：

```powershell
npm run build:observability --workspace=@personal-agent/agentarts
node --test packages/agentarts/test/observability.test.mjs packages/agentarts/test/observability-package.test.mjs tests/manual/agentarts/support/read-platform-trace.test.mjs tests/manual/agentarts/support/read-platform-trace-consumer.test.mjs tests/manual/agentarts/support/read-platform-trace-observation.test.mjs tests/manual/agentarts/support/sdk-trace-authorizer.test.mjs tests/manual/agentarts/support/sdk-trace-authorizer-official.test.mjs
```

最后一个测试仅在显式设置 `PA_MOD32_SIGNER_PATH` 指向受信官方 CommonJS `signer.js` 时执行，
否则明确 skipped。本次使用官方链接下载的 2.0.6、合成 AK/SK/token 与 Fake transport 实际运行，
43/43 通过；无依赖安装。复制构建、源码/产物语法检查、dist 声明类型检查与 diff whitespace 检查通过。
一次新增 fixture 最初误期望 reader 原样透传 signer 的 INVALID_ARGUMENT，实际 reader 按原契约
将回调异常净化为 EXTERNAL_FAILURE；修正 fixture 后通过，未改变这条生产错误边界。
只读同行审查发现公开投影直接消费进程内对象时可能读取继承 getter 或自定义数组 map；
现改为 own-data 副本和新数组，并固定净化异常，增加回归 fixture 后通过。
初版 source export 无法随 dist-only 镜像导出，现已修复为上述 dist 公开入口。
轻量布局测试仅复制 package.json 与 dist 到当前工作树 `.cache` 隔离目录，确认没有 src，
验证实现/声明与当前源码字节相同，并在独立 Node 进程通过包公开子路径导入和执行。
测试消费预先生成的产物，不在测试中修复缺产物；标准模块 build 已接线到同一复制步骤。
该检查证明产物布局和 Node 公开导入；不替代 Docker 构建、镜像发布或平台运行验收。
收尾只读审查未发现阻断问题；没有运行全仓重检查或 Docker。
交付迁移前后 12 个文件的 Git blobs 一致，3 个复用测试文件的基线也相同；checkout 的
CRLF 规范化改变了源码原始字节，因此重新执行 `build:observability` 和产物布局测试，
后者 1/1 通过。整个 AgentArts package build/typecheck 未运行，定向 dist 声明检查不代表
完整包构建。后续合并 Laya 或其他模块增量时须同时保留各自 package exports/scripts。

当前进程无相关凭据环境变量；现有 saved-config host 的所需本地文件在检查范围内也不存在。
未读取真实 AK/SK、未发平台观测请求。历史回执仍缺该次调用的平台原生 trace/version，
现有控制台 stdout 读回不升级为 ShowOpsTrace 或本轮日志实测。
专属记录见 [MOD32_OBSERVABILITY_20261015.json](../competition/evidence/MOD32_OBSERVABILITY_20261015.json)。
后续最小现场验收：受信宿主提供同次 HTTP request/session/application 和原生 trace 或 agentRun 身份，
显式只读执行上述入口并保存脱敏结果；版本绑定、费用和回滚继续独立验收。

<!-- current-design-20261009 -->
> 当前设计与协作入口（2026-10-17）：[当前详细设计](../../docs/design/CURRENT_DESIGN_20261015.md) · [逐图状态](../../docs/design/WORKFLOW_STATUS_20261015.md) · [历史设计导航](../../docs/design/README.md)。当前协作者为 zemeng5208、goo122、Potatos498、2511375597-lab；审查及合并规则以 [CONTRIBUTING](../../CONTRIBUTING.md) 和 [AGENTS](../../AGENTS.md) 为准，模块/文件所有权以 [MODULE_ASSIGNMENTS](../../docs/MODULE_ASSIGNMENTS.md) 为准。常规 PR 须取得一名合资格非作者对当前 head 的有效批准；Owner 仅可对具体 PR 作有记录的审核例外，必需技术 CI 不豁免。有权限者（包括作者）在严格主线更新、无冲突及阻断问题解决后可正常合并。各负责人完成本工作包的实现、必要接线、验证、Evidence 和文档；历史作者、审批与验收按原日期和范围保留，旧两人本机阅读门槛不作为现行要求。

## 2026-10-07：显式只读 Trace helper

[`read-platform-trace.mjs`](../../tests/manual/agentarts/support/read-platform-trace.mjs) 新增手动调用导出 `readAgentArtsTrace({traceId, deadline, signal, authorize, fetchImpl})`。导入时没有网络或文件操作；没有 CLI、凭据读取、自动调用、重试、云发布或资源创建。`fetchImpl` 默认使用 `globalThis.fetch`，也可由受信调用者提供传输实现。

入口仅使用已由[官方观测 API 示例](https://support.huaweicloud.com/api-agentarts/agentarts_07_0037.html)证明的 `https://agentarts.cn-southwest-2.myhuaweicloud.com`，**仅限西南-贵阳一**，不推断其他区域；路径为 [ShowOpsTrace](https://support.huaweicloud.com/api-agentarts/ShowOpsTrace.html) 的 `GET /v1/ops/observation/traces/{trace_id}`。手动入口接受 1～64 位英文、数字、下划线或连字符 TraceID。调用者须对所读 Trace 有明确授权；IAM 用户需 `agentarts::showOpsTrace` 及该官方页面列出的 APM/模型查询依赖权限。

调用者的 `authorize(request)` 接收冻结的完整 GET 描述（`url`、`method`、空 `body`、`headers`、原 `deadline` 和联动 `signal`），并用官方 AK/SK 签名 SDK 返回完整已签请求头。必须保留原 Host、Content-Type、Accept；签名 Authorization、X-Sdk-Date 必填，临时凭据可包含 X-Security-Token。helper 不修改这些已签头值、URL 或消息体，禁止 redirect，且不自动重试。[认证分类](https://support.huaweicloud.com/api-agentarts/agentarts_07_0005.html)明确观测接口使用 AK/SK；**现有运行实例 Bearer 不可替代观测签名**。仓库另提供下述显式注入的 SDK 适配器；使用者仍须提供受信 SDK 与逐请求凭据授权回调，不能把 helper 宣传为已接通账号。

请求头格式检查不验证签名有效性或账号权限；只有真实服务回执能证明该请求通过鉴权。未取得真实回执前，合成签名头只用于离线消费测试。

以下示例在仓库根目录的 Node REPL（支持顶层 await）中使用，所需参数与受信签名回调须由调用者先准备；加载模块不等于发出请求。

```js
// signObservationRequest 由明确获授权的宿主提供；这里不读取或示范存放密钥。
const {readAgentArtsTrace} = await import('./tests/manual/agentarts/support/read-platform-trace.mjs');
const summary = await readAgentArtsTrace({
  traceId, deadline, signal,
  authorize: signObservationRequest,
});
```

原 canonical UTC 绝对截止时间和取消信号覆盖签名、fetch 与至多 1 MiB 的 JSON 响应读取，包括不合作的异步回调。错误只暴露固定 `code`（INVALID_ARGUMENT、UNAUTHORIZED、EXTERNAL_FAILURE、CANCELLED、TIMEOUT）及已知 HTTP 状态，不返回原始错误正文或鉴权值。返回摘要只含 `total`、`returnedSpanCount` 及逐 Span 的 `durationMs`、tokens/inputTokens/outputTokens 和 isError；缺失指标为 `null`，不合计各 Span token 或换算费用。官方示例 `total:5` 但只列一个 Span，因此两者分别保留。input/output/metadata、任意名称、资源/会话 ID 与原始 Trace 内容不进入摘要，也不自动落盘。

摘要的 requestCorrelation、deploymentVersion、cost 始终为 `not_checked`；该手动读取不确立本地请求、运行实例、版本或账单的关联。新增测试仅使用官方结构的合成响应和故障夹具，没有真实账号、云调用或目标系统读回；原有历史验收和未读回结论继续保留。

## 2026-10-07：显式注入官方 SDK 签名适配

[`sdk-trace-authorizer.mjs`](../../tests/manual/agentarts/support/sdk-trace-authorizer.mjs)
导出 `createAgentArtsTraceAuthorizer({sdk, readCredentials})`，返回上述 `authorize` 回调。
`sdk` 必须由受信调用者明确提供[官方 APIG JavaScript SDK](https://support.huaweicloud.com/devg-apisign/api-sign-sdk-nodejs.html)
的 `HttpRequest`/`Signer`；`readCredentials(request)` 对冻结的完整描述逐请求授权，返回
`{accessKey, secretKey, securityToken?}`，未提供凭据时拒绝。模块导入与工厂不读取凭据、
下载 SDK 或发请求，没有环境/文件发现、缓存、重试、Runtime/Desktop 自动接线、依赖或锁文件变更。

```js
// sdk、readCredentials、traceId、deadline、signal 已由获授权宿主准备。
const traceReader = await import('./tests/manual/agentarts/support/read-platform-trace.mjs');
const {createAgentArtsTraceAuthorizer} = await import('./tests/manual/agentarts/support/sdk-trace-authorizer.mjs');
const authorize = createAgentArtsTraceAuthorizer({sdk, readCredentials});
const traceSummary = await traceReader.readAgentArtsTrace({traceId, deadline, signal, authorize});
```

适配仅接受原固定区域/GET/安全 TraceID/空 query 与 body/三个原请求头，取凭据前校验。
每次使用新的 SDK 请求、独立 header 副本与 Signer；临时 token 在签名前加入且须列入
SignedHeaders。签名前后核 method/host/path/query/body/headers，拒绝 SDK 改写范围，
只返回原 helper 接受的已签头。官方 CanonicalURI 的签名尾斜杠不改变实际发送 URL。
原 reader 的 deadline/取消竞速保持；迟到凭据不能启动 SDK 或发送，同步 Sign 无法由
JavaScript 抢断，返回后过期或取消的结果被拒绝。错误仅固定脱敏 code；清空本地 Signer
字段是尽力处理，不保证 JavaScript 字符串或受信 SDK 内部副本已擦除。

冻结 EXACT2 manifest SHA256 0589d6f6da7a5018b3f56fd780b2b9a6161fb3344b00d0f0f73ce7addd377636，
两个新源码 blob15274156/4ad7c15a；原 reader blob4e32b07c 未改。根固定639b070d/treeac8e3358
正常相对导入运行新测试9/9及 syntax/diff，另用 SHA256 3a6ee0a3e064da1be9bfb2583d52d40af665e1e57612029757725b30fc23c484
的原官方 SDK2.0.6 跑普通/临时凭据两例，各1签名/1凭据回调/1FakeHTTP，实际 exit0
（a21d13，23:36:26Z）。日志 core-sdk-authorizer139-integration.log SHA256
11f282ee5a888429f6e8634ab580110f5ca8113cb1674e58a5cdb077b45eecb2。
子树缺原 reader 时的单映射私有 loader 不进入根消费或 Git；初 SDK glue 错误和共享
expectedHeaders 导致的8pass/1fail日志保留，最终两个独立副本在 Sign 前拒绝改写。
独立 GPT-6.1 Sol 审查原 reader 的摘要隐私与适配的请求/凭据/取消边界。
这些都是合成凭据/FakeHTTP 离线接线，未取得真实 IAM/平台 Trace、精确部署关联或费用，
也不是整仓/Windows 验收。

> 维护入口（2026-10-07）：项目主要负责人为 zemeng；当前分工以 [模块分工](../../docs/MODULE_ASSIGNMENTS.md) 为准，最新状态见 [ROADMAP](../../docs/ROADMAP.md)。历史日期、作者和验收结论按原记录保留。

- Profile：`huawei_ict_agentarts` Competition Profile；负责人：`zemeng`。
- 范围：发布、API、观测和手工验收的证据口径。本文不修改云配置、生产适配器、公共协议或本地执行权限。
- 依赖：MOD-04B/29 的云调用适配、MOD-03/05 的任务与工具回执、MOD-30/31 的提案与编排。当前相关接口仍为 `provisional`，不能由这份记录提升为 frozen。

## 已有证据与时间顺序

[`tests/manual/agentarts/README.md`](../../tests/manual/agentarts/README.md) 的 2026-09-12
记录只证明构建。草稿 [PR #108](https://github.com/zemeng5208/PersonalAgent/pull/108)
记录了 2026-09-24 **较早**的控制台读回：应用发布版本 `v20260917160941`、当时
运行时 `Latest=v6`、两条按同会话/输入/时间匹配的成功 trace 及其 token。平台没有
显示调用方 `X-Request-Id`，该匹配并非精确请求 ID 关联。PR #108 仍待依赖、冲突
处理与非作者评审；其旧版本和 token 不可复用为下列新请求的观测值。

本地主链记录 `.cache/full-chain-acceptance-20260924.md` 与隔离集成树被忽略的
`receipt.json` 记载：2026-09-24 22:56 CST 主协调器提交新版本
`v20260924225602`，控制台曾显示“部署成功”；2026-09-25 再读回同一运行时“正常”，
更新时间 22:56:23。版本提交、页面成功和运行时健康是不同的观测表面；仍缺**每条
请求**实际命中该版本的读回。该回执的 `runtimeVersion` 字段为
`to-be-read-back`，不能在展示层填成应用版本或较早的 `v6`。

2026-09-25 18:33:57—18:36:26 CST 的一次合成会议主链通过。两次是独立云
invocation，不是平台原生同 run 续接：

| 本地请求 | 本地 API/解析读回 | 请求级 deployment/version/trace/usage |
| --- | --- | --- |
| 提案 `ddaa2b75…6f27` | HTTP 200、完整 SSE、无 error event；严格 `tool_proposal` | 运行时名称仅是本地目标配置；实际部署版本、平台 trace ID、input/output tokens 和费用均未读回 |
| 候选 `b2b1f07a…2fe6` | HTTP 200、完整 SSE、无 error event；严格 `repair_candidate` | 同上；不能借用前一请求或 PR #108 的 trace/token |

本地 source task 与独立 local repair task 均为 `succeeded`；一次性批准、只读工具
confirmed 记录、原生候选预览、本地 CAS 写图、Evidence 与同库重启已分别读回。
graph revision 为 9；本次结果只覆盖授权的合成会议场景。上述结果证明本地闭环，
不补足平台请求级部署版本、trace、用量、费用、角色交接或回滚证据。原始收据留在
被忽略的本机目录，不把云正文、凭据、私人数据或完整请求 ID 放入公开文档。

## AgentArts 链共用回执索引

04B 统一协调 MOD-29/30/31/32 的一次联合验收。当前可共同引用的是上述 **9 月 25 日
合成会议**回执；新一批非会议目标调用须使用其自己的请求和平台读回，不能拼接这批
会议回执或 PR #108 的较早 trace。各模块在同一批回执上的可证明部分如下：

| 责任模块 | 同批可追溯证据 | 仍缺的同批证据 |
| --- | --- | --- |
| MOD-04B | 两次独立 published API 均 HTTP 200、完整 SSE，严格解析为提案与候选；本地调用方有各自请求 ID | 平台原生请求关联；普通非会议目标对真实公布能力的消费 |
| MOD-29 | 提交应用版本 `v20260924225602` 的页面结果及运行时“正常”读回 | 两次请求各自命中的部署/版本，`Latest` 与已发布应用版本的精确绑定 |
| MOD-30 | 严格工具提案经本地一次性审批、受控读取、目标读回；候选经独立预览/批准、CAS 写图与 Evidence/重启读回 | 平台原生同 run 恢复和普通非会议能力闭环；不能把本地工具执行写成云端直接执行 |
| MOD-31 | 这批回答经过已发布多智能体应用；PR #108 的较早 trace 仅显示三个 `UserInput`/模型活动 | 本批角色交接 trace、必要性/基线对照、固定评估集及失败分支 |
| MOD-32 | 本批 API 状态、本地任务终态和 graph/Evidence/重启结果分别有回执 | 本批每请求 trace/usage/费用、失败核实、发布回退和无静默 Local 回退的独立证据 |

新批次只增补实际出现的证据和缺项；不为每个 MOD 另跑主链或新建采集脚本。

### 2026-09-25 非会议单次候选：独立回执

MOD-04B 已有脱敏回执 `mod04b-nonmeeting-2026-09-25T11-30-13.198Z.json`
（隔离工作树忽略目录，仅本机保存）。11:30:13—11:30:53 UTC 的一次合成
`draft-review`/`delivery-deadline` query 使用新的调用方请求 ID `11ba1b05…6c2e`：
一次云请求、HTTP 200、完整 SSE、三对 workflow 开始/结束、零 error event；
本地严格解析得到匹配契约的 `repair_candidate` v1.0，验证等级仍为
`unverified`。回执明确 `localToolExecuted=false`、`graphWritten=false`、
`localFallback=false`、`automaticRetry=false`。这只证明普通非会议输入的一次
query 级候选格式，不证明工具提案、本地审批/执行、真实 continuation、Policy/CAS
或目标系统读回；不能与上方会议链拼成新的端到端通过。

该回执报告主控版本 `v20260925192219`、证据审查版本 `v20260925191806`，
但 `requestDeploymentVersion=unavailable`。MOD-29 对同一时间窗作平台只读核对：
一条成功 trace `668c…736d` 于 19:30:13 CST 开始，耗时 38,937 ms，
平台显示 3,365 input + 2,288 output = 5,653 tokens；可见输入与本次合成
`draft-review`/`delivery-deadline` 语义相符，末段模型输出有候选。它与本地
请求按时间和输入语义**候选关联**；平台未回显调用方 `X-Request-Id`，本地响应
也没有 server trace ID，因此不是精确 ID join，不能将 5,653 tokens 标为本请求
已核实的 usage 或换算为费用。

MOD-30 调用前读回原运行时正常、`Latest=v8` 及上述应用版本/两个引用；这证明
预调用平台状态，不证明该请求命中的部署版本。trace 根 span 的
`resource_version:"draft"` 也不是运行时版本。MOD-31 可复用该 trace 的三个
`UserInput`/模型 span。MOD-29 限定复查确认：三段为同级节点，各自有
开始→大模型→结束；逐段 `gen_ai.resource.id` 和 `gen_ai.agent.name` 都只指向
主协调器，`resource_version` 均为 `draft`。可见元数据没有三个源工作流 ID、
子角色名、`agentId`/`workflowId` 或跨段 parent/links 映射。因此只证明一次
成功的多智能体入口调用及三段模型处理，不证明 World/Plan/Review 实际路由与
交接。MOD-31 的固定评估和基线对照仍缺。
MOD-04B 的 [PR #128](https://github.com/zemeng5208/PersonalAgent/pull/128)
涉及 continuation prompt，但本次只有首次 query；PR 存在不能替代其真实续接验收。

### 后续 AgentArts 配置快照（2026-09-25 22:16 CST）

MOD-30 另读回主应用 `32d4d44c-eade-4f3f-8f76-209c74609e79` 源版本
`v20260925221532`，仅绑定 World 子工作流版本 `1790345132102`；执行后为
“终止”，起始/默认/结束角色槽为空。World 源版本为 `v20260925220514`：`text`
分支是 Code→聚合→End，`review` 分支是 Code→Review→聚合→End，`complex`
分支是 Code→World LLM→Plan→Review→聚合→End。MOD-30 同次读回既有 Runtime
`agent-arts-d5ae1174bc7d4cb8ab3dbbc6fae654e4` 为正常、`Latest=v9`，并保留 v8。

这是 **22:16 的配置与引用快照**，晚于 18:33—18:36 的会议主链，也晚于 19:30
的非会议探针；它不能证明那些请求命中此版本，也不能证明可选角色槽或三个业务角色
在任何一条 trace 中真实执行。

MOD-30 于 2026-09-27 登录后再次只读确认：Runtime ID
`1beeb366-7d05-4bb5-b054-d0b626aaef7f` 仍为正常，`Latest→v9`，更新时间仍为
2026-09-25 22:16:28；主应用最新已发布版本仍为 `v20260925221532`
（版本 ID `1790345764695`），并仍绑定 World 版本 `1790345132102`。本次没有修改
配置或发新请求。因此可表述为“9 月 27 日只读核对仍读到该配置”；请求级版本绑定与
角色执行仍未知。MOD-30 没有提供可直接用于剪辑的控制台截图或视频素材。

## 比赛演示准备：分镜、口述稿与方案骨架

**暂定演示名：**《PersonalAgent × AgentArts：云端提出建议，本地审批并核实修复》

以下分镜复用 2026-09-25 合成会议验收、MOD-30 的配置文字读回和 MOD-11 的独立
Goal/Desktop 验收。它展示已发生阶段，不代表五条交付链全部验收。会议链两次云调用
彼此独立：调用时记录的发布背景为 `v20260924225602`；更晚的配置快照及 9 月 27 日
复核为 `v20260925221532`、Runtime `Latest=v9`。会议请求命中的 Runtime 版本仍
**未读回**。MOD-11 Goal/UI 验收是另一批本地任务，`cloudInvocations=0`，不能与
会议链合并描述成同一条 AgentArts 运行。预计口述约 4 分 30 秒只是制作节奏，
不是已核实的赛事时长要求。

| 时间 | 画面与旁白 | 已验证依据及画面限制 |
| --- | --- | --- |
| 0:00–0:25 | 标题与合成场景：“用会议时间变化说明系统如何把云端建议和本地执行分开。全程使用合成数据。” | 目标为 `huawei_ict_agentarts`。不展示私人数据。 |
| 0:25–0:55 | 展示两条标注日期的发布证据卡：“会议链记录的发布背景是 `v20260924225602`。9 月 27 日复核仍看到最新发布 `v20260925221532`、World 版本绑定和 Runtime `Latest=v9`。这不能证明会议请求实际命中哪个版本。” | 第一版本来自会议验收记录；后一版本/绑定/Runtime 状态来自 MOD-30 9/25 与 9/27 只读读回，没有对应可用截图；用来源字幕卡，不录制仿真控制台页面。 |
| 0:55–1:35 | 展示第一次调用结果：“第一次独立云调用返回严格工具提案。Runtime 将其作为未验证建议，仍由本地审批决定是否读取。” | 本地请求 `ddaa2b75…6f27`：HTTP 200、完整 SSE、无错误事件；本地一次性批准后，`workspace.read_text` 读取合成 `meeting-update.json`，读取结果经确认。证据见 PR #104 的 `MVP-ACCEPTANCE.md` 与留存主链回执。 |
| 1:35–2:05 | 展示本地结果被最小化后交给第二个独立调用：“本地任务产生新的云请求，用已确认的合成结果请求候选；这不是恢复同一个云端运行。” | 两次 invocation 的请求 ID 不同。只展示脱敏摘要和本地解析结果，不播放原始云响应。 |
| 2:05–2:45 | 展示候选与原生预览：“第二次调用返回 `repair_candidate`。候选没有写入图谱，必须经过本地预览与独立审批。” | 本地请求 `b2b1f07a…2fe6`：HTTP 200、完整 SSE、无错误事件；source task 为 `succeeded`，候选仍是 `unverified` 建议。原生预览材料来自既有 D2 收据。 |
| 2:45–3:35 | 展示单独的本地 `cognition.commit_repair` 审批、提交结果和图读回：“获批后才用 CAS 更新相关节点；无关计划保持不变。” | 独立 local task 获 `allow_once`；graph revision 到 9。读回 `attend=17:00`、`prepare=16:00`、`preparation=16:00`，`unrelated=18:00` 且 revision=1 未变。 |
| 3:35–4:00 | 展示关闭后同库重启读回：“重启后两个任务仍成功，修复与执行 Evidence 仍可读。” | 已有重启读回：source read 和 local commit 各一条 confirmed 执行记录；Evidence、审批状态和图内容均读回。不得据此声称跨进程云 run 恢复。 |
| 4:00–4:35 | 明确提示“下面是独立的本地 Goal/Desktop 验收，不含 AgentArts 云请求”。展示 create task、批准、重启读回 Goal revision 1，再 revise task、批准、第二次重启读回 revision 2。 | MOD-11 固定组合验收 commit `89154c3b662d063d574f10ebe3d74a09fa94d040`；两个任务均 succeeded/revision 10、一次性审批 allowed/revision 2、ToolExecution confirmed，各一条 Evidence；Fact revision 2，影响 receipt completed。该回执 `cloudInvocations=0`，只能证明本地 UI/Runtime 路径。 |
| 4:35–4:55 | 收尾：“云端建议、本地执行与独立 Goal/Desktop 路径已有分段证据；请求版本精确绑定、World/Plan/Review 实际交接、成本、平台回滚、固定模型评估及完整 MVP 仍待验证。” | 缺项按本文件矩阵显示。非会议 query 探针只返回未执行的候选，仍不计作工具闭环。口述时长约 4:55 仅为制作安排，赛事视频时限仍以官方规则核实为准。 |

**可选替换镜头：本地编程工具（单独交付链，不计入上述 4:55 主分镜）**

MOD-11 固定 Coding 验收使用隔离组合 head
`81ef55c`（commit `81ef55c`）：stage、apply、固定 command 三个 task 各经
`allow_once` 后 `succeeded`，任务 revision 10；SQLite 审批状态 `allowed`、revision 2，
ToolExecution `confirmed` 且 `policyDecision=allow`，每项一条 Evidence ref。stage
后文件保持不变；apply 后文件 SHA-256 为
`1235F8F435B1D16F7AAC442351F2E29FF1BD2B74652392C4ACCB5EC5565973DA`；固定 command
exit code 0，stdout SHA 与源文件一致；没有 `.inflight`/恢复残留、重试或云调用。

口述建议：“这是本地编程工具的独立合成工作区验收。预览不改文件；获批后 apply
并运行固定命令，哈希读回一致。”素材/实现来源为 MOD-11 head 与其忽略目录的本地
验收记录，不能把隔离过程视频当成当前公共 PR 页面素材。状态仍为 `conditional`；
不证明公网 PR #176 已合并，也不证明真实外部工作区可用。只有确认官方片长要求和
最终剪辑取舍后，才决定是否用此镜头替换本地 Goal 镜头。

素材索引：主工作树忽略目录 `.cache/full-chain-acceptance-20260924.md`；D2 留存的
脱敏回执/截图位于其本机忽略目录 `.cache/desktop-agentarts-wRje2A/`；公开评审入口
为 [PR #104](https://github.com/zemeng5208/PersonalAgent/pull/104) 中的
`tests/manual/agentarts/MVP-ACCEPTANCE.md`。忽略目录不是随仓库交付的附件；开始录制
前若本机素材已不存在，标记为待补素材，不重新跑主链来伪造连续镜头。MOD-11 已有
Goal create/revise 固定合成 UI/Runtime 验收，可作为明确分开的本地镜头；这不等于
AgentArts 候选的云端修复 UI 闭环。语音与 Windows Host 仍未读回，不列为已完成镜头。

### 方案/PDF 内容骨架（比赛版要求待核）

沿用 MOD-10 已登记的 [PR #139](https://github.com/zemeng5208/PersonalAgent/pull/139)：
该历史记录写有 PDF ≤20 页、MP4 ≤5 分钟、可运行链接或源代码及 2026-09-30
截止日期；本轮没有重新读到官方详情正文。2026-09-25 对指定官方页面的
agent-reach Jina 读取失败，详情 API 匿名请求返回 HTTP 400 `Missing request header
'Authorization'`，未登录或读取本机令牌。页面原文、当前赛道/作品形式、截止时分与
时区因此均未核实，不能据该历史日期保证资格或提交状态。下面只作为内容骨架，
页数、格式、视频时限、提交类型、截止时间和赛事版本须待官方正文确认。

1. **项目与问题：** PersonalAgent Competition Profile 的使用场景；注明本次为合成会议例子。
2. **目标与验收边界：** 云端提出计划/工具候选，本地 Runtime、Policy 和目标读回掌握执行状态。
3. **总体流程：** AgentArts invocation → 严格解析 → 本地审批 → 工具执行与 Evidence → 第二次独立 invocation → 候选预览与审批 → CAS/重启读回。
4. **AgentArts 构建与发布：** 记录已读回的应用版本、当时运行时状态及时间；显式列出请求级版本绑定未知。
5. **本地权限与安全：** `allow_once`、合成只读工具、候选 `unverified`、CAS 和无关节点保持不变。
6. **实际结果：** 两个独立请求状态、本地审批/执行证据、graph revision 9 与重启读回；每项引用对应回执。
7. **异常与恢复：** 说明网络结果未知时先核实，不盲目补发；平台回滚能力未验，已提交的本地图历史需要独立版本化补偿。
8. **评估与限制：** 固定 AgentArts 评估、基线、角色交接、精确 trace/usage/费用与五链联合验收均列为待交付，不用 Fake 或单次成功替代。
9. **后续工作及贡献：** 只写有代码/PR/读回支持的阶段；链接项目公开代码和经许可可展示的材料。

## 展示口径与 MOD-04B 接口需求

对每次 invocation 分开呈现：本地请求 ID 的脱敏引用、本地 task、目标 Runtime
配置、API 状态与解析结果、平台部署版本、平台 trace ID、平台 input/output tokens、
账单费用及各字段的来源/读回时间。实现展示时，本地回执只能支撑本地请求、
目标配置、API 状态及解析结果；未取得的平台字段须显示“未读回”。
按时间/输入找到的平台 trace 可另列为“候选关联”，附匹配依据与观察时间，
不能放进精确请求级 trace/usage 栏。
`runtimeVersion=to-be-read-back` 必须显示为“未读回”，不能
作为真实版本。合并多个请求的 token 会掩盖失败重试或多次 invocation 成本。

MOD-04B 需在自己的文件锁内提出并验证最小适配增量：把**平台返回或平台查询
证实**的请求级部署版本、原生 trace 身份和 usage 与本地 invocation 关联；无法
精确关联时保留 `unknown`，并记录匹配依据。调用方生成的 `X-Request-Id`、配置的
Runtime 名称、API 200、模型正文和控制台当前 `Latest` 都不能代替这些字段。
字段位置、是否由 Invoke API 返回或另查观测接口，以及公共 DTO 形状均待该模块
根据真实脱敏结构证据确定；本 MOD 不猜供应商响应字段、不新增旁路解析器。
单次费用只能来自可核对的账单/定价读回，不能按 token 猜金额。

## 故障核实与发布恢复

1. 先保留本地 task/revision、一次性审批与执行回执、脱敏请求 ID、发送时间和
   HTTP/解析状态。若 fetch 失败且没有 HTTP 状态，远端是否执行保持 `unknown`；
   不因当前 trace 列表未出现记录而断言未执行，也不盲目补发有副作用的请求。
2. 只读核对同时间窗的平台 trace、Runtime 状态和可用的原生请求关联字段，再读回
   本地任务、工具 confirmed/unknown 记录及目标系统状态。无法消除歧义时保持
   `waiting_reconciliation` 或等价的未核实状态，由受信 Runtime 决定后续处理；
   不让 UI 或云端文字改写本地终态。
3. 需要回退发布时，先读回当前应用版本、Runtime 实际绑定、API 渠道及**此前已
   验证**的候选版本；这些任一缺失都不能声称“可一键回滚”。在授权的发布操作后
   分别读回新绑定、健康/错误和一个无副作用合成调用及其 trace，确认 Competition
   Profile 没有静默切到 Local。平台是否支持原位回滚及其具体 API 尚未验证。
4. 发布回退不会撤销已经 confirmed 的本地读取或 graph revision 9 的写入。若确需
   修正本地结果，应通过新的版本化修复、独立预览、Policy 批准、CAS 与读回；
   不能删除历史或重放旧审批。

## 四层完成状态（2026-09-25）

| 层级 | 当前证据与状态 | 进入下一状态的最小条件 |
| --- | --- | --- |
| 代码 | `origin/main@ec43a55` 有 provisional AgentArts 适配；请求级平台版本/trace/usage 仍无可验证读取。MOD-32 本包只新增证据文档，不能算功能实现完成 | MOD-04B/29 根据真实脱敏结构交付请求关联和可信展示所需数据；保留 unknown 与失败路径 |
| PR | 本包 [#134](https://github.com/zemeng5208/PersonalAgent/pull/134) 为 draft；较早证据 [#108](https://github.com/zemeng5208/PersonalAgent/pull/108) 和集成 [#104](https://github.com/zemeng5208/PersonalAgent/pull/104) 仍各有独立依赖与评审。创建 PR、CI 或作者自查均不等于合并 | 各 owner 解决自己的冲突/依赖，取得已登记非作者评审，再以最新 Git/PR 状态核实合并 |
| MOD-32 真实验收 | 合成会议链的两次云 API 与本地执行/重启已通过；另一次非会议 query 级候选匹配但未执行工具，其平台 trace/token 仅能按时间与输入语义候选关联。请求级部署版本、精确 trace join、usage、费用、失败及回退仍未读回，MOD-32 保持 `in_progress` | 复用 AgentArts 链同批回执逐请求读回版本/trace/usage 与账单依据，另行验证失败核实和发布回退；每项保存脱敏证据 |
| 整体 MVP | 单个合成 Golden Path 不能证明除 Windows 打包安装外的全部约定功能；本 MOD 也不能代表其他 zemeng 模块或 goo122/Potatos 模块完成 | 主控汇总各模块的代码、非作者评审/集成、真实场景读回后逐项判定；未满足的项继续列缺口，不用本记录代替全项验收 |

MOD-32 剩余验收：新版本与请求级部署绑定、精确 trace/usage/费用读回、平台失败
及回退演练、角色交接与评估、无静默 Local 回退。真实云调用和发布变更需由主控
协调单槽资源；本文没有运行它们。

## 2026-10-07 当前源码与剩余现场验收

本节只核对 main `4b5ec61` 和尚未合并的 [PR #302](https://github.com/zemeng5208/PersonalAgent/pull/302)。
上方带日期的历史平台及本地回执保持原结论。本轮环境没有云账户绑定/凭据，没有发起
真实云调用、发布、回退或 GUI 验收；离线通过不续期历史平台健康或升级 capability。

| 交付项 | main 已有代码 / #302 未合并增量 | 剩余现场证据 |
| --- | --- | --- |
| 云调用及失败诊断 | main [adapter](../../packages/coordination/src/agentarts.ts) 已支持 Workflow 输入、严格提案/候选与不含正文的失败 diagnostic；#302 补 JSON/日期/信号及 guard 一致性 | 当次部署健康、请求级版本、原生 trace 精确关联、实际响应及失败读回；本地 request ID 和配置名不能替代平台字段 |
| 本地执行与恢复 | main 工具目录、Policy/审批、ToolGateway、confirmed receipt、候选预览/CAS、Fact/Goal/proactive 消费已有接线；#302 补 provider、候选模式、子任务取消及 hook 合同一致性，见 [MOD-29](MOD-29-AGENTARTS-RUNTIME-INTEGRATION.md)、[MOD-30](MOD-30-COMPETITION-EXPORT-01.md) | 采用实际集成 head 的同批合成 Desktop 场景、目标系统读回和同库重启；不能拼接不同批次任务为新 Golden Path |
| 固定评估和基线重复 | main 已有 [fixed runner](../../tests/manual/agentarts/support/fixed-synthetic-batch.mjs) 与 trace scorer；#302 新增 [paired runner](../../tests/manual/agentarts/support/paired-synthetic-batch.mjs)，显式注入两个端口，1～3 对批次沿用同一 deadline/cancel，只报告实际三标签分类及 await 时长；scorer 只计真实 dense own-data records/events | 独立标注的实际平台输出、固定版本及对照；World/Plan/Review 的源身份、路由、交接、预算和失败分支仍须真实 trace，不能由三标签得分推断多 Agent 优势 |
| 费用、发布和回退 | 当前端口没有已验证的请求级部署版本、usage/费用或发布回退契约；#302 不增加这些字段 | 原生请求关联、usage 与账单依据、此前已验证版本、实际回退后的绑定/健康/API/trace 读回。没有精确证据时保持 unknown |

上述 main 接线是实现盘点，不表示 MOD27～32 全部完成。#302 的离线补丁必须在合并与
必要检查后才算 main 增量；真实平台评估、可视化比赛 Demo 和整体验收仍分别判定。
缺少真实嵌套 trace 字段时沿用 [MOD-31 的现有边界](MOD-31-TRACE-EVALUATION-02.md)，
不创建猜测角色 DTO、虚拟 usage 或“一键回滚”实现。

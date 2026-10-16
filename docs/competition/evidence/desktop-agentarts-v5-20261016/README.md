# Desktop / AgentArts V5 真实连接记录

Profile 为 `huawei_ict_agentarts`，分支为 `codex/laya-owned-runtime`。本记录补充 V4 的历史证据，不将 28 张模板图升级为全部业务验收。

## 后续授权的新镜像发布

Owner 随后要求将当前全部改动提交新 PR #376，并将有变化的镜像立即发布，覆盖此前“镜像先不发布”的阶段要求。新镜像源码为 `4aa8f93fd708ad2c780e7cd3c6142d6398c659b6`；其产品代码与完整检查通过的 `618612a1` 相同，之间仅文档/Evidence 提交。相对旧镜像核出9份运行产物变化，沿原 allowlist 导出，102份实际镜像运行文件哈希全部匹配，未包含凭据或 Laya 权重。

- SWR：`workflow-v5-4aa8f93f`，索引摘要 `sha256:5168bda799e9cda660b6c9f67b0e718fad446c74149f5d8b6d77a0d520f7321d`，实际 ARM64 manifest `sha256:3a9b3ae236c0017ace23e89879bbdd37a8488cc2418059bb69bf5f0b4c2d3eae`。
- AgentArts：同一运行时的新版本 `arm64-v5-4aa8f93f-r1`，Latest 已映射，旧 r3 保留。2CPU/8GiB、8080、委托、认证、日志与生命周期均由页面独立读回；环境从原表单继承，仅更新非秘密 `PA_AGENT_DEPLOYMENT_VERSION` 标签，测试开关与凭据未手改，未声称逐值独立比较。见 `image-release-4aa8f93f.json`、`deployment-4aa8f93f.json`。
- 新精确版本文字：实际 Runtime/Client 任务 `succeeded`，目录绑定 DeepSeek-V4.1-Flash / low，WSS101、HTTP任务回退0；9.120秒。见 `cloud-text-4aa8f93f-receipt.json`。
- 新精确版本实时语音：实际 Runtime 工厂及原公开 PCM runner，WSS101，输入/输出最终转写、输出音频、轮次结束和关闭均齐备，10.126秒；没有录音/播放/工具调用。包括按音频时长发送的输入，不是纯模型回复延迟。见 `cloud-voice-4aa8f93f-receipt.json`。
- 新版目录：实际177项，见 `cloud-catalog-4aa8f93f-receipt.json`。SIS生产端口直连证据不改称 AgentArts→SIS。

本次新版本冒烟不操作正在运行的 Desktop，也不改其固定版本配置，不把它升级为新版 Desktop 整图、主子委派或28条业务图验收。下文原 r3、旧任务和检查生成时“未发布”的历史状态分别保留。新 PR 自审已记录并尝试普通合并；GitHub 因缺少当前提交非作者 CODEOWNER 批准拒绝，未修改保护或伪造批准。

## 前次发布对象（r3，保留历史）

- AgentArts 运行时 `pa-owned-bindings-0dae0ff5-api`，精确版本 `arm64-v5-d92a17a4-r3`；刷新控制台后，Latest 也指向该版本。
- 自有 ARM64 镜像 `workflow-v5-d92a17a4`，索引摘要 `sha256:b045e230e0a1bb049f45521a7031c3657fb6951d6ac97b4b17db0a6ea3dcd098`，镜像源码 `d92a17a4c436f37ff7a9bfdc5829044031a89bf7`。
- 实测 Desktop 源码 `8057cf189e054bc500e2d58e475bad6f91ed4bee`；本轮恢复及设置修改运行于本机，不冒称已进入该镜像。Local Runtime/Policy/ToolGateway/Evidence 权限边界保持。
- 2 核、8 GiB、端口 8080、原委托、入站认证和平台日志保留。Laya 仍在本机，不改变质量或架构结论。

## 已完成的真实链路

| 表面 | 原始回执 | 结果 |
| --- | --- | --- |
| Desktop 原主面板任务 | `desktop-receipt.json` 的 `text` | 固定版本 WSS 101，DeepSeek-V4.1-Flash / low，任务 succeeded；提交至终态 6.611 秒 |
| 原面板恢复后派发子任务 | 同文件 `delegation`、`cloudCalls` | DeepSeek 提案 → 原 Policy/ToolGateway → Qwen3.8-Flash 子任务 → 原回执投影 → 主模型续答；父子任务均 succeeded，整链 49.339 秒 |
| 子模型与云端各轮耗时 | 同文件 `cloudCalls` | Qwen 5.377 秒；父模型首次提案 38.081 秒、续答 3.844 秒，均含网关传输，不能当纯 GPU 前向。前一轮 15.520 秒与本轮不同，未建立稳定延迟结论 |
| 旧任务本地核实 | `reconciliation-receipt.json` | 原 parent 从 waiting_reconciliation 转 cancelled；工具记录与原 checkpoint 摘要不变，child 仍 failed / revision 6；核实新增云/HTTP调用均为0 |
| 通道 | 同文件 `sockets`、`httpTaskCalls` | 真实 Upgrade 101，HTTP 任务调用为 0；元数据读取另计，不是任务降级 |
| 先前同版平台独立读回 | `platform-models-final.json` | Qwen HTTP200；DeepSeek 主请求与续答 HTTP200，实际请求字段 low；保留此前 Qwen403 作对照。这是同版前一轮的读回，不冒充本次任务 ID 的平台日志 |
| 原生实时语音 | `voice-receipt.json` | 同版 WSS / `pa.realtime.v1` → 百炼原生实时模型，输入转写、输出转写、音频、轮次结束和关闭全部齐备 |
| 生产 Live Host 与采集边界 | `live-host-receipt.json` | 实际 broker、PCM source、Live Host 默认指令与 request_work/read_context 声明 → 相同云端；81 帧输入、65,280 字节输出音频、双方最终转写、轮次结束与释放确认齐备。设备事件及播放确认采用合成替身，未打开物理设备；本轮未实际触发工具调用 |
| SIS 长期签名及实际识别/合成 | `sis-receipt.json` | 本机受信 safeStorage 读取 AK/SK，官方请求签名；TTS HTTP200 / 77,644 字节音频，其公开中文 PCM 再送 ASR HTTP200，结果非空且识别到测试短句。仅诊断直连 SIS，未经过 AgentArts，不开麦、不播放 |
| 普通启动恢复 | `normal-startup-receipt.json` | 从常规页原 `app.quit` 正常退出，旧进程及窗口已消失；普通 package 入口重开后 Runtime ready，AgentArts/Live/SIS configured 均 true。未使用 bootstrap、环境凭据替代或启动时重写；两份密文摘要保持不变 |
| SIS 生产端口 | `sis-production-port-receipt.json` | 正式配置只读副本 → 当前 production ASR/TTS port 与签名器，两个请求均 HTTP200、端口成功；ASR 原 `chinese_16k_general` 正确识别公开短句，TTS 的合成播放端口收到77,644字节并释放。无实体设备、无原配置写入，不经 AgentArts |

原任务状态与模型回答中的 `verification=unverified` 保留。简单数学值可独立校验，但本记录不把模型自报提升为业务工具或代码执行 Evidence。子任务没有文件操作，所以其 `evidenceRefs` 为空；父 dispatch 的原执行记录由 Runtime 保存。

语音只发送公开 Windows 合成中文 PCM：『你好。这是公开的语音连接测试。请只回答连接成功。』没有录音或播放。runner 从调用 gateway.connect 开始计时：ready 878.837ms、首次输入转写 2504.992ms、输出转写 2819.352ms、音频 6365.288ms、轮次完成 9494.599ms、关闭 9706.362ms。包含按音频时间发送的输入，不能把整轮 9.707 秒解读为一句话结束后的回复延迟。`socketEvidence.wallMs` 的外层起点还包含工厂准备，两个时钟不混算；不代表实体麦克风、扬声器、唤醒或听感通过。

## 真实失败与修复

1. 严格 Coordinator 起初遗漏 `executionModel` 可选字段，已补齐原 query 验证和工厂回归。
2. 子任务可发现 Schema 起初遗漏 role/effort 的公开 enum 路径，实际生成提案被拒；已补充，不放宽执行校验。
3. Desktop 原结果投影向缺失 result/error 写入 undefined，严格 JSON 拒绝导出。现生产投影省略缺失字段，成功/失败都覆盖实际工厂与原 ToolGateway 回归。
4. 语音 401 来自配置转交时使用了浏览器遮罩值。通过受信官方控制 API 修正并独立核对原安全配置后，r3 语音实测通过；凭据未进入公开回执。
5. Qwen403 来自专用密钥只允许实时语音。Owner 明确确认后，已在百炼将同一密钥设为全部已授权模型；原账号 IAM、其他密钥及原 API 设置未改变。修改后同一 r3 / Qwen 请求 HTTP200，完整主子任务通过。没有模型静默回退。
6. 原 panel 的 failed 子任务同时保留完全匹配的 cloud-inflight/received，导致 parent 待核实。已用受信本地失败消费与完整 CAS 修复；原 parent 在真实 IPC 下进入 cancelled，原工具/缓存不变，child 的失败状态、revision 与错误保留。失败消费审计明确 `historical_durable_local_failure`、`cloudBusinessSuccess:false`；未重发云调用或工具，随后同一 panel 的新主/子任务均通过。未来明确 WSS 错误帧与无效应用结果分别处理，unknown 继续保持 hold。

失败摘要见 `prior-failures.json`；私人完整日志仍留本机。早先完整根检查曾分别遇到旧夹具错误和一次邮件分类不可用；后者未稳定复现，根因仍 unknown。已有串行 Desktop、Runtime、根集成通过记录不等于最新提交的全量检查，最终检查单独登记。

用户随后在实体录音路径报告“音频发送失败，已停止录音”。合成边界与云端通过不足以确定该故障根因：当前增加安全诊断与明确错误展示，实体麦克风修复结果仍为 unknown。用户停止界面自动操作后，本轮没有再接管其应用、麦克风或扬声器；随后单独授权了华为 SIS 页面的开通操作。

排查时 SIS 本机缺少独立配置。后续找到受信加密 AK/SK，改用长期逐请求签名并保留原 Token/API 配置。北京四、上海一项目的最初探针均返回401 / SIS.0004；明确响应为 `not subscribe this service.`。控制台进一步证实旧 `personalagent-sis` 用户两项服务早已开通，当前密钥主体是主账号，不能据主账号失败否定用户过去配置。Owner 明确允许后，仅为本人账号开通北京四的一句话识别与语音合成，保留原用户及 Everyone 状态，不购买资源包、不充值、不改 IAM。随后公开合成音频的 TTS→ASR 两请求通过，历史失败保留；没有经 AgentArts 的 SIS 适配。

该次 SIS 代码路径耗时 1985.4502ms：安全配置读取 6.4614ms；TTS 签名 4.2507ms、HTTP响应 780.9382ms、响应读取/解析 514.803ms；ASR 签名 0.3647ms、HTTP响应 673.707ms、响应读取/解析 1.5165ms。这是一次公开短句探针，含网络与响应体传输，不是稳定延迟、纯模型前向或实体听写听感测量。

普通启动曾显示配置缺失，真实失败已保留。根因为辅助脚本的加密 profile 错配：AgentArts 的辅助启动脚本在异步等待后才设置 profile，实际使用了 Electron 默认 profile 的密钥；SIS helper 则使用独立 profile，却将密文写入正式目录。独立探针和专用驱动此前通过不构成普通启动恢复证明。已备份原密文，仅在受信内存中解密并以正式 profile 重新加密，独立新进程前后读回一致；原 profile 密钥、Live 文件及原 API 设置未改，不重新申请凭据。随后正式 package 入口启动通过，源码为 `618612a156798ca306768ff0b48b5fea7f9bbcd9`；该次启动没有 bootstrap 或配置环境替代，stderr 为0字节。常规页退出按钮也恢复为可见，复用原退出检查，未强杀进程。

该提交普通合入 `origin/main@18ec9efe`，保留协作者的请求预算和版本化上下文实现；模型设置保留独立挂载，预算单独刷新不重绘未保存表单。未注入已验证 tokenizer 时仍显示未计量，不将独立 API 预算展示当作 AgentArts 完整上下文计量。

同一 `618612a1` 又使用正式配置与 Local State 的只读副本，直接调用当前构建的生产 SIS ASR/TTS 端口及真实签名器，排除手写 HTTP 探针与应用请求参数不同的接线缺口。配置读取79.3164ms，ASR端口818.7888ms，TTS端口1255.9395ms，总代码2155.6034ms；回执记录签名、HTTP及端口后处理分段和4份源码/构建产物摘要。TTS 的播放确认仍是合成替身，不能作为扬声器通过证据；原应用和配置未被测试进程修改。

`live-host-receipt.json` 中的镜像来源仅绑定云端版本；本地 Host 在未提交工作树中测试，测试时未记录逐文件摘要，不能把后续提交或其全部 UI 改动当作该次实测对象。多对话、输入优化与原生推理强度控件另以代码及定向回归验证，最终渲染尚待用户重启后复核。

## 运行与边界

2026-10-16 最终整合检查见 `code-checks.json`，源码为 `618612a156798ca306768ff0b48b5fea7f9bbcd9`。使用 Node24.15.0 / npm11.12.1，完整 `npm run check` 退出码0：架构、契约夹具、生成类型、构建、类型检查、工作区及根集成均通过。37组报告合计3,839项，3,818通过、21跳过、0失败；其中 Runtime659/659，根集成47/47，Desktop1058项中1054通过、4项跳过。跳过不作为成功，所有原断言保留。

此前 `3714188f` 阶段不是一次根命令全绿：首轮在 Windows 嵌套 npm 环境中找不到 Node；精简测试进程 PATH 后补过该阶段。随后缺 OpenSSL/dotnet 与旧测试夹具未注入新会话依赖的失败保留，补回现有工具路径并修复夹具及一处后台任务归属兼容问题后，分阶段复验。先前 Node26 中断的 Desktop 尝试不算通过。本次因整合主线的上下文/预算接线，才对 `618612a1` 完整重跑并取得退出码0。没有修改系统 PATH、安装工具、删断言或把跳过当成功。各轮日志摘要与 SHA256 分开记录；真实云端、设备和视觉状态不由此升级。

按仓库规定版本安装依赖并构建后，在根目录运行 `npm run start:desktop`。设置 → 模型中填写本机安全保存的 AgentArts 连接、精确部署版本、WSS URL，并刷新目录。原独立 API 字段保留；比赛模式语音走 AgentArts，F8 按现有 Live 设置由用户启用，保存配置不打开麦克风。凭据不随源码或交接包分发。

模型目录共有 177 项，其中 127 项文本；全部开放权限不等于全部模型协议、额度和推理已验收。本轮真实推理覆盖 DeepSeek-V4.1-Flash、Qwen3.8-Flash、Qwen3.8-Omni-Flash-Realtime。其他条目保持原 `unverified`，非文本不能充当思考模型；所有新增接口仍 provisional。真实设备、全部模型、28 条业务图、平台全 Trace、长期 WSS 保活及压力测试未在此验收。

本目录 JSON 为公开测试数据；没有音频设备采集、密钥、授权头、安全存储文件或数据库。`manifest.json` 给出文件 SHA256，方便核对。

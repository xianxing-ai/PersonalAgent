# Laya 主流程微批与验证（2026-10-15）

<!-- current-design-alignment-20261015 -->
## 当前口径与历史适用性（2026-10-15）

当前以[详细设计](../design/CURRENT_DESIGN_20261015.md)区分设计意图、已有代码、待接线与真实验收；架构仍未最终定型。
本机Laya、全部28图/185节点镜像串行编排，未合格判断升级经AgentArts代理的DeepSeek；语音百炼既有端口，SIS平台不可用。
SWR `local-laya-v3-244ca434` 已发布，digest `sha256:244ca4340ae5c0f0ee62df98b2e86cddc16a543cb6d1eb5f7abbf163528d96e1`，
云指定版本 `arm64-local-v3-244ca434` 目录与关联日志已验，见[发布回执](evidence/test-image-v3-20261015/owned-release.json)。
两案例完整执行表面为本机同版镜像+本机Runtime/Policy/工具/Laya+远端AgentArts模型代理，
见[真实执行汇总](evidence/test-image-v3-20261015/full-workflow-results.json)：Wukong167.432s、Pelican第二轮81.611s，41工具Evidence；首轮partial保留。
分支父成功、协调锚点created；28目录不等于28业务验收。6次判断182–618ms未达150ms，各案例3裁决均升级DeepSeek，未证高级调用减少或训练。
主动责任、无人值守、归来摘要、用户可调打扰/静默feed与语音确认复用原端口。
高级影子与已有判断合并、主任务优先、按机会资源/收益决定；真实runner目前顺序await主/影，机会并行与普通任务先交主结果仍待接线。
以下带日期的嵌入式、直连MaaS、未发布与旧未验记录均保留原版本范围，冲突部署/完成状态已superseded，不作为当前启动参数。
当前启动只用 `PA_AGENT_LAYA_MODE=local`，镜像不含模型权重、Python或PyTorch；不直连提供商fallback。
旧协作门槛以当前CONTRIBUTING/AGENTS为准，文档或receipt不授予权限。

> 后续 Owner 已改为本机 Laya、串行工作流；本页是此前微批方案及其测试历史。
> 当前主图不再使用下文的 Promise.all frontier；本机独立判断并发/合批仅作为基准对照，
> 以 [当前接线文档](LOCAL_LAYA_WORKFLOW_WIRING.md) 和真实新回执为准。

目标 Profile：`huawei_ict_agentarts`。这是 Owner 授权的源码增量，保留唯一 Laya 和原 Runtime/Policy/ToolGateway，尚未部署到 SWR 或 AgentArts。华为升配申请与本地源码优化分别记录。

## 历史 CPU 执行策略（不代表当前默认主图并行）

主图原有 ready frontier 继续使用 `Promise.all` 并行准备独立候选。下文保留的真实短样本没有显示 CPU 合批时延收益，因此后续源码把默认策略收敛为 `sequential`：selector 立即提交一个旧单项请求，同一权重实例按项前向，首项可先返回；候选准备仍可并行。主入口将同一个可信 `cpuExecutionPolicy` 同时传给 selector 和服务，避免两端对执行方式理解不一致。

显式 `packed` 才使用同一事件循环的 `setImmediate` 收集已就绪项，按既有能力最多 4 项，没有固定等待窗；各项独立编码，同一 SDK forward 处理这些行，再按各自问题与候选解码。Python CPU 前向改用 `inference_mode` 是本轮实现选择，尚无本轮真实权重性能结论。

两种策略均保留每项完整 state、questions、候选及原期限，不拼上下文、不改提问或权重，不把下游依赖变成无条件并行。F20 来源读取、候选生成和验证仍有顺序依赖；CPU 调度优化不会消除 MaaS 生成时间或保证语义上更愿意推进。

## 内部协议与兼容

- 旧 `/v1/systemone` 单项接口保留。
- 旧 `/v1/systemone/batch` 多 state、共享 questions 的接口保留。
- `/v1/systemone/independent-batch` 接收 `{model,batchId,items:[{itemId,state,questions,deadline}]}`，返回同 batchId、每项自己的 `{itemId,result|error}` 与实际 `execution:{policy,forwardCount}`。该接口在顺序策略下可执行多个独立 forward；默认主路径直接使用旧单项请求，不能把独立批接口的顺序行为冒充主路径。
- 内部 batch/item 使用随机 UUID，与原业务 requestId 分开；结果身份、选项集合、概率、完整 token 计数和原 deadline 继续校验。
- 每项独立保留超限/到期/取消结果。已经开始的 CPU forward 不因 HTTP 取消强制并发重跑，服务仍保持 busy，已有未知工具写入仍走原核实路径。

`/health` 保留 `independent_items` capability，披露 `executionPolicy` 与 `inferenceMode`，`inferenceCalls` 只计实际 forward。异构 packed 的 `forwardScope` 为 `sdk_heterogeneous_forward`，顺序独立批为 `sdk_independent_sequential_forward`，旧单项为 `sdk_predict_batch`。一个 HTTP 批次可能对应多个 forward，不能按 HTTP 身份合并或逐行累加：

| 字段 | 含义 |
| --- | --- |
| `batchId` | 一次 HTTP 提交的关联身份；不等于一个 forward |
| `batchItemId` | 该独立判断的内部身份，用于与自己的结果对应 |
| `batchSize` | 实际进入 forward 的有效项数；多 question 项可能编码为更多行 |
| `submittedBatchSize` | 本次 HTTP 提交项数；部分到期时可能大于实际进入 forward 的项数 |
| `executionPolicy` | 本次可信执行策略 `sequential` 或 `packed` |
| `forwardId` / `forwardIndex` / `forwardCount` | 实际 forward 身份、在本次 HTTP 中的位置、实际数量；计时按 `forwardId` 去重 |
| `sharedForwardScope` | 仅 packed 且实际多项共享时为 `sdk_heterogeneous_forward`；单项不伪装共享前向 |
| `preparationMetrics` | 独立批编码预检的 `http_batch_preparation` 指标，固定 scope、batchId、wallMs、processCpuMs；各项回执重复时按 HTTP batchId 只记录一次 |
| `precheckScope` | 明确区分 `forward_group_collation` 与 `context_window_preflight`；旧记录缺少 scope 时保留缺失，不猜测 |

Evidence/手动工作流日志仅白名单保留上述固定身份、计数、已验证的 scope 和请求级 preparation 数字，不导出 state、questions、候选正文或原始推理对象。HTTP preparation 与各次 forward 的 collation 分开记录；不把同一 preparation 复制相加，也不混比含义不同的旧 `precheckMs`。

## 集成和公开实测入口

F28 的显式 packed 集成 fixture 使用 barrier 等待 N06/N07 同时准备，让两项拥有不同候选数量和选中位置，并故意倒序返回批结果，检验内部 itemId 正确归还到原节点；N08 仍须等待下一轮依赖推进。单独选择继续验证旧 `/v1/systemone` 路径。fixture 的 HTTP/forward 计数是显式模拟，不是权重或平台验收。

真实入口为 [`tests/manual/agentarts/owned-laya-batching.mjs`](../../tests/manual/agentarts/owned-laya-batching.mjs)。它只调用已经运行的回环服务，不创建进程、加载权重、调用 MaaS、执行工具、下载安装或出机联网。集成人保留原服务/源码/模型 revision 的独立绑定，且只启动一个服务实例。

可在现有可信启动 harness 内直接调用：

```javascript
import {runOwnedLayaBatching} from './tests/manual/agentarts/owned-laya-batching.mjs';
const report = await runOwnedLayaBatching({
  port: service.port, apiKey: service.key,
  deadline: originalDeadlineUtc, signal: lifecycle.signal, sizes: [2, 4],
  cpuExecutionPolicy: 'sequential', // 必须与已经启动的服务一致；packed须显式指定
});
```

CLI 读取内存环境 `LAYA_PORT`、`LAYA_API_KEY`、必填 `PA_LAYA_BATCHING_DEADLINE`，可选 `PA_LAYA_BATCHING_SIZES=2,4`、`PA_LAYA_CPU_EXECUTION_POLICY`（默认 `sequential`）；凭据由已有宿主注入，不写入命令、文件或输出。调用命令只有：

```powershell
node tests/manual/agentarts/owned-laya-batching.mjs
```

每种规模使用同一完整公开 payload（model/state/questions/原 deadline）的 SHA，对照逐项 await 与同时提交。默认 sequential 两侧均为逐项 HTTP/forward（2 对 2、4 对 4）；显式 packed 且服务策略匹配时才为 2 对 1、4 对 1。均核对 health 实际计数，并按 `forwardId` 收集计时、保留首项/末项完成延迟。不同服务策略需由宿主顺序启动验证，不同时加载两个模型。结果保留选项差异，不强制一致或写成语义正确。

记录顺序总墙钟、同批墙钟、每项等待/selector 时间，以及一次共享 SDK forward 时间。共享时间只记一次；单次比值只作诊断，不设固定提速门槛。Windows CPU 两个 Torch 线程不等于华为 2-vCPU ARM64 容器，单次样本也不是 p50/p95 或 SLA。

## 本轮代码验证与待测边界

默认按项、显式 packed、策略不匹配拒绝、实际 forward 身份与计数校验已补手动入口 fixture；公开日志白名单区分 HTTP 与 forward 身份。独立 [`owned-laya-cpu-pilot.py`](../../tests/manual/agentarts/owned-laya-cpu-pilot.py) 供稍后在同一离线预热 Agent 上对照 serial/paired/packed，可选 MHA/梯度模式诊断开关。它只使用公开合成输入，区分缓存编码流水线与真正重编码的直调流水线，输出完整 payload SHA、实际形状/padding、逐阶段墙钟与 CPU、逐项完成时间、内存快照和实际 forward 数；直调不冒充 HTTP。

本轮只运行无权重 fixture 与语法检查，未启动模型。历史实测数字和此前全量检查不作为当前新源码的性能或验收证明；新的真实权重 CPU 对照待用户稍后安排。没有 SWR 发布或 AgentArts 部署。

CPU pilot 的 **8 项 stdlib fake 检查通过**，覆盖 serial/paired/packed 的真实调用计数、结果对应、padding、重编码计时范围、配对输入 SHA 与差异保留，以及 collate/context 进入消耗原 deadline 时禁止启动 forward。CLI 在导入 Torch 或加载权重前拒绝已过期或无时区 deadline；这些检查不加载模型，也不构成时延结论。

本轮最终 `npm run check` 退出 0：37 组报告 **3127 项，3109 通过、18 跳过、0 失败**，日志 SHA256 为 `82daae8629519682056dc0b13a967ea0c1ed928b7873f4bcaaa1bc7101d16cfa`。Node 生产与测试源码在该检查前冻结。Python 在其后只补截止边界，由单独 **25/25 无权重服务检查**覆盖，日志 SHA256 为 `83b285a4ddf8bb46f8d4c0f183978b936bdd18365fc82131b878fd9bae93bc02`；`npm run check` 本身不执行 Python。

独立手动入口 **6/6**、公开 Evidence 投影 **13/13**、工作流日志白名单 **2/2**，合计 **21 项 Node fixture**最终通过，覆盖默认按项、显式 packed、策略/计数篡改、请求 preparation 去重与 legacy scope 缺失。它们与 CPU pilot 的 8 项 stdlib fake 分别记录，不和全量报告或历史检查相加。源码绑定为本轮冻结工作树文件哈希，详见公开 Evidence；没有冒充已发布的不可变镜像。

独立 CPU pilot 默认只选一类比较，支持 `--cases`、`--repetitions` 缩小实验；`--comparisons strategy` 比较 packed 与 serial，`paired` 比较 packed 与 2+2。MHA/梯度模式由显式开关保持其他条件固定，不自动选择“胜出配置”。一个进程只加载一个现有 FP32、两线程、SDK 0.3.20 的离线模型，按 A/B、B/A 交错；不注册会改变 Transformer fastpath 的 module hooks，不下载或使用真实账号。模型目录、Node 路径、原 deadline、输出位置由调用人显式提供。无权重检查命令：

```powershell
python -B tests/manual/agentarts/owned-laya-cpu-pilot.test.py
```

真实运行须先由集成人检查可用内存与换页情况，按 CLI `--help` 提供现有绝对模型目录及 Node 路径。该运行入口本轮未执行；缓存编码计时不包含 tokenization，`--scopes direct-e2e` 才实际重编码，二者均不包含 HTTP。

## 前一版检查与真实短样本（历史保留）

F28 集成 2 项、手动入口 fixture 3 项、Evidence 投影器 11 项、实际日志白名单投影 1 项，共 **17 项轻量 Node 检查通过**。
它们使用显式 Fake 响应，没有加载真实权重。selector 单测 **24/24**、Python 服务单测 **18/18** 通过，
Python 单测复用实际 SDK 编码/解码但不加载权重。

前一版微批源码的 `npm run check` 已退出 0：37 组报告合计 **3122 项，3104 通过、18 跳过、0 失败**。
日志 SHA256 为 `f4532ec4313d7f681d3bc6ec7eee27ade006260337299cc2a9b2aa1a4252e8f9`。
其中已经包含 Node selector/工作流集成的相关回归；Python 和独立手动入口/导出检查分别记录，不重复累加。
旧 e4c 的 3111 项检查保留为历史，不冒充本轮新代码结果。Astra 最终只读代码复审无具体阻断，
不替代 GitHub 合资格非作者批准，也不代表平台或完整业务验收。

集成人随后使用唯一现有 Laya 服务和真实权重，在 Windows x64、两个 Torch 线程下完成公开实测。
原始回执 SHA256 为 `48c4514ee49b8106537e6bc882e21de7ea5f20d346ee73fc0adf8669a05c7c08`，
白名单数字、payload SHA、实际选项及源文件哈希见[本轮公开 Evidence](evidence/OWNED_LAYA_BATCHING_20261015.json)。

| 项数 | 逐项顺序墙钟 | 同批墙钟 | 单次变化 | 测量 forward 数 | 选项一致 |
| --- | ---: | ---: | --- | --- | --- |
| 2 | 889.0216 ms | 889.4944 ms | +0.05%，基本持平 | 2 → 1 | 2/2 |
| 4 | 1761.4832 ms | 2161.2170 ms | +22.69%，更慢 | 4 → 1 | 4/4 |

共享 SDK forward 分别为 880.1406 ms、2151.8997 ms，各只计一次，不能将其在每项回执中的重复值相加。
历史旧单项 `sdk_predict_batch` 的 `forwardMs` 包含 SDK `predict_batch` 路径；本轮新独立批按 `_forward`、collation 与请求 preparation 分开记录。两版计时口径不同，不能把历史字段当新纯前向来比较收益。
共 8 次测量 forward，**不含服务启动预热**；0 MaaS、0 工具、0 出机请求。
对应公开项实际编码量为 274/320/275/347 tokens，两种方式均完整、丢弃 0。
六个顺序/同批对照的实际选择均一致；这不证明选择语义正确或领域准确率。

该样本证明了合批与身份/完整上下文机制，但没有显示时延收益，四项反而更慢；没有改模型、权重或固定阈值掩盖结果。
这是单次 Windows CPU 观测，不是华为 ARM64、不同容器规格、冷启动、长输入或稳定 SLA 的性能结论。

实测针对工作树文件，而非已发布的不可变版本。selector/Python 实测哈希保留在 Evidence；
手动入口随后仅修正一条输出说明，将 `batchSize` 从“行数”澄清为“实际进入 forward 的项数”，
多 question 项可能编码为更多行。Evidence 同时保留原实测手动文件哈希与说明修订后的哈希，
没有更改公开 payload 或重新运行模型。

完整 F20 仍未闭环，旧 fe 云端 partial 和历史 Evidence 保留原样；本轮没有 SWR 发布、AgentArts 部署或新平台验收。

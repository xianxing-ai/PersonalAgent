# Laya 主流程微批与验证（2026-10-15）

目标 Profile：`huawei_ict_agentarts`。这是 Owner 授权的源码增量，保留唯一 Laya 和原 Runtime/Policy/ToolGateway，尚未部署到 SWR 或 AgentArts。华为升配申请与本地源码优化分别记录。

## 合并同时就绪的判断

主图原有 ready frontier 已使用 `Promise.all` 并行准备独立候选。本轮只把 selector 原来的逐项 FIFO 改成同一事件循环的微批：`setImmediate` 收集已就绪项，按既有服务能力最多 4 项，没有固定等待窗。只有一项时仍用旧单项接口；批与批之间仍使用同一个预热权重实例。

每项保留自己的完整 state、questions、候选及原期限，分别编码为独立行；同一 SDK forward 处理这些行，再按每行自己的问题与候选解码。不会把上下文拼成一个提示，不更改提问或权重，不把下游依赖变成无条件并行。F20 的来源读取、候选生成和验证仍有顺序依赖；微批不消除 MaaS 生成时间，也不保证语义上更愿意推进。

## 内部协议与兼容

- 旧 `/v1/systemone` 单项接口保留。
- 旧 `/v1/systemone/batch` 多 state、共享 questions 的接口保留。
- 新 `/v1/systemone/independent-batch` 接收 `{model,batchId,items:[{itemId,state,questions,deadline}]}`，返回同 batchId、每项自己的 `{itemId,result|error}`。
- 内部 batch/item 使用随机 UUID，与原业务 requestId 分开；结果身份、选项集合、概率、完整 token 计数和原 deadline 继续校验。
- 每项独立保留超限/到期/取消结果。已经开始的 CPU forward 不因 HTTP 取消强制并发重跑，服务仍保持 busy，已有未知工具写入仍走原核实路径。

`/health` 新增 `independent_items` capability，`inferenceCalls` 只计实际 forward。异构结果的 `forwardScope` 为 `sdk_heterogeneous_forward`，同一批的共享指标会随各项回执重复，不能逐行相加：

| 字段 | 含义 |
| --- | --- |
| `batchId` | 一次共享 forward 的关联身份 |
| `batchItemId` | 该独立判断的内部身份，用于与自己的结果对应 |
| `batchSize` | 实际进入 forward 的有效项数；多 question 项可能编码为更多行 |
| `submittedBatchSize` | 本次 HTTP 提交项数；部分到期时可能大于实际进入 forward 的项数 |
| `sharedForwardScope` | 异构批固定为 `sdk_heterogeneous_forward`；单项不伪装共享前向 |

Evidence/手动工作流日志仅白名单保留上述固定身份与计数，不导出 state、questions、候选正文或原始推理指标；没有把同一共享时间加成多个独立 forward。

## 集成和公开实测入口

F28 集成 fixture 使用 barrier 等待 N06/N07 同时准备，让两项拥有不同候选数量和选中位置，并故意倒序返回批结果，检验内部 itemId 正确归还到原节点；N08 仍须等待下一轮依赖推进。单独选择继续验证旧 `/v1/systemone` 路径。fixture 的 HTTP/forward 计数是显式模拟，不是权重或平台验收。

真实入口为 [`tests/manual/agentarts/owned-laya-batching.mjs`](../../tests/manual/agentarts/owned-laya-batching.mjs)。它只调用已经运行的回环服务，不创建进程、加载权重、调用 MaaS、执行工具、下载安装或出机联网。集成人保留原服务/源码/模型 revision 的独立绑定，且只启动一个服务实例。

可在现有可信启动 harness 内直接调用：

```javascript
import {runOwnedLayaBatching} from './tests/manual/agentarts/owned-laya-batching.mjs';
const report = await runOwnedLayaBatching({
  port: service.port, apiKey: service.key,
  deadline: originalDeadlineUtc, signal: lifecycle.signal, sizes: [2, 4],
});
```

CLI 读取内存环境 `LAYA_PORT`、`LAYA_API_KEY`、必填 `PA_LAYA_BATCHING_DEADLINE`，可选 `PA_LAYA_BATCHING_SIZES=2,4`；凭据由已有宿主注入，不写入命令、文件或输出。调用命令只有：

```powershell
node tests/manual/agentarts/owned-laya-batching.mjs
```

每种规模使用同一完整公开 payload（model/state/questions/原 deadline）的 SHA，对照逐项顺序执行与一次同批执行。默认两种规模预期 forward 数分别为 2 对 1、4 对 1，均由 health 前后计数核对。结果保留每项实际选项是否一致，但不强制一致、不替换差异，也不把协议通过写成语义正确。

记录顺序总墙钟、同批墙钟、每项等待/selector 时间，以及一次共享 SDK forward 时间。共享时间只记一次；单次比值只作诊断，不设固定提速门槛。Windows CPU 两个 Torch 线程不等于华为 2-vCPU ARM64 容器，单次样本也不是 p50/p95 或 SLA。

## 当前验证状态

F28 集成 2 项、手动入口 fixture 3 项、Evidence 投影器 11 项、实际日志白名单投影 1 项，共 **17 项轻量 Node 检查通过**。
它们使用显式 Fake 响应，没有加载真实权重。selector 单测 **24/24**、Python 服务单测 **18/18** 通过，
Python 单测复用实际 SDK 编码/解码但不加载权重。

本轮新源码的 `npm run check` 已退出 0：37 组报告合计 **3122 项，3104 通过、18 跳过、0 失败**。
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

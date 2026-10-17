# Laya 回环 typed-choice 服务

## 2026-10-14 自有镜像接入

本脚本同时由 `apps/agentarts-runtime/src/laya-service.mjs` 在自有镜像中启动，Linux Python/权重与 Node 同镜像，只有一个预热实例。生产宿主生成内部 Bearer，不复用 MaaS/平台凭据；回环 8000 不对外暴露。`LAYA_VERIFY_MANIFEST=1` 时，启动先验证导出模型五文件的 bytes/SHA，随后加载真实权重并完成一次 synthetic typed-choice 前向，`/health.warmed=true` 后 Node 才对外监听。无资产不会下载或伪造可用。health 同时返回 `inferenceBusy`，宿主 FIFO 在超时后可等原 CPU 前向结束，不能因 HTTP 取消重叠加载或重复提交已接受推理。

镜像导出信任根、revision、国内构建源、实际平台验证边界见 [镜像 README](../../apps/agentarts-runtime/README.md)。以下较早的本地使用说明和验证记录保留为历史；新设计不是要求每台用户电脑常驻 Laya。

## 2026-10-15 主流程独立项微批（尚未部署）

CPU 执行策略现由受信启动配置确定：主入口 `PA_LAYA_CPU_EXECUTION_POLICY` 默认为 `sequential`，Node 以 `cpuExecutionPolicy` 同时配置 selector 和 Python（内部环境 `LAYA_CPU_EXECUTION_POLICY`），并核对 health 读回；只接受 `sequential/packed`。默认 selector 立即按 FIFO 派发单项，不等待合批 timer，首项不被兄弟项拖延。显式 `packed` 才同轮收集最多 4 项。策略不由请求正文决定，不在运行中试跑、校准或重放真实推理。

原 `POST /v1/systemone` 单 state 接口及 `/v1/systemone/batch` 共享 questions 的 multi_state 接口保留。
新增 `/v1/systemone/independent-batch`，用于主流程同时就绪、各自具有独立 state/questions 的判断：

```text
request: {model, batchId, items:[{itemId, state, questions, deadline}]}
response: {batching:"independent_items", batchId, items:[{itemId, result}|{itemId, error}]}
```

`batchId/itemId` 是内部随机 UUID，不沿用业务 requestId。每项完整编码，保留自己的问题、选项、期限和解码映射；
默认 `sequential` 每个独立项单独 collate/forward，避免不同项之间的 padding；显式 `packed` 才把独立编码行拼成张量批做一次 SDK forward，不把多个正文或问题拼成一个判断。
同一实例同一时刻仍只有一个 forward，协议最多使用既有 4-state 容量；health 新增 `independent_items` capability，
`inferenceCalls` 仍只计实际 forward，不能用回执条数替代。

每项继续校验完整 token 窗口及实际编码量，预检后重查原 deadline；超限/过期不伪造选中结果。
CPU 已开始时仍不可由 HTTP 抢占，保持 busy 和原取消链。结果必须绑定原 batch/item 身份，
按各自 questions 解码；缺失、重复或替换身份不能被当作另一个节点的答案。

独立批顶层 `execution:{policy,forwardCount}` 返回真实前向次数；每个成功项的 `forward` 绑定随机 `forwardId`、`index`、实际 `itemCount`、`scope` 和 HTTP `batchId`。默认 scope 为 `sdk_independent_sequential_forward`；`packed` 为 `sdk_heterogeneous_forward` 并保留原 `sharedForward`。宿主日志另记 HTTP 提交数 `submittedBatchSize`，实际进入该 forward 的项数为 `batchSize`，多 question 项可能编码为更多行。前向指标按 `forwardId` 去重，不能再把同一 HTTP 当成一次前向。

请求级完整窗口预检和编码单列为 `preparationMetrics:{wallMs,processCpuMs}`，receipt 白名单投影补 `scope:http_batch_preparation` 和 `batchId`，按 `batchId` 只计一次。独立项 `inferenceMetrics.precheckScope=forward_group_collation` 仅描述本 forward 组的 collation；旧 single/shared 的 `context_window_preflight` 仍指完整窗口预检。两种准备成本不能混称或重复相加。

服务在执行 worker 线程内进入 `torch.inference_mode()`，仍保留 CPU 两线程、原权重/精度/上下文及 native MHA 设置。启动后的 `health.executionPolicy` 和 `inferenceMode` 可读回。仅完成无权重回归；新的真实权重性能和峰值内存留待用户稍后实测，不以此宣称提速或云端验收。

现有单实例服务的公开 2/4 项顺序与合批诊断入口为
[`owned-laya-batching.mjs`](../../tests/manual/agentarts/owned-laya-batching.mjs)，它不启动模型或出机联网。
机制、兼容和本轮验证结果见[批处理记录](../../docs/competition/OWNED_LAYA_BATCHING_20261015.md)。

<!-- current-design-20261013 -->
> 本文按所记版本阅读，API/阶段/验收事实保留。当前依据：[完整主架构](../../docs/design/workflow-architecture-20261013/DESIGN.md) · [28功能流程](../../docs/design/workflow-architecture-20261013/WORKFLOWS.md) · [连通图](../../docs/design/workflow-architecture-20261013/index.html) · [接口状态](../../docs/interfaces/CURRENT_INTERFACE_CATALOG.md) · [协作规则](../../CONTRIBUTING.md)。唯一语义决策默认国内MaaS，责任图/并行/后台影子按当前设计；旧Laya默认和双人本机阅读不作为现行要求。设计不等于实现；非作者有效Approve和真实检查仍须满足。


> 维护入口（2026-10-07）：项目主要负责人为 zemeng；当前分工以 [模块分工](../../docs/MODULE_ASSIGNMENTS.md) 为准，最新状态见 [ROADMAP](../../docs/ROADMAP.md)。历史日期、作者和验收结论按原记录保留。

`batch-server.py` 属于本项目，不修改第三方 site-packages。只有直接执行 `main()` 才加载模型。
现有 `laya[serve]` 虚拟环境可运行，启动前由可信宿主设置：

- `LAYA_MODEL_PATH`：已有 multilingual 模型目录的绝对路径，包含 `model.safetensors`。
- `LAYA_API_KEY`：只通过进程环境提供，不写仓库、日志或 Renderer。
- `LAYA_PORT`：可选，默认 8000，范围 1024–65535。

使用已有虚拟环境 Python 执行此脚本。固定绑定 `127.0.0.1`、CPU、两个 Torch 线程，强制 Hugging Face / Transformers 离线模式；缓存缺失即失败，不下载。不要在内存不足时启动，且不同时运行旧 Laya 服务造成重复权重加载。

`GET /health` 同样要求 Bearer，返回 `capabilities: ['multi_state','independent_items']`、`maxStates: 4` 及受信执行策略。仅在宿主明确配置共享 questions 能力后，使用 `LocalLayaBatchHttpTransport` 和 `LayaTriageService(..., {batching: 'multi_state'})`。旧 shared 接口仍按原 SDK `predict_batch` 执行，不把新的 independent CPU 策略宣称为该历史接口的性能优化。

`POST /v1/systemone/batch` 输入 `{model:'multilingual', items:[{requestId,state}], questions, deadline}`。
每批 1–4 个独立 state，共享 questions；服务调用一次 `Agent.predict_batch(states, questions, batch_size=4)`，按原序把结果与 requestId 配对。客户端再次核验身份，不因响应重排错配邮件。结果 `{batching:'multi_state',items:[{requestId,result}]}`。旧 `POST /v1/systemone` 单 state、多 question 入口保留。

所有接口要求 Bearer；请求最大 128 KiB，每独立 state 最大 5000 字符。只有受限 choice 问题，拒绝无白名单的任意输出。全服务一个推理执行器，忙时返回 429，宿主不能盲目重试。错误不回显源正文、路径或异常详情。

CPU 前向不能由 HTTP 取消强行中断：请求超时/断连后不交付结果，当前前向结束前仍拒绝新推理，防止取消造成并发内存激增。后续 chunk 由客户端 deadline/signal 阻止。服务不调度、不读取邮箱、不启动其他模型、不训练，也不向云发送数据。

2026-10-14 真实 ARM64 检查后的期限修正：携带显式 deadline 的调用按该期限的实际剩余秒数等待，不再额外截为 30 秒；排队已消耗的时间仍计入同一期限。缺 deadline 的旧兼容调用继续默认 30 秒。已过期请求在提交前返回 408，不启动新前向。测试截获即时 Fake 前向使用的 timeout，验证 90 秒期限没有被截短，无需等待 90 秒；它不是实际模型性能结果。

2026-10-14 完整决策窗口修正：使用已加载 tokenizer 实际计算 state、指令与选项头的 tokens，通过 SDK 原生 `predict_batch(max_len=..., head_max_len=...)` 按本次需求扩展默认 1024 窗口，最高为实际 encoder 配置的 8192 容量。这是模型编码容量，不是新增用户 token 预算；没有修改权重或静默摘要。超容量返回 `413 / CONTEXT_WINDOW_EXCEEDED`，不提交模型前向、不产生选中候选。响应 `tokenWindow` 记录预检计数，并与 SDK `usage.input_tokens` 的真实已编码计数逐字核对；不一致返回 502。`/health.inferenceCalls` 可核对超容量请求没有新前向。

SDK 每条 criterion 的选项头仍采用 48-token 格式。自有 Node selector 在原始文本 state 中额外保留完整描述和 criterion→候选标识映射，避免头部截短隐去候选含义；只有完整 state、`droppedTokens:0` 和 SDK token 读回一致才接受选择。日志仅新增 token 计数、排队/裁决耗时和候选 ID，不包含正文或凭据。更长输入的实际 CPU 延迟、内存与判断质量须由真实 ARM64/云端样本验证，不能用无权重测试替代。

延迟诊断区分 Python tokenizer 预检 `precheckMs`、整个 SDK `predict_batch` 调用 `forwardMs`（包含 SDK 自身编码、模型前向和解码），以及进程 CPU 时间差值 `processCpuMs`；后者不是墙钟耗时。只读自身 cgroup v2 的 `cpu.stat/cpu.max/memory.current/memory.max` 前后值；不存在或不支持时明确 `missing/unsupported`，不补零或断言 CPU 已耗尽。Node 日志区分排队、CPU 忙等待、内部 HTTP 和响应校验，区间相互包含，不能相加当总时长；MaaS 候选制备耗时按相同 requestId 的 RoleReceipt 另读。QEMU 结果不作为原生 ARM64 基准，预热完成后的裁决也不是冷启动耗时。

tokenizer 预检结束后再次核对原等待的 monotonic 期限及取消标记；期限在预检期间届满不会新启 CPU 前向。已开始的 CPU 前向仍不可抢占，保持原 busy/readback 语义。

原增量完成 Python AST 语法检查与 TypeScript/Fake 客户端协议验证；未启动服务或加载权重。真实批处理吞吐、峰值内存及分类质量需另行验收。

## 无模型的释放回归

在已有 FastAPI 环境运行 `python scripts/laya/test_batch_server.py`。测试直接调用受控请求端口，不开网络监听、不导入 Torch/Laya 权重；覆盖超时后后台任务仍忙时保持 429、迟到模型异常不进入事件循环日志、后台结束后重新受理。该检查不在 Node Foundation 中自动运行，也不能代替真实模型或性能验收。

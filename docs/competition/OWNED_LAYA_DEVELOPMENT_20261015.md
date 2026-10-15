# 镜像工作流开发实测与决策阻碍（2026-10-15）

目标 Profile：`huawei_ict_agentarts`。实现 PR：[#356](https://github.com/zemeng5208/PersonalAgent/pull/356)。本记录对应已测试的生产源码 `e4c87c1d25514422880f370f939a0a41a8962725`；后续文档提交不改变这次测试对象。

**完整 F20 尚未跑通，新源码尚未发布。** 最新原生 Windows 实测使用真实国内 MaaS 和真实 Laya 权重，但首个工具提案被选择器转入复核，没有执行工具，没有产生工具 Evidence。历史 `fe886677` 的华为云首读取及后续复核仍只属于原版本，见[历史公共记录](evidence/OWNED_LAYA_20261014.json)。本轮可公开摘要另见[开发 Evidence](evidence/OWNED_LAYA_DEVELOPMENT_20261015.json)。

## 已修复的工程问题

- 完整上下文：实际 tokenizer 预检后按所需序列设置 SDK 窗口，最大不超过已加载编码器的 8192 tokens；核对实际编码量，不静默截断。溢出在真实 forward 前拒绝。完整 criterion 描述及其 ID 映射纳入 state，SDK 的 criterion header 限制仍明确记录。
- Deadline：tokenizer 预检后、SDK forward 前重查原期限；手动验收的父 worker 没有启动时，不等待一个不会发生的 finally。没有延长原期限来掩盖过期。
- 当前阶段：MaaS 和 Laya 收到同一节点职责、工具的准确 name/version/inputSchema 及候选阶段。工具请求还没有执行，不能要求它已经包含未来执行结果、下游文档或测试成功证据。
- 诊断日志：新增候选数量、摘要、节点和有限错误码；不把候选正文、私人来源或密钥写进生产日志。缺失的历史候选没有被事后补造。
- 恢复：只有受信 revision 迁移明确失效受影响节点，且 tool 节点无 proposal、处于 unknown、原因精确为 `Unique selector requested recheck; no operation proposal emitted`，才允许重新准备候选。相同 revision 不重跑；已有 proposal/operation 的身份、参数和真实效果保留。

## F20 的实际职责与模板兼容

原 N01 声称“比对代码与契约”，实际只绑定一次文件读取，职责与输出不一致。当前改为：

| 节点 | 实际职责 | 完成依据 |
| --- | --- | --- |
| N01 | 请求读取代码、契约及旧文档来源 | 原 Policy/ToolGateway 实际读取与可信来源回执，输出 `sourceReadback` |
| N02 | 执行模型基于已读取来源比对并提出候选 | Laya 选择 `{diffFields, docMarkdown, exampleArguments}` 候选；不预填文档冒充模型输出 |
| N03 | 提议既有受控验证命令 | 原 `local_write` Policy 后实际运行 `tsc --noEmit`；另核对固定 fixture 的 Schema 字段与旧 documentedFields 差异，要求 `sourceDifferenceMatched=true` |
| N04 | 根据实际来源及验证结果复核最终候选 | 精确文档摘要、来源引用及版本；`synchronized:false`，不声称已对外发布 |

差异检查只覆盖固定公开 fixture 的字段集合，TypeScript 检查只覆盖实际编译的接口、实现和示例；均不证明任意 Markdown 的完整语义正确性。最终父任务的合法完成仍由现有 TaskRuntime 决定。

28 功能、185 节点保留。实现分支的设计源数据原为 154 节点，而生成投影已来自设计页 #352 的 185 节点；本轮将该已评审来源同步入当前分支，并只修正 F20 N01/N02 的职责字段。生成器核对通过，没有另造功能范围。

模板版本升级为 `2026.10.15.1`，旧版为 `2026.10.14.1`。模板版本/摘要不一致会拒绝旧 checkpoint；controlRevision 迁移不能绕过这个限制。未来发布必须保留旧版本处理原在途任务及未知操作核实，新模板使用新任务，不能把旧任务“重建”当作恢复。

## 实际运行结果

本轮两个独立的新开发任务分别绑定干净的 e448/e4c 源码，通过原生 Windows Runtime 调真实 MaaS 和真实 Laya；不是原云任务重放，也没有尝试重做旧未知写入。以下均无工具执行和工具 Evidence，SQLite 重开读回仍是原父任务 failed。

| 本机任务 | 源码 | HTTP 提案 | MaaS complete | Laya SDK predict_batch | Laya selector | 实际编码量 | 结果 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `live-iVS2E2` | `e4485613` | 5160 ms | 3127.6779 ms | 1992.8319 ms | 2025.7848 ms | 987，丢弃 0 | N01 `owned-review`，父任务 failed |
| `live-wmFfjy` | `e4c87c1d` | 4699 ms | 2747.0691 ms | 1917.7058 ms | 1943.6092 ms | 1007，丢弃 0 | N01 `owned-review`，父任务 failed |

两次 HTTP 200 均只说明响应可解析，不能升级为成功。MaaS prepare 和 Laya 选择是本轮顺序依赖，两段时间合计构成大部分提案耗时。SDK 区间包含 SDK 内部工作，不是纯神经网络 encoder 基准；Windows CPU 时间、QEMU 时间、华为原生 ARM 时间和冷启动必须分别记录。

生产日志只有候选摘要，没有保存这两次实际候选正文，因而不能断言这两次候选语义上完全正确，或精确解释 Laya 为何弃权。原 `fe886677` 后续 N02 进入复核的具体候选同样没有恢复。发现过长输入截断缺陷，不代表它就是所有复核的共同原因；最新 1007-token 样本没有截断仍进入复核。

另做一组新的公开成对诊断：同一份实际 MaaS 候选，旧上下文/提问与当前上下文/提问均选择 review。其工具 Schema、版本和公开路径检查通过，但描述仍混合了读取与生成差异的职责，不能称为完整语义正例；两种上下文和提问同时变化，也不能据此定位单一字段的因果作用。

最后在推理前固定了三个手写公开探针：目标路径匹配、错误路径、缺工具 Schema；各用当前提问和一个固定短提问，真实权重共推理六次。**六次均选择 review，两种提问都未接受预期合法读取。** 这证明当前方案尚未展示该小样本上的正负区分能力；不构成领域准确率、校准结论或 Laya 对所有任务无效的证明。没有移除 review、降低门槛、改权重或反复改写问题来制造通过。

## 镜像与平台状态

本轮完整 Dockerfile 构建在 ARM64 npm 安装阶段长时间无新增输出后被取消，未产出新发布镜像；不能把取消归因为已证实的网络或鉴权故障。随后本地增量验证方案的门禁退出，未完成增量镜像和长输入 ARM64 推理。

本地 containerd store 的实际镜像 ID 是 OCI index `8dd561…`；ARM64 manifest 为 `8120ad…`，config 为 `2fe9de…`，三者属于不同对象。缓存验证脚本已拆分这些身份；准备或语法检查仍不等于成功构建或真实 forward。

用户要求做完较大版本再发布，本轮没有 SWR 推送或 AgentArts 部署。历史平台日志、首工具及镜像证据保持原日期；本轮没有重新读取平台 Latest，不能保证历史别名始终不变。原生 MCP/知识、完整 Trace、平台评估、28 条真实业务及 Desktop/语音确认仍分别验收。

## 验证、审查与下一步

- `npm run build:owned-agent` 通过；生成器与当前仓库 canonical source 的 `--check` 通过。
- 当前改动的定向检查共 75 项通过：图 18、orchestrator 20、selector 14、manual/exporter 23。图/模型替身验证与真实 TypeScript 子进程验证按测试范围分别理解。
- 本轮源码 `e4c87c1d25514422880f370f939a0a41a8962725` 的完整 `npm run check` 已实际 exit 0：3111 项、3093 通过、18 跳过、0 失败。日志 `check-owned-runtime-e4c-20261015.log` 的 SHA256 为 `da0047f3227089ad0b37551971fad334117e52c7d45145a182c75a34f4e6dbf4`。
- 早先 `388a7e5` 的完整检查为 3108 项、3090 通过、18 跳过，作为历史独立保留，不与本轮或 75 项定向检查累加。
- 一次组合测试最初有一个旧 orchestrator 输出断言失败，修正该断言及 fixture 后该文件 20/20 通过；未删除断言掩盖失败。
- Astra 独立源码复核未发现本轮修复的新阻断；这不代替 GitHub 当前提交的合资格非作者 Approve。
- 旧 PR head 的 Windows CI 在知识库 TLS fixture 的 PowerShell 证书生成 10 秒超时处失败；本轮不修改该无关模块，也不把本地通过写成远端 CI 已恢复。

当前源码仍以 Laya 为唯一语义决策模型。基于实测，建议验证“镜像保留工作流、通过国内云 API 使用一个统一决策模型”的路线；迁到本地只改变放置方式，没有证据表明能解决已观察到的复核倾向。该路线尚未实施，不新增第二个生产决策中枢。

下一次模型对照应覆盖工具候选、记忆排序、上下文保留、计划修复、影子比较及失败恢复，并保留合法推进与应弃权的反例；先固定输入、判断标准和输出 Schema，再比较正确性、延迟及调用成本。API 文本中的自报置信度不能当已校准概率。通过之后再决定替换及发布，权限与工具执行继续复用原 Policy/ToolGateway/TaskRuntime。

### 同日选型补充：百炼决策 API 尚未接入

用户提供 `decision-model-preview` 后，已核对[阿里云官方 API](https://help.aliyun.com/zh/model-studio/decision-model-api)及[模型信息](https://help.aliyun.com/zh/model-studio/decision-model-preview)：确有北京地域的工作空间端点 `/compatible-mode/v1/systemone`，支持 state 与 choice/noul/score 问题及结构化概率结果，文档使用 TypeSafe System One 协议。

这是可优先验证的国内托管决策接口，但官方所列“推理服务供应商为百炼”不等于证明底层模型国产自研，协议兼容也不证明使用 Jev 权重。当前页面没有给出可支持这两个身份结论的依据。没有调用百炼 API、检查私人凭据或改变现有 Laya 组合。

文档目前列为 preview，模型调优不支持；多问题会增加延迟。结构化结果仍需校验类型、选项集合、概率、request ID 和原期限，不能取消现有确定性边界。当前账号权限、真实效果、网络延迟及服务来源须独立验证，不能用官网示例的 latency 当项目实测。

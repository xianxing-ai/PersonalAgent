# AgentArts HTTP 200 / EXTERNAL_FAILURE 审计

## 已确认的线上证据

先前已授权的生产部署探针使用 `published` 模式和合成文本，只发出一次请求。`2026-11-26T10:51:30.350Z.json` 脱敏回执保存在本地 `.cache/agentarts-context-budget/`。其目标文本共 5,014 个 JavaScript UTF-16 码元、12,478 个 UTF-8 字节，应用层请求为 12,672 字节，约 13.611 秒后返回 HTTP 200 和 `EXTERNAL_FAILURE`。回执的 `requestUsage` 为空，`outputReservation` 为 `unverified`。

该记录来自直接调用 `AgentArtsCloudAgentPort` 的探针，缺少此次请求的 Runtime 持久任务状态、execution epoch、响应媒体类型、解析阶段、终止事件、关联请求 ID 与平台 trace。留存的是状态和计量元数据，无法从中推断响应结构。当前分支的 `onDiagnostic` 能记录部分字段，历史回执无法回补。**线上故障根因仍未定位。** 本轮真实云调用数为 0。

## 链路逐段检查

| 环节 | 实际代码与证据 |
| --- | --- |
| Request Builder | `packages/coordination/src/agentarts.ts` 的 `compileRequest` 根据 published/workflow 路由序列化 query 或 inputs，工具提案与 execution epoch 可影响实际 envelope。应用层可测字符和 UTF-8 字节。探针请求没有模型 `max_tokens`，分支也缺少部署配置对输出预留的可信读回 |
| HTTP Transport | `AgentArtsCloudAgentPort.invoke` 在受信授权、发前守卫与 deadline 后调用 HTTP transport。200 说明 transport 得到成功 HTTP 状态，后续仍需解析。SSE provider error 可以在 200 的 body 中出现 |
| Response Decoder | `readResponseText` 按字节/时限读取并拒绝非法 UTF-8。`parseResponsePayload` 依据 Content-Type 区分 JSON/SSE。错误媒体类型、超限、无效 UTF-8 会提前拒绝 |
| Provider Parser | `consumeEvent` / `TextCollector` 检查事件形状、序列、厂商错误和终止条件。SSE 先输出部分文本再给出错误也会失败。OpenAI `choices` 形状与此处事件契约不兼容 |
| Model Result Validator | AgentArts 路径在 `parseApplicationResult` / `parseTextOnlyApplicationResult` 及 epoch 校验中检查结果 envelope。文本结果可标为 `unverified`。`packages/models` 的 ModelGateway 另有模型响应验证器，未参与这条 AgentArts transport |
| Usage Parser | OpenAI 兼容模型路径由 `packages/models/src/chat-stream.ts` 解析用量、`packages/models/src/index.ts` 验证。此 AgentArts text result 只返回 `kind/text/verification`。离线注入有效 `usage` 仍未返回该字段，无法由本地结果核实模型输入或成本 |
| Finish Reason | AgentArts 事件终止标记描述应用流闭合。离线注入 `finish_reason: length`，成功 text result 仍未暴露 finish reason。平台实际 `stop`、`length` 或其他停止原因应来自受信模型 trace |
| Runtime Result | 通过 `createAgentArtsRuntimeApplication` 和 `task.submit` 回放，实际 TaskRuntime 在模拟 provider 错误后记录 `failed/EXTERNAL_FAILURE`，无成功 `resultSummary`，未自动重发。HTTP 和 TaskRuntime 结果语义分别得到验证 |

## 脱敏结构与 Mock Transport 回放

使用从适配器契约构造的合成响应，模拟脱敏后应保留的结构。历史探针缺少原始响应，以下夹具不是历史响应回放。固定 `.example.test` 目标，注入进程内 transport，无真实凭据或网络。

| HTTP 200 夹具 | 本地诊断阶段 | 分类 |
| --- | --- | --- |
| SSE 部分文本后出现 `error` | `response_schema` | `provider_failure` |
| OpenAI 形状附合法 `usage` | `response_schema` | `event_shape` |
| `text/html` 媒体类型 | `response_schema` | `content_type` |
| 残缺 UTF-8 | `response_body` | `utf8` |
| 不完整 Workflow 流 | `response_schema` | `no_text` |
| 有终止标记但返回错误的 execution epoch | `application_schema` | `application_contract` |

```powershell
npm run build
node --test tests/manual/agentarts/support/context-v2-http200-audit.test.mjs
```

回放覆盖上述六种失败、父用例、用量/终止原因边界、Runtime 终态，共 9/9 通过。真实问题继续定位的最小证据为既有请求对应的部署/版本与请求 ID、媒体类型、终止事件布尔值、`stage`、`schemaCategory` 及允许记录的提供方错误码。优先读取已有平台 trace，确认时间和目标部署唯一匹配。确需保存结构样本时，保留字段名、类型、事件顺序和终止形状，移除用户内容、凭据、私有 URL 和未公开标识。先让该夹具稳定复现，再确定故障归属。采用平台侧修复或适配器修复取决于实测证据，不能因 HTTP 200 接受 provider error、缺终止或错误 epoch。

## 真实模型预算验收标准

1. 固定验收路径为 Desktop/Runtime → 当前发布 AgentArts deployment/version → 实际模型。登记地区、项目、模型 ID 与 tokenizer/version、调用模式、批准号和关联 trace。绑定合成输入，明确现有授权范围。没有可信关联时保留 `unverified`。
2. 逐层记录本地主体字符数、完整 outbound UTF-8 body、模型可见消息/工具编排后的输入 token、可信窗口及最大输出来源。对同一 trace 读回输入/输出 token 和实际 finish reason。Workflow 隐含包装由平台 trace 提供证据。把本地估计和平台计量分别登记。
3. 对中文、多字节、工具包、长摘要以及设置的发送前边界使用离线矩阵。验证最终 `input_tokens + 已配置输出上限 ≤ context_window`，符合现有传输上限。超额、撤销、取消或来源改变触发零模型发送。平台支持可信设置且定位适配故障后，再安排最小数量真实合成正例与受控输出上限用例。
4. 正常完成需要可信 trace 的输出 token 落在实际配置上限内、`stop` 与文本首尾标记相符、Runtime 终态及记账对应。低输出上限用例要求读回上限生效、受控 `length`/等效停止原因，结果对用户显示截断或未完成。无可核实输出配置或 finish reason 的部署，输出预留验收保留开放。
5. 真实调用沿用本次授权的合成范围。先定位并通过离线矩阵，再安排受控请求。记录每次请求用途、调用次数、经允许披露的计量及复核人。完成真实平台读回后才更新接口目录和交付证据。

# 普通任务直接提工具、审批仅由原宿主卡处理（2026-10-22）

Profile：`huawei_ict_agentarts`。本包按用户最新明确要求精简操作审批提示，沿用原有
ModelGateway → AgentArts 编排 → tool_proposal → Runtime/Policy/ToolGateway 主链。
未新增审批机制、权限来源、工具执行路径或运行时重试。

工作树 `.worktrees/psec-real-completion`、分支 `codex/psec-real-completion`，已普通合入
根已提交 `71715c7c`；保留其他协作者的 Desktop/Runtime/授权卡改动。
实际目录为 `packages/agentarts` 和 `apps/agentarts-runtime`；仓库没有
`packages/agentarts-runtime`。镜像入口消费原 `@personal-agent/agentarts`，未发现另一个
应同步修改的系统/continuation 审批提示，故本包不修改镜像代理或服务入口。

## 删除或合并的重复门槛

| 原提示 | 本轮处理 |
| --- | --- |
| FAST 中“不得擅自执行动作”与“所有安全动作独立批准”的笼统口径 | 明确模型负责提出工具操作，原 Runtime/Policy 验证、执行和读回；禁止模型签发权限、伪造 Evidence/成功和泄露凭据。 |
| 普通“日常协作”默认输出 text | 收窄为不需要工具的问候、解释等交流；需要操作的普通任务直接提合法工具。 |
| 参数“仅使用目标明确提供”，任意缺参数均先 text | 可使用已有上下文、宿主固定值、已确认结果及 Schema；真正缺少关键参数时一次问清。仍不猜账号、凭据或路径。 |
| FAST 的 confirmed continuation“不追加动作”与工具续接要求继续执行互相冲突 | 按现有 wire 区分：显式 goal + availableTools 续接继续原任务；receipt-only 续接仍只回答结果。解析和权限边界不变。 |
| 每次新读取/检查仍“独立审批执行”的模型提示 | 新提案继续使用独立标识；是否需要新卡由原宿主决定，不再要求用户聊天确认。 |
| 工作流候选提示把提案与执行批准混淆，包括新文件提案先要求 host-authorized | 用户任务与当前节点契约支持时直接提出候选；实际缺失检查、写入范围和权限仍由宿主在写入前验证。未改 F15 排序、验证、发布或 Desktop glue。 |

`TASK_ACTION_PROMPT` 合并为一处通用操作规则，由 FAST 同时覆盖初始和工具续接轮次：
不在聊天文本索要批准，不让用户说“确认/同意”，不让用户复述任务；需要权限也先提交
操作，由原统一宿主卡处理。仅在同一任务内目标、操作范围、配置未变，且宿主认可的
批准仍有效时沿用；模型不能扩大批准，不能把旧结果当新授权。

不再引导模型先打一轮“请确认我可以执行”，再进入真实工具审批。已有原提示中的 JSON
例子是输出协议格式，不包含额外文字确认对话；JSON/工具 Schema、真实证据、结果未知
不盲目重发及 Competition 不静默回退等必要约束继续保留。

## 人设保留与验证

用户历史要求的 JARVIS 原文记录保留；本次最新授权仅覆盖操作审批内容。以下实际提示值
在改动前从 `71715c7c` 基线捕获，并由新定向测试验证 SHA256：

| 原样保留的部分 | SHA256 |
| --- | --- |
| 身份与自我介绍前缀 | `a45f8481d4b070c84407c0bff3c16b04c3ad9d4657f61e4e2a37edd154ec19ca` |
| FAST 从“交流风格如同”起的完整风格尾段 | `3f072c47f1b8ae5da8dece195757ad249a333c9ba499b5e9e7574b9ae0d5e244` |
| `CONTINUATION_REPLY_PROMPT` 全文 | `d74ce9377e85f76149b87fb6e548e2fb51e58cda595c46b0155542c09ce0f8cc` |

验证使用本树 pinned Node 24.15.0，不安装或升级依赖：

```text
npm run build --workspace=@personal-agent/agentarts
passed (tsc + existing observability build)

node --test packages/agentarts/test/task-action-prompt.test.mjs packages/agentarts/test/conversation-continuation-loop.test.mjs packages/agentarts/test/orchestrator.test.mjs packages/agentarts/test/coding-repair-workflow.test.mjs
46 passed / 0 failed / 0 skipped / 0 cancelled / 0 todo

git diff --check
passed
```

额外比较 `index.ts` 与 `71715c7c` 的 TypeScript AST（归一化字符串字面量后）完全一致，
确认编排控制流只变提示文案，未改变执行/批准逻辑。

新测试检查实际 ModelGateway 请求中的提示、初始/续接直接返回工具提案、旧 receipt-only
边界及伪造授权拒绝，并验证上述人设字节。已有定向测试继续覆盖未公布工具/版本/参数、
取消/期限/无回退、真实来源要求、结果未知不进入替换轮次及 F15 的原验证/发布约束。
全部模型响应和 Host 回执均为明确 Fake/离线夹具；这些测试不能证明真实模型一定不再
索要确认，亦不代表真实本地写入、AgentArts 服务或审批卡 UI 验收。

## 版本和剩余验证

源码提示标识为 `owned-1.9`，仅用于原角色诊断；没有改变协议版本、工具 Schema、数据库
迁移、Desktop 授权 host、Runtime 授权系统、workspace-config-host、coding-repair glue
或授权卡 UI。旧 `owned-1.8` 原文验收记录是历史证据，不能宣称整份提示今天仍逐字相同。

未调用真实模型/服务/邮箱，未构建或推送镜像、未改远端 deployment/凭据或启动应用。
源码合并不会自动替换已钉版的云镜像。真实效果需要后续按另行授权部署与读回实际提示版本，
再验普通任务直接出工具、统一卡片和任务内有效授权复用；不得把本包离线通过当真实云验收。

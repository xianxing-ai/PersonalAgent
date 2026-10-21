# JARVIS 原文源码包与部署兼容性（2026-10-21）

目标 Profile：`huawei_ict_agentarts`。这是用户提供文案的源码实现与静态验证，不是镜像、平台或模型部署。基线为 `ac28a58e0e8045a859d2f1b4d20b0db9f4afcfc2`，原文源码提交为 `786cc012543c9f78a232cbc30c9635fa547947d6`。

## 原文与范围

原 Markdown 原始字节 SHA256：`ade6a1068cbe00e141d71288102be14ccdc901a542f17042bfec1e08dbf0dca3`。没有复制原私人文件路径到公开记录。

- `packages/agentarts/src/prompts.ts`：仅 `PROMPT_VERSION`、`boundary`、`FAST_PROMPT`、`CONTINUATION_REPLY_PROMPT` 四个声明从原文机器复制。
- `apps/desktop/electron/live-voice-host.js` 的 `INSTRUCTIONS`、`apps/runtime/src/application/subagent-host.ts` 的 `rolePrompt`、`apps/desktop/electron/mail-analysis-host.js` 的 project return 从原文机器复制。
- 原 Live Voice 测试只在原有两行更新三个匹配片段，使断言对应实际原文，没有删除断言。
- 另外八个 prompt **声明源码文本**逐字不变；其中 WORLD / PLAN / REVIEW 表达式引用 `boundary`，所以不声称这三个最终拼接值不变。
- 没有重写原文、复制整个旧文件覆盖新代码、修改权限/Provider/工具/任务循环，或加入新依赖。

逐声明前后 hash、八个保留声明 hash、五个源码文件 hash 与 LF 归一化方式见[准备阶段 manifest](JARVIS_EXACT_PROMPT_PREPARATION_20261021.json)。其 `local-only preparation` 是初次保存时的阶段记录；随后用户明确授权提交独立源码 PR，仍未授权部署。

## 轻量静态验证

Node 24.15.0 执行，未安装本树依赖、未借用其他树生产 dist。现有 TypeScript 工具只作为 AST 解析器读取源码：

| 检查 | 结果 |
| --- | --- |
| 权威 Markdown 原始字节 hash | 与上列 SHA256 一致 |
| 7 个目标声明对原文 AST 范围逐字比较与 hash | 7/7 |
| 另外 8 个声明与基线 hash | 8/8 |
| 5 个修改文件 LF 归一化 hash 与 AST 解析 | 5/5，无 parse diagnostics |
| Live Voice 三个原断言片段在实际 INSTRUCTIONS 中存在 | 3/3 |
| 两个生产 JS 与原 MJS 测试 `node --check` | 3/3 |
| `git diff --check` | pass |

本次改动是固定文案与匹配断言，不改变可执行控制流。没有为这些文本替换启动完整 App、实际音频或模型；原 Live Voice 集成测试和完整构建为 `not_run`，由 PR 技术 CI 独立验证。AST/hash 不证明模型语气或真实工具行为。

## `owned-1.8` 不等于已部署版本

在此基线对生产源码追踪 `PROMPT_VERSION`：除定义外，只有 AgentArts `index.ts` 的导入、公开导出、`emitCandidateReceipt` 和 `call` 的角色诊断 receipt 使用。Desktop、Runtime 远端调用与 Coordination response guard 没有导入该常量作为 expected prompt version，也没有按 `owned-1.8` 拒绝旧 `owned-1.7` 的分支。

当前部署身份独立处理：

- Desktop `agentarts-config.js` / `agentarts-transport-config.js` 读取明确保存的 `deploymentVersion`，与 WSS endpoint 一致并在配置变化后失效。
- Runtime `agentarts.ts` / `owned-workflow-image-adapter.ts` 继续把该钉版部署传入原 HTTP/WSS 目的地和绑定 hash；此 PR 没有改变配置或发请求。
- 镜像 binding / workflow 协议版本由各自原常量校验，不消费 `PROMPT_VERSION`。`role-receipts.mjs` 分别保存实际提示词版本字段和受信 `PA_AGENT_DEPLOYMENT_VERSION`，不把两者合成同一事实。

因此该源码 PR 可以独立交付：不会因本地标签变成 `owned-1.8` 自动切换云端或让现有钉版连接配置失败。继续使用旧已部署镜像时，远端仍执行其原有提示词；源码合并不证明云端已采用本轮文案。Desktop 本地语音/邮件投影/子代理文案仅在实际运行本轮源码产物时改变。

以后若获得部署授权，应另建镜像并读取实际版本/digest、部署、健康与真实角色回执，独立验证 ModelGateway/工具链与音频；不能把源码常量、编译或本记录当部署成功。此处没有读取或宣称当前远端实时部署状态。

## 未执行

模型、音频、真实邮箱/账号、付费调用、云 API、镜像构建/推送、SWR、AgentArts 部署均为 `not_run`，调用次数为 0。没有改变用户现有 App、代理或配置。无正式非作者 Approve 或合并结果由此记录派生。

# MOD-04A：架构映射与原生思考配置

状态：in_progress。Profile：`huawei_ict_agentarts`。负责人：goo122；建议非作者评审：zemeng。基线：main `3275aa91`（#347），工作树 `.worktrees/goo122-model-thinking-20261013`。

10-14 交付准备：本包实现、架构映射与本地验证完成，共 21 个文件，进入独立 PR 交付。提交/PR 状态以 GitHub 当前 head 为准；非作者评审与主线集成尚待完成。整体 MOD-03/04A/06～09 和 F28 不据此标为 done。

## 架构与主线对应

设计来源：`docs/design/workflow-architecture-20261013/`。设计 README 的 `b03af83e` 是历史比对基线；以下映射包含 #320/#348 已集成能力，不把图中标签直接当公共 DTO。

| 功能 | 现有代码/公开入口 | 状态与缺口 | 负责人/验收 |
| --- | --- | --- | --- |
| F04 作用域记忆 | packages/memory、packages/learning；确认记录、事实版本、Feed、逐事实删除协调 | 组合实现已集成；完整 MOD-09 仍 in_progress。事实候选必须先逐条确认；摘要不自动保存。整个笔记备份存在时删除仍未完成 | goo122；更正/撤回/删除及无关事实保留 |
| F05 来源回答 | packages/knowledge、Obsidian 配对 readCitation、MemoryQueryPort/KnowledgePort | 来源版本/引用组合已集成；完整语义检索、排序和支持性复验未完成，相关接口不因图示提升冻结等级 | goo122 提供端口；zemeng 消费；版本失效、真实读取与回答证据分开 |
| F21 Skill/MCP | packages/skills、packages/mcp；本机安装快照和受控工具调用 | #320 组合已集成；更广真实调用按能力验收。模型只提出工具候选，Runtime/Policy 决定授权；目录和类型不等于 OS 沙箱 | goo122；禁用/版本变化/过期许可/断连 |
| F24 调度恢复 | apps/runtime TaskRuntime、SubagentHost、Policy/ToolGateway、检查点 | 核心消息/任务/审批只读子集 frozen；完整条件 DAG、必需/可选汇合和跨分支恢复仍待实施 | goo122 Runtime；zemeng Workflow；未知写入先核实、不重复执行 |
| F27 上下文预算 | Runtime 输入编译与最终预算预检；MemoryQueryPort、FactChangeFeed | 既有 16000 字符限制和预检已集成；token 会计、持久上下文版本及新副本删除覆盖仍待独立工作包 | goo122；预算一致、版本追溯、撤回/删除后不重用 |
| F28 多角色模型 | packages/models、Runtime createConfiguredSubagentModelGateway、subagentModels、配置引用恢复 | Model/Agent/Tool 链 provisional；已有 effort 和子模型工厂。当前包补显式原生开关、支持列表、输出预算映射和恢复绑定；完整主对话角色分配/真实效果仍待验收 | goo122 网关/宿主；zemeng AgentArts 编排；离线正确映射、无静默回退 |

Frozen 范围以 `docs/interfaces/CURRENT_INTERFACE_CATALOG.md` 为准；早期 unavailable 记录与后续组合实现应区分，不由此表新增 wire 能力。公共 Schema/DTO 未改，新增字段为 host-only provisional。

## 本包范围

见 [ADR-0024](../adr/0024-competition-native-reasoning.md)。沿既有 Competition 辅助子任务串联：安全模型配置 → Runtime 工厂 → ModelGateway/Provider → 子任务检查点。Desktop 只做设置与安全 IPC，不导入 Provider。

不新增 Local 能力、任务库、调度器、模型注册表或附带脚本执行器。默认 AgentArts 语义编排与 trusted Policy 保持原边界。本轮真实云调用 0、原 Vault 不读取/修改、私人事实不自动保存。

## 验收与继续入口

- Provider：原生 enabled/disabled、支持/不支持 effort、输出字段互斥、凭据/网络前拒绝、取消/deadline。
- 配置：明确确认、目的地/版本绑定、加密恢复、配置修改撤销旧引用，旧记录兼容。
- Runtime：实际子任务最终序列化正确，步骤预算与原生配置独立；恢复时配置漂移拒绝，工具继续由 Policy/ToolGateway 执行。
- 门禁：受影响测试/类型检查、完整 `npm run check`，Desktop 对应烟测；结果完成后补录，不预填通过。

下一包为 F27 版本化上下文与应用副本删除覆盖；条件任务图和影子评估另包交付。提交、推送、PR 和合并按对应授权办理；当前包仅完成本地实现与验证，集成状态以 GitHub 为准。

## 本地验证记录（2026-10-13～14）

| 检查 | 实际结果 |
| --- | --- |
| Model/Runtime/模型设置专项 | `node --test packages/models/test/*.test.mjs apps/desktop/test/model-api-config.test.mjs apps/desktop/test/model-api-controls.test.mjs apps/runtime/test/subagent-host.test.mjs apps/runtime/test/subagent-task-binding.test.mjs`：76 通过，0 失败/跳过；含真实配置宿主/Provider 序列化和 SQLite 重启，但模型响应为显式 Fake/Mock fetch |
| 新增 Competition 原生设置烟测 | `npm run test:native-reasoning-smoke --workspace=@personal-agent/desktop`：实际 Electron main/preload/admin、隔离加密配置、重启、目的地变更清空、删除通过；配置合成，阻止模型网络请求，调用 0 |
| 既有 Desktop 窗口烟测 | `PA_RUNTIME_PROFILE=local` 下 `npm run test:smoke --workspace=@personal-agent/desktop` 通过；显式 Fake Runtime，仅历史窗口/桥接回归 |
| 既有 Runtime Application 烟测 | `PA_RUNTIME_PROFILE=local` 下 `npm run test:runtime-application-smoke --workspace=@personal-agent/desktop` 通过；7 次本地合成 HTTP 请求，2 次取消，不是 Competition 云端验收 |
| Windows helper 专项 | 已有 SDK8、DOTNET_ROOT_X64 与已构建 helper 环境下，按 WindowsJobProcessHost 名称筛选的 5 项测试通过；不修改源码或跳过断言 |
| 文档与格式 | 新文档本地链接、`git diff --check` 通过 |
| Runtime 门禁时间夹具 | 全量检查中 3 项旧测试出现墙钟期限失败，原文件隔离复测 99/99；审批/步骤夹具显式使用 60 秒任务期限及有界等待，保存后的过期验收改用 Node Date 假时钟。修复专项 3/3，生产期限、步骤数、审批/执行次数及终态断言未改 |
| 完整门禁 | `.cache-check-20261014.log` 对应 `npm run check` exit 0；37 个 Node 测试摘要累计 3063 项：3032 通过、31 跳过、0 失败/取消。包括架构、契约夹具/生成检查、全工作区类型检查/测试和集成测试 |
| Foundation 演示 | `npm run dev`、`npm run demo:protocol`、`npm run demo:runtime` 均 exit 0；Runtime 演示读回 succeeded、7 个事件。均为既有本地存储/协议/Fake 演示 |

失败记录保留在本工作树忽略目录：受限 npm 首轮 `Exit handler never called`，受限 TLS 测试失败/停滞；系统默认 .NET7/10 无 .NET8 Runtime 导致旧 helper 启动失败；改用项目既有 SDK8 和受信 DOTNET_ROOT_X64 后专项通过。新增烟测首轮误等待折叠设置可见已修正；旧 Runtime Application 烟测默认 Competition 下无 Local 控件，显式选择它原有 Local 基线后通过。未安装系统组件、未放宽测试、未将 Local/Fake 冒充 Competition 证据。

验证日志：`.cache-native-targeted-final.log`、`.cache-native-product-smoke-retry.log`、`.cache-runtime-application-smoke-local.log`、`.cache-desktop-smoke.log`、`.cache-native-host-sdk8-x64-test.log`、`.cache-check-sdk8.log`。实际原生截图位于 `.cache/native-reasoning-product/`，已检查新增控件可见、密钥输入清空。日志、截图、合成数据库和加密配置均不提交 Git。

门禁重跑记录：`.cache-runtime-gate-repro.log`、`.cache-runtime-gate-fix.log`、`.cache-check-final.log`。Date 假时钟仅在该过期测试内启用，实际保存待处理意图后推进到它的原 deadline 之后，再断言 expired 和无调用；测试上下文自动恢复时钟，不修改持久意图的期限。

10-14 跨夜复核：`.cache-check-final.log` 中多项旧测试记录约 2661 万毫秒（超过 7 小时）的跨度，表明该轮存在长时间执行停顿/时钟跳变；其后续超时不能归为新增功能验证失败或已确认的并发原因。保留并中止该轮后，原知识测试以 4 个文件并发隔离复测 51 通过、1 跳过；未改的标准脚本复测同样 51 通过、1 跳过（`.cache-knowledge-standard-20261014.log`）。未修改知识模块测试并发或生产保护期限。完整门禁恢复后单独重跑（`.cache-check-20261014.log`）exit 0，全部失败记录保留。

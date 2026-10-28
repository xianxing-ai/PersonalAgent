# MOD-29/30 定向验收记录（2026-10-25）

- Profile：`huawei_ict_agentarts`；本轮为本地合成验收，不是云部署验收。
- 基线：`ad1a045e1ec65f9ef280125d9df78b9cb63b4e51`。
- 工作树：`.worktrees/agentarts29-30-20261025`；分支：`codex/agentarts29-30-20261025`。
- 范围：AgentArts 基础适配器、实际 Desktop/Runtime 配置调用方、编排器及工作流工具提案边界。未确认生产缺陷，仅交本记录；不新增重复测试或生产修改。
- 环境：Node `24.15.0`、npm `11.12.1`，独立 `npm ci --ignore-scripts --no-audit --no-fund`，独立构建产物；不共享其他工作树的 `dist`。

## 调用方与边界

`apps/desktop/electron/main.js` 的 Competition 分支从 `agentArtsConfig.transportConfig(cloudBinding)` 取得受信传输配置，注入 `createAgentArtsRuntimeApplication`。`agentarts-transport-config.js` 绑定当前 deploymentVersion，发送前检查原部署；HTTPS 请求只允许绑定目的地和 POST，禁止重定向，并由宿主添加凭据及 `endpoint`。Runtime 工厂把同一个 `assertDeploymentBinding` 接入 `assertCoordinationBinding`，采用 `AgentArtsCloudAgentPort` 和 `CompetitionCoordinator`，本地 Runtime 仍负责工具、授权、持久化与任务终态。

观测 `observationApplicationId` 是可选独立平台 resource_id；没有它不以 runtimeName 补造项目/应用引用。桌面默认没有平台观测授权，不把 invoke Bearer 当观测签名。此处只检查调用链，没有读取平台项目、应用或部署。

`OwnedAgentOrchestrator` 为每个角色注入 ModelGateway，校验正整数输出 token 预算，传递同一原 deadline 和 AbortSignal。现有 continuation 测试实际断言输出预算 512 与选定模型；World/Plan/Review 次数和取消拒绝由编排器测试覆盖。预算不等于真实 token 使用、成本或质量达标。

工具候选仍是不可信提案：公布目录、参数 Schema、来源/版本校验先于后续宿主执行。工作流引擎验证 checkpoint、原操作身份及受信回执；未知写入保留原身份等待读回，不生成替代写入。未配置 Host/工具/回执 verifier 时拒绝或保持 unavailable。云端文本、`task_end`、模型 completed 或候选选择均不赋予工具权限/本地任务完成状态。

WSS 错误码仅在身份绑定与白名单验证后进入脱敏诊断，公共错误保持其契约语义；未识别错误不公开外部任意文本。WSS→HTTPS 是显式传输配置，已发出且结果未知的调用不自动重发；没有模型或 Laya 配置的生产入口启动失败，不静默切换 Local/Fake。以上包含生产实现上的本地 fixture 验证，不是第三方服务验证。

## 实际命令与结果

下列命令从本工作树根执行；UTC 日期均为 2026-10-25，日志 SHA-256 为 stdout/stderr 合并后的字节哈希。每组最终均 exit 0、0 skipped，共 202 项通过。

| 命令 | UTC 开始 | wall 秒 | 通过 | 日志 SHA-256 |
| --- | --- | --- | --- | --- |
| `node --test packages/coordination/test/agentarts.test.mjs packages/coordination/test/agentarts-websocket.test.mjs packages/coordination/test/agentarts-websocket-error.test.mjs` | 06:30:04.757898 | 1.618 | 100 | `b73c98890ffbd63debedb74d15d92c643d6bd6fba3e1ead90f1de3bf6cfebb61` |
| `node --test packages/agentarts/test/orchestrator.test.mjs packages/agentarts/test/owned-workflow.test.mjs` | 06:30:06.375792 | 0.693 | 44 | `3c8d0ee813d32239c68ece8cea571fdfcf2f20d1521cea963222ff15693d7f21` |
| `node --test apps/agentarts-runtime/test/startup.test.mjs apps/agentarts-runtime/test/workflow-wss-budget.test.mjs` | 06:30:07.068919 | 3.946 | 12 | `981bd955bde9bc3b54db1941af03f393448f6f02357c04055e49e15459d74d8b` |
| `node --test packages/agentarts/test/conversation-continuation-loop.test.mjs` | 06:31:16.877416 | 0.635 | 9 | `5190613f865ee1c29e275c6d35bf4ae9ee8f77ae676e4833937471307010390e` |
| `node --test apps/desktop/test/agentarts-deployment-approval-binding.test.mjs apps/desktop/test/agentarts-config.test.mjs` | 06:31:24.938494 | 1.134 | 37 | `3c77e95f92452b73ea117e48c5f6225c5dfe8d8a69dae24f8f61564c06192846` |

前两组使用生产适配器/编排器及显式 Fake transport/model/selector/host；第三组启动生产 server/main 的本地子进程和回环 WS，不访问云或真实模型。最后一组通过生产 RuntimeApplication/SQLite 和合成 fetch 验证旧任务批准前 deployment 变化被拒绝、恢复原绑定后可继续，以及 legacy 待批准任务不能取得新部署身份；配置 UI 数据使用临时合成存储，不启动 Electron 窗口。

首次执行最后一组时尚未构建 Runtime/Client，06:30:11.014938 开始、0.278 秒、exit 1，两个测试文件分别报 `ERR_MODULE_NOT_FOUND`（Runtime `dist/application.js`、Client `dist/index.js`）；未运行其中的行为断言，不能当成产品缺陷或忽略失败。原失败日志 SHA-256：`0124fa51c0bec2d88729d2e5c65921d8d3e15f6b66a032c84e58aafe9854773e`。按依赖顺序补构建后才获得表中 37/37。

构建均执行实际 `npm run build --workspace=@personal-agent/<name>`，exit 0。先构建 contracts、models、coordination、agentarts；随后仅为实际调用方测试补依赖闭包：connector-host、notifications、github、agents、coding-tools、mcp、skills、storage、learning、calendar、goals、cognition、memory、mail、knowledge、policy、tool-gateway、weather、windows-client、runtime、client。未运行重复全仓 check。

完整逐命令 UTC/wall/exit/logSHA 保留在忽略目录 `.cache/agentarts29-30-evidence/results.json`（SHA-256 `ae90c6391ec2484e0430283aedc4f137664c59ca4d6c66478f1c91e47dae4f42`，对应 `0.log` 至 `29.log`）；独立预算检查为 `budget-result.json`（SHA-256 `36dabe78aa2cf90067e4f4abd46c91ee13fdc257a567d638765b2c36d4a6e0de`）与 `budget.log`。复现需先安装并按上述顺序构建依赖，再运行表中命令。

## 未验项和交付状态

没有访问真实账号、私人数据库、云配置或真实模型，没有新建/发布镜像或触碰已有 ARM64 部署，没有改 Gemini/其他提示原文。未验证平台项目/应用/deployment 实际存在与命中、平台签名/认证/Trace、成本、真实 token 预算、模型质量、实体设备、全部 28 图真实业务闭环或比赛验收。既有 ARM64 和历史云证据各自保留，不因本地通过提升状态。

公共接口、Schema、数据库迁移与运行行为无变更，接口继续 `provisional`，MOD-29/30 不标 done。本记录等待 root 集成/发布；本分支未 push、未建 PR、未作独立 Approve。

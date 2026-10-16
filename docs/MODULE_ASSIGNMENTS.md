# 模块分工与交付边界

版本：2026-10-14 · profile：huawei_ict_agentarts。本次保持长期负责人，按新架构重写职责，不转移他人的代码所有权。

goo122负责存储/协议/Runtime/ModelGateway/Policy/工具宿主/知识记忆，以及MOD-33/36/37；zemeng5208负责核心认知、云架构、AgentArts、桌面/语音/Windows和编码工具；Potatos498负责MOD-20—26业务与接线、MOD-34/35/38。每人交付必要端口、实现、消费接线、验证与文档，不将日常验收集中交给一人。

## 39模块与28功能

F编号是产品工作流，MOD编号是工程责任。详细接线说明见[MODULES](design/workflow-architecture-20261013/MODULES.md)。

| 模块 | 当前目标职责 | 负责人 | 主要维护位置 | 工作流 |
| --- | --- | --- | --- | --- |
| MOD-01 | 工程与存储底座 | goo122 | `packages/storage` | F24、F25、F26 |
| MOD-02 | 公共契约与客户端 | goo122 | `packages/contracts`、`packages/client`、`packages/testkit` | F01、F02、F24、F25、F28 |
| MOD-03 | 任务Runtime与调度 | goo122 | `apps/runtime` | F01、F03、F06、F12、F24 |
| MOD-04A | 模型网关与Provider | goo122 | `packages/models` | F23、F27、F28 |
| MOD-04B | 协调与云端口 | zemeng5208 | `packages/coordination`、`packages/agents` | F01、F03、F28 |
| MOD-05 | Policy、工具与连接器宿主 | goo122 | `packages/policy`、`packages/tool-gateway`、`packages/connector-host` | F02、F14、F15、F21、F24、F25 |
| MOD-06 | 本地MCP | goo122 | `packages/mcp` | F21 |
| MOD-07 | Skills安装与执行 | goo122 | `packages/skills` | F21、F23 |
| MOD-08 | 知识、Wiki与Obsidian | goo122 | `packages/knowledge`、`apps/obsidian-plugin` | F04、F05 |
| MOD-09 | 版本化记忆与流程学习 | goo122 | `packages/memory`、`packages/learning` | F04、F05、F23、F27 |
| MOD-10 | 模型能力与训练研究 | zemeng5208 | `docs/research/agentarts` | F23、F28 |
| MOD-11 | Desktop外壳与桥接 | zemeng5208 | `apps/desktop/electron`、`apps/desktop/src/app` | F01、F02、F12 |
| MOD-12 | 悬浮球与对话面板 | zemeng5208 | `apps/desktop/src/features/orb`、`apps/desktop/src/features/conversation` | F01、F12、F24 |
| MOD-13 | 管理后台与配置展示 | zemeng5208 | `apps/desktop/src/features/admin`、`apps/desktop/src/ui` | F22、F23、F25、F26、F27、F28 |
| MOD-14 | 语音会话与确认接线 | zemeng5208 | `packages/voice`、`apps/desktop/src/features/voice` | F02 |
| MOD-15 | 唤醒与连续语音 | zemeng5208 | `packages/voice-wake` | F02 |
| MOD-16 | Windows执行与凭据适配 | zemeng5208 | `apps/windows-host`、`packages/windows-client` | F14、F25 |
| MOD-17 | 本机状态读取 | zemeng5208 | `packages/windows-client` | F13 |
| MOD-18 | 工作区补丁与命令工具 | zemeng5208 | `packages/coding-tools` | F15、F17 |
| MOD-19 | 打包与安装 | zemeng5208 | `packaging`、`scripts/release` | F26 |
| MOD-20 | 待办与日历 | Potatos498 | `packages/productivity`、`packages/connectors/calendar` | F06、F07 |
| MOD-21 | 邮件连接器 | Potatos498 | `packages/connectors/mail` | F08 |
| MOD-22 | 订阅采集 | Potatos498 | `packages/connectors/feeds` | F09 |
| MOD-23 | 通知汇总策略 | Potatos498 | `packages/notifications` | F12 |
| MOD-24 | 研究与资料获取 | Potatos498 | `packages/connectors/research` | F10 |
| MOD-25 | 天气 | Potatos498 | `packages/connectors/weather` | F11 |
| MOD-26 | 可选社交能力 | Potatos498 | 未建立生产目录 | F09、F12、F21 |
| MOD-27 | 目标与依赖图 | zemeng5208 | `packages/goals` | F01、F03 |
| MOD-28 | 持续认知与唯一决策消费 | zemeng5208 | `packages/cognition`、`scripts/laya` | F01、F02、F03、F04、F05、F06、F07、F08、F09、F10、F11、F12、F13、F14、F15、F16、F17、F18、F19、F20、F21、F22、F23、F24、F25、F26、F27、F28 |
| MOD-29 | AgentArts镜像与云基础 | zemeng5208 | `packages/agentarts`、`apps/agentarts-runtime` | F26、F28 |
| MOD-30 | 云Workflow与工具提案 | zemeng5208 | `packages/agentarts` | F01、F02、F03、F04、F05、F06、F07、F08、F09、F10、F11、F12、F13、F14、F15、F16、F17、F18、F19、F20、F21、F22、F23、F24、F25、F26、F27、F28 |
| MOD-31 | 执行模型协作与评估 | zemeng5208 | `packages/agentarts`、`apps/runtime/src/application/subagent-host.ts` | F22、F23、F28 |
| MOD-32 | 云端观测与比赛验收 | zemeng5208 | `packages/agentarts`、`tests/manual/agentarts` | F22、F24、F26 |
| MOD-33 | GitHub能力底座 | goo122 | `packages/connectors/github` | F16、F18、F19、F20 |
| MOD-34 | CI失败修复 | Potatos498 | `packages/coding-tools/src/dev-workflows` | F15、F16、F18 |
| MOD-35 | 测试失败定位 | Potatos498 | `packages/coding-tools/src/test-locate` | F16、F17 |
| MOD-36 | 代码评审预审 | goo122 | `packages/cognition/src/dev-workflows` | F18 |
| MOD-37 | API文档一致性 | goo122 | 未建立生产目录 | F20 |
| MOD-38 | Issue分诊与修复 | Potatos498 | `packages/cognition/src/dev-workflows` | F19 |

## 共享区域与例外

MOD-34/35/38的coding-tools/dev-workflows、test-locate和cognition/dev-workflows/issue-triage由Potatos498负责；MOD-36的code-review由goo122负责，核心cognition仍归zemeng5208。共享exports、Runtime/桌面接线由实际变更人随工作包完成并验证，不反向导入私有源码。

公共Schema、根配置、迁移和根组合由goo122长期维护，但三人可在各自分支提交必要兼容变更及消费测试，不等待独占集成槽。必要跨模块修改说明范围，保留其他人改动；同一物理checkout串行编辑。

## 交付与审查

独立开发可使用契约一致的Fake/Unavailable；缺真实服务只阻止相应真实验收，不阻止可独立实现。授权、付费调用、真实写入与发布按现有授权处理，设计不授予新权限。

状态以ROADMAP登记，接口状态以CURRENT_INTERFACE_CATALOG登记。一个工作包一个负责人/PR，声明profile、拥有文件、依赖、兼容/迁移、验收与剩余问题。当前非作者一人有效Approve即可满足人数要求；按用户要求可同时请求两位审核，不将旧“双人本机阅读”规则恢复为门槛。三人跨PR均衡承担审查与合并，禁止管理员绕过。

Local仅保留既有代码及已经授权的DEV-WORKFLOWS增量，不扩展为第二套默认产品路径。MOD-19发布和MOD-26具体平台开工按已确认范围，不因为本次文档重写自动启动。


<!-- implementation-handoff-20261014 -->
## 2026-10-14镜像实施分发

用户已授权按现有所有权开始镜像实现。三个工作包为IMAGE-CORE（zemeng5208，本机Laya宿主/镜像串行编排/平台发布）、PLATFORM-PORTS（goo122，Inference/MCP/Knowledge/Skills与公开端口）、BUSINESS-CONSUMERS（Potatos498，业务/开发流程消费与实际读回）。详见[实施交接](modules/AGENTARTS-PLATFORM-HANDOFF-20261014.md)。文档工作包仍review，IMAGE-CORE为in_progress；其余ready需记录正式委派/接收，不能虚写已经开工。#350模型思考/#351上下文进行中，复用原PR；MOD-19暂停。

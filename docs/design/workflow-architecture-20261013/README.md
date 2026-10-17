# PersonalAgent 当前架构查看页（2026-10-17 修订）

沿用原 Node.js / React / React Flow 查看器，把当前设计更新到同一张连通图；本页不运行真实 Agent。
设计依据为 `abb70879` 中的[当前详细设计](../CURRENT_DESIGN_20261015.md)、
[F01–F28 状态](../WORKFLOW_STATUS_20261015.md)及[具体接线工作包](../../competition/COLLABORATOR_WIRING_PACKAGE.md)。
本机 Laya 的运行位置与 Competition 参与决定已确认；其他架构设计、接线和验收范围仍需逐项完成。页面分别说明设计目标、接口/代码、真实回执和缺口。

Competition目标边界：AgentArts负责Agent/Workflow的构建、编排、评估和部署；本机Laya在本机运行并参与Competition产品路径。本地Runtime经CloudAgentPort调用已部署工作流，并保留TaskRuntime、Policy、ToolGateway、Evidence与外部读回。本机Laya与自有镜像的既有实测不代表真实云端端到端或官方比赛资格；AgentArts失败不得静默回退到Local Profile。

## 打开与运行

- 直接打开本目录 `index.html`：已打包的离线单文件，无需安装 Node.js 或联网。
- 可编辑源码在 `source/`，独立于产品 Runtime 和根 workspace。
- 本机预览地址为 `http://127.0.0.1:4173/architecture.html`；端口由运行者选择。

```powershell
cd docs/design/workflow-architecture-20261013/source
npm ci
npm run export:offline
npm run preview -- --host 127.0.0.1 --port 4173
```

开发可用 `npm run dev`；结构检查为 `npm run check:architecture`。
`export:offline` 生成 `source/dist/architecture.html`；本目录 `index.html` 是该文件的发布副本。
项目级 `.npmrc` 使用华为云 npm 镜像，不改全局配置。JS/CSS/图标本地打包，无国外 CDN 或在线字体依赖。

## 本轮更新范围

同图包含 F01–F28 的 185 个详细节点、共享路径和依赖；查看器总览有 40 个节点、133 条关系。
展开后 225 个可见节点包含 28 个功能容器、185 个详细节点和 12 个共享节点，
355 条边包含 191 条详细依赖、31 条入口边和 133 条总览关系；这些数量不是新的生产工作流数量。

- Competition由AgentArts承担Agent/Workflow构建、编排、评估和部署；本地Runtime经CloudAgentPort消费已部署工作流，负责授权执行与可信Evidence。
- 本机Laya是已确认的本机运行方案并参与Competition产品路径；2026-10-15本机/镜像记录只证明对应固定版本和场景，不能替代平台编排、外部比赛资格或完整端到端验收。
- 主动四入口、持续责任、来源/Goal/原文、Wiki/记忆/上下文、一般新任务与候选图逐项说明。
- 无人值守/归来、用户可调打扰额度、静默 feed、语音主动询问及当前参数确认同步到节点与机制详情。
- 主对话模型分派和原生思考参数按实际 Provider 能力说明，不把模型预算当思考效果。
- 高级影子融入已有判断、主任务优先、显式比较与普通任务交付分别说明；当前真实案例仍为 main 后 shadow 串行。
- 10 项工作包和全部 39 个 MOD 展示负责人、端口、真实消费方、测试/Evidence 与未完成项。
- AgentArts工作流、模型/工具网关、知识、观测和评估分别显示目标边界、已实现范围与真实验收缺口；未绑定能力保持 unavailable。

## 验证与证据边界

本轮原 Node 项目完成 TypeScript/Vite 构建、离线导出、结构校验及真实 Chrome 交互检查：
28 个功能逐项选择、节点详情、9 个机制、4 个平台面、10 个工作包/39 个 MOD、展开与收起。
这些验证只证明查看器，不新增模型、账号、设备或云工作流验收。

真实运行记录见[完整案例与耗时](../../competition/evidence/test-image-v3-20261015/full-workflow-results.json)。
Wukong flow 167.432s / 20 条 Evidence；Pelican 第二轮 flow 81.611s / 21 条 Evidence，首轮 partial 保留。
2026-10-15 历史案例中的 6 次本机 Laya 实际判断为 182–618ms，150ms 目标未达，相关站点均升级 DeepSeek。
远端目录和关联日志读回不等于远端完整工具循环；28 模板不等于 28 业务全部验收。

原 2026-10-13/14 查看器的设想、审阅和旧验证记录保存在
[历史说明](HISTORY_20261013_20261015.md)，不作为当前模型部署、默认并行或完成状态的依据。
原单文件快照可从 Git 历史提交 `abb70879` 查看；不伪造历史审阅批准。

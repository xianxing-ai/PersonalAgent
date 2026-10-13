# PersonalAgent

Windows常驻个人助手：用户用文字或语音给出目标，系统在已授权责任内持续判断、并行委派、执行、核实和跟进。云端AgentArts镜像调用国内MaaS，本地Runtime保存任务事实、授权、工具结果与终态。

当前主架构已按28功能方案统一；默认唯一语义决策配置为DeepSeek-V4.1-Flash，执行模型候选优先华为支持的国产模型。模型可配置，不新增白名单或审批限制。主架构定稿与生产重构完成是不同状态。

## 从这里阅读

- [完整主架构](docs/design/workflow-architecture-20261013/DESIGN.md)、[28功能逐节点工作流](docs/design/workflow-architecture-20261013/WORKFLOWS.md)、[离线连通总图](docs/design/workflow-architecture-20261013/index.html)。
- [产品需求](docs/PRD.md)、[系统边界](docs/ARCHITECTURE.md)、[重构工作包](docs/design/workflow-architecture-20261013/IMPLEMENTATION.md)。
- [39模块分工](docs/MODULE_ASSIGNMENTS.md)、[接口实际状态](docs/interfaces/CURRENT_INTERFACE_CATALOG.md)、[进度与证据](docs/ROADMAP.md)。
- [Competition Profile](docs/competition/HUAWEI_ICT_AGENTARTS_PROFILE.md)、[公共协议](docs/DEVELOPMENT_PROTOCOL.md)、[协作规范](CONTRIBUTING.md)。

## 当前代码

文档核对基线为main 3275aa91：包含#347架构查看器、#320 Wiki/Skill组合、#332 Windows与补丁恢复等增量。历史固定公开文件场景已有真实Huawei WSS→MaaS→本地Policy/读取/Evidence→续答记录；完整28功能、统一决策迁移、语音确认、影子宿主和端到端延迟仍待逐项验收。本轮只重写文档，不改生产执行链。

当前唯一实施profile为huawei_ict_agentarts；既有Local代码及已授权DEV-WORKFLOWS增量保留，不静默替代比赛路径。TaskRuntime、ModelGateway、Policy、ToolGateway、Evidence和既有记忆/知识端口继续复用。

## 开发入口

版本以.node-version、package.json与锁文件为准。根目录：

    npm ci
    npm run check
    npm run start:desktop

Windows可使用npm.cmd。check执行必要工程门禁；真实模型、账号、语音、设备和比赛验收另见tests/manual。dev、demo:protocol与demo:runtime是开发样例，不能当作生产Agent启动。

架构页index.html可直接离线打开。其source/是独立文档查看器，不是Electron Renderer改用React的声明，也不进入产品根workspace。生成与检查命令见该目录README。

PR需一位合资格非作者对当前提交有效Approve及实际检查、无冲突和意见处理；本轮按用户要求同时请求goo122、Potatos498审核。历史证据保留在原记录和Git，旧Laya/双人阅读设计已被当前入口替代。

# ADR-0001：采用模块化单体

<!-- current-design-20261013 -->
> 本文按所记版本阅读，API/阶段/验收事实保留。当前依据：[完整主架构](../design/workflow-architecture-20261013/DESIGN.md) · [28功能流程](../design/workflow-architecture-20261013/WORKFLOWS.md) · [连通图](../design/workflow-architecture-20261013/index.html) · [接口状态](../interfaces/CURRENT_INTERFACE_CATALOG.md) · [协作规则](../../CONTRIBUTING.md)。唯一全局语义决策为自有ARM64镜像内Laya，国内MaaS为执行候选，责任图/并行/后台影子按当前设计；旧DeepSeek全局决策、Laya本机部署和双人本机阅读不作为现行要求。设计不等于实现；非作者有效Approve和真实检查仍须满足。


> 维护入口（2026-10-07）：项目主要负责人为 zemeng；当前分工以 [模块分工](../../docs/MODULE_ASSIGNMENTS.md) 为准，最新状态见 [ROADMAP](../../docs/ROADMAP.md)。历史日期、作者和验收结论按原记录保留。

适用范围：Huawei ICT AgentArts Competition Profile 与可选 Local Profile；Competition 优先级不改变模块化单体决定。

- 状态：accepted
- 日期：2026-09-06

## 背景

项目需要桌面、Runtime、模型、工具和多个连接器独立开发，但当前尚未验证独立 Runtime 的生命周期、IPC、安装和升级成本。

## 决定

继续使用 npm workspace 的模块化单体。模块按公共端口隔离，应用层完成装配；没有真实进程隔离需求前不拆微服务或空的 runtime-host。

## 影响

- 模块可以独立测试和评审。
- 当前 Electron 可嵌入 Runtime，未来仍可复用同一核心拆进程。
- TypeScript 模块边界不是安全沙箱，外部工具仍需 Runtime、Policy 和宿主边界。

## 复审条件

后台任务必须独立于 Electron 生命周期，且 Named Pipe/HTTP、升级兼容和安装方式已有验证方案时复审。

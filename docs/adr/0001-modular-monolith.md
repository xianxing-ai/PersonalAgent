# ADR-0001：采用模块化单体

<!-- current-design-alignment-20261015 -->
> 2026-10-15适用性：本页保留原日期、作者与accepted/proposed决定；仍适用的Runtime/权限/依赖边界不被撤销。
> 冲突的部署、默认模型、发布、完成事实及旧协作门槛已由[当前设计](../design/CURRENT_DESIGN_20261015.md)更新（superseded），
> 不把历史未验状态套到当前，也不把ADR存在当当前验收。[全部设计导航](../design/README.md)；当前接口另见[目录](../interfaces/CURRENT_INTERFACE_CATALOG.md)。


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

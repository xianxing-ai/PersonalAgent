# ADR-0001：采用模块化单体

<!-- current-design-20261009 -->
> 当前目标与协作规则（2026-10-09）：[完整设计](../design/resident-developer-agent-20261008/DESIGN.md) · [离线阅读/全部 SVG](../design/resident-developer-agent-20261008/index.html) · [两人确认与本机阅读门槛](../reviews/DESIGN_READING_GATE.md)。WSS 主通道、HTTPS 备用；Wiki 记忆由 goo122 接入。goo122 与 Potatos498 均确认后才可按授权合并，禁止强制合并/管理员绕过。设计不等于已实现；本文历史验收与作者记录保留，旧合并规则以当前门槛为准。

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

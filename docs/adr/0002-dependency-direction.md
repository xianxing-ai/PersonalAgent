# ADR-0002：依赖方向与应用装配

<!-- current-design-20261009 -->
> 当前目标与协作规则（2026-10-09）：[完整设计](../design/resident-developer-agent-20261008/DESIGN.md) · [离线阅读/全部 SVG](../design/resident-developer-agent-20261008/index.html) · [两人确认与本机阅读门槛](../reviews/DESIGN_READING_GATE.md)。WSS 主通道、HTTPS 备用；Wiki 记忆由 goo122 接入。goo122 与 Potatos498 均确认后才可按授权合并，禁止强制合并/管理员绕过。设计不等于已实现；本文历史验收与作者记录保留，旧合并规则以当前门槛为准。

> 维护入口（2026-10-07）：项目主要负责人为 zemeng；当前分工以 [模块分工](../../docs/MODULE_ASSIGNMENTS.md) 为准，最新状态见 [ROADMAP](../../docs/ROADMAP.md)。历史日期、作者和验收结论按原记录保留。

适用范围：Huawei ICT AgentArts Competition Profile 与可选 Local Profile；AgentArts Adapter 仍遵守 `packages` 不反向依赖 `apps` 的规则。

- 状态：accepted
- 日期：2026-09-06

## 背景

可复用包一旦依赖具体应用，就会形成反向依赖和循环构建；连接器直接依赖 Runtime 也会让后续模块无法独立开发。

## 决定

- `apps` 可以装配 `packages`，`packages` 不依赖 `apps`。
- Agent、连接器和存储通过自己需要的端口接入。
- 跨包只能使用公开 `exports`。
- 具体实现只在应用或明确命名的 composition 文件中组合。
- 使用 `npm run check:architecture` 阻止可机械识别的违规。

## 影响

本次将 Agent 所需的 worker/tool 结构定义为 Agent 自有端口，移除其对 `@personal-agent/runtime` 的生产依赖。Runtime 的结构兼容上下文可直接传入，不改变任务行为和 wire 协议。

## 替代方案

把所有端口都放进 contracts 会让公共协议成为杂物包；因此只有跨进程稳定数据放 contracts，模块专用端口由消费模块拥有。

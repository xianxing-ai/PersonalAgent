# P8 参考工具及共享装配增量

<!-- current-design-20261009 -->
> 当前目标与协作规则（2026-10-09）：[完整设计](../design/resident-developer-agent-20261008/DESIGN.md) · [离线阅读/全部 SVG](../design/resident-developer-agent-20261008/index.html) · [两人确认与本机阅读门槛](../reviews/DESIGN_READING_GATE.md)。WSS 主通道、HTTPS 备用；Wiki 记忆由 goo122 接入。goo122 与 Potatos498 均确认后才可按授权合并，禁止强制合并/管理员绕过。设计不等于已实现；本文历史验收与作者记录保留，旧合并规则以当前门槛为准。

> 维护入口（2026-10-07）：项目主要负责人为 zemeng；当前分工以 [模块分工](../../docs/MODULE_ASSIGNMENTS.md) 为准，最新状态见 [ROADMAP](../../docs/ROADMAP.md)。历史日期、作者和验收结论按原记录保留。

目标为 `huawei_ict_agentarts`；集成树 `mvp-assembly/PersonalAgent`，分支 `codex/zemeng/p8-mvp-final-integration`。模块源保持原作者所有权。

## 当前接线

- 正式启动默认 Competition Profile；显式 Fake 联调选择 Local，空/非法 profile 拒绝。
- 原 Conversations 元数据升级 v3，保存 panel/workspace 各自辅助模型及思考偏好；任务受理时固定模型配置引用与步数。旧 v1/v2 可读，旧应用不能读取 v3，因此回退必须保留数据并使用兼容版本。
- 子任务允许、拒绝、直接取消均恢复原父任务与已确认 dispatch，不创建新子任务或重复授权消费。
- RSS due-check 使用既有 Runtime worker 和订阅源绑定；feed collect 经过原 HostTool/Policy，管理员页面不能直接确认交付。完整来源 Evidence 联接与兴趣消费仍待装配验收。
- MCP 采用固定官方 SDK/filesystem 服务，默认关闭。接入 P6 可信工作区绑定，执行前后验证当前许可；配置变更、撤回和退出取消原任务并停止原服务。仅内容 hash/读取确认元数据可云导出。
- 固定参考 Skill 在 worker 层调用原工具端口。原任务与学习 checkpoint 可原子创建；恢复仅核验已确认的原 execution、输入、Policy、Evidence 和配置引用，再完成纯摘要步骤，不重试 MCP。
- Runtime 技术尾注仅在可信 Competition 来源下从正文投影分离；原 resultSummary 保留，验证身份在详情显示。

## 本次必要检查

- `mcp`、`skills`、Runtime 定向 TypeScript 编译通过。
- 原父子任务允许/拒绝/取消、对话偏好、启动 profile：新增 6 项通过。
- `node --test apps/runtime/test/reference-skill-application.test.mjs apps/desktop/test/result-text.test.mjs`：3/3，通过真实官方 stdio 与 SQLite/Policy 路径；零审批前读取、允许后读取 1 次、确认后中断恢复读取仍 1 次，原 Evidence 被保留。
- 共享 Desktop JS 语法及差异检查通过；新控件尚未做实际桌面渲染验收。
- 安装先尝试离线，因 `ENOTCACHED` 停止；随后官方 registry `--ignore-scripts --no-audit --no-fund` 成功，97 包。锁文件由 npm 生成，未运行安装脚本。

使用 Node 26.3/npm 11.16；未找到项目要求的 Node 24.15/npm 11.12，因此不能宣称匹配运行版本验收。没有重新运行全量检查、旧模块测试或真实模型。

## 尚未完成

知识库与记忆/学习正式 facade 已接到原生选择/确认及原任务端口；私人写入基于实际无应用副本 inventory 和删除维护，精确 previewSave 基线必需。PRIVATE 知识不进入云目录/结果，旧 ENV 默认知识路径及直接 execute/fake scope 已移除。公共事实删除使用原 FactHost 同源闭包，不打开第二数据库。

已许可本会话的固定 MCP 只读工具进入精确 routine 白名单；新增真实 stdio+SQLite case 1/1 通过，无重复审批，停用后零新增读取。无 routine 的审批/恢复 case 保留。

实际 Goal 验收入口 `tests/manual/cognition/p8-real-reviewed-goal.mjs` 已准备。使用既有 Electron 安全存储 profile 读取凭据，Runtime/graph/task 在新 `.cache/p5-real-reviewed-goal/<UUID>` 隔离目录，未输出凭据。初次 ESM ready 等待已修复并按 exe/command/starttime 收尾原隔离进程；独立新 profile 无法读取原安全存储后零云退出。受信 profile 配置随后实际可读，Laya 启动返回 `memory_insufficient`、ready false，stop 返回 stopped；同次 cloudCalls=0。此结果保存于该目录 `b5683f90-2d4f-4138-be67-0b1ca41ee880/result.json`。未降 2 GB 门槛、未关闭用户应用，未获得实际推理/Goal/CAS/云证据。

Skill 云端分派、私人记忆实际按任务消费、RSS 来源 Evidence 与知识写入未知结果最后释放仍在接线；真实 Goal/Laya/v16 云源/Policy/CAS、账户服务、原生桌面和恢复整体验收未完成。上述定向通过不等于 MVP 完成或产品发布。

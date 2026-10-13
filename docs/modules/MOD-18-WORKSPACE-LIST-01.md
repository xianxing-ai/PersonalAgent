# MOD-18-WORKSPACE-LIST-01：受限工作区目录枚举

<!-- current-design-20261009 -->
> 当前目标与协作规则（2026-10-09）：[完整设计](../design/resident-developer-agent-20261008/DESIGN.md) · [离线阅读/全部 SVG](../design/resident-developer-agent-20261008/index.html) · [两人确认与本机阅读门槛](../reviews/DESIGN_READING_GATE.md)。WSS 主通道、HTTPS 备用；Wiki 记忆由 goo122 接入。goo122 与 Potatos498 均确认后才可按授权合并，禁止强制合并/管理员绕过。设计不等于已实现；本文历史验收与作者记录保留，旧合并规则以当前门槛为准。

> 维护入口（2026-10-07）：项目主要负责人为 zemeng；当前分工以 [模块分工](../../docs/MODULE_ASSIGNMENTS.md) 为准，最新状态见 [ROADMAP](../../docs/ROADMAP.md)。历史日期、作者和验收结论按原记录保留。

目标 Profile：`huawei_ict_agentarts`

模块 / 需求：MOD-18 / PA-017、PA-023、PA-026

负责人 / 评审者：`zemeng` / `goo122`

状态：`review`（PR #83 已从 `main@1e3b56b6` 重建；旧 Draft #63 已关闭；生产 composition 未接）

拥有范围：`packages/coding-tools/**`、本文档

## 目标与公开入口

本工作包在 `workspace.read_text@1.0.0` 之上增加只读发现能力 `workspace.list_entries@1.0.0`，让模型在用户已授权、可信宿主绑定的根内发现可读源码名称，而不递归遍历、读取正文或暴露主机元数据。它复用 provisional `RegisteredTool`、`ToolContext`、`ToolHost` 与现有 Policy/ToolGateway scope 语义，不新增公共协议、Registry 或 Runtime 特例。

- 工具名 / 版本：`workspace.list_entries@1.0.0`
- 独立 scope：`workspace:list`；`workspace:read` 不隐含枚举授权。
- 创建 / 注册：`createWorkspaceListTool(options)`、`registerWorkspaceList(host, options): dispose`。
- 输入：`{path, limit?}`。只有 `path:'.'` 表示 trusted root；其他值必须是 canonical 相对子目录。默认 `limit=100`；宿主 `maxEntries` 可降低上限，模块硬上限为 1000。
- 输出：`{path, entries:[{name, kind:'file'|'directory'}], truncated}`。`truncated=true` 表示本次观察到的可公开直接子项超过 limit；结果自身复用 960 KiB 序列化门禁，超限 fail-closed，不截断成不诚实的完整结果。

输出不含绝对路径、正文、大小、权限、所有者、时间、inode、链接目标或敏感条目；不递归。输入与输出 Schema 均拒绝未知字段。

## 安全、资源与一致性边界

`rootPath` 只能由可信 composition 注入，不能来自模型、AgentArts proposal 或工具参数。工具先 canonicalize 根；请求目录在打开前完成相对路径、敏感路径、realpath containment 与“不得通过 symlink/junction/alias 遍历”检查。遍历结束后重新 realpath 请求路径并核对目录身份，检测到替换时 fail-closed。

枚举项只接受 `Dirent` 直接报告的普通文件或目录。symlink、junction、socket/device 等其他类型、不能由现有 canonical 相对路径规则寻址的名称，以及 `.env*`、凭据、私钥扩展、`.git`/`.ssh`/`.aws`/`.azure`/`.kube`/`.gnupg`/`.codex` 等默认敏感项都被省略；工具不对它们调用 realpath，也不计入 `truncated`。

实现使用 `opendir` 逐项迭代，而不是 `readdir` 整目录加载后切片。为保证返回的是全局稳定的前 N 个公开名称，扫描完整目录，同时只保留至多 `limit` 个按 JavaScript 字符串码元升序排列的候选；输出与内存为 O(limit)，扫描时间为 O(目录直接子项数)，并逐项检查取消与 deadline。达到 limit 后不会伪装完整，发现更多公开项即置 `truncated=true`。

实际目录枚举不是事务快照。读后 lstat/realpath/身份复核可以拒绝可检测的目录路径替换，但 Node `fs.Dir` 没有公开可供本实现 fstat 的目录句柄，不能消除恶意并发替换竞态；普通子项在扫描期间增加、删除、改名或改变类别时，结果也可能反映不同瞬间。因此结果只能作为本次有界发现，不是完整、持久或可重放的目录快照。

## 接口状态与依赖

- 基线：`main@1e3b56b665c116d0d0d26b624b566719a362088b`；PR #83 直接从该基线重建。旧 Draft #63 仅保留历史，不作为本 PR 的堆叠依赖。
- 本工具只消费当前 contracts 的 `RegisteredTool`、`ToolContext`、`ToolHost`，状态仍为 `provisional`。
- 不新增 ToolExecutionPort、ArtifactPort 或 EvidencePort，不接 Runtime capability list，不自动注册生产工具，不调用 AgentArts/Local 模型。
- 本工作包没有命令、patch、Git 写入、用户文件读取、云调用或真实账号副作用。

## 验收

定向测试仅在系统临时目录创建合成目录和文本，覆盖 5 个必要场景：

1. `path:'.'`、只返回直接子项、稳定排序、limit 与真实 `truncated`；
2. 父级逃逸拒绝，敏感项与 symlink/junction 省略，链接目录不能作为枚举目标；
3. 根目录语义、limit 上限和额外字段的严格 Schema；
4. 独立 scope、取消及扫描过程 deadline；
5. 复用现有 ToolHost 注册并由 disposer 精确释放。

最低验证命令：

```powershell
npm.cmd run build --workspace=@personal-agent/contracts
npm.cmd run build --workspace=@personal-agent/coding-tools
npm.cmd run typecheck --workspace=@personal-agent/coding-tools
node --test --test-isolation=none packages/coding-tools/test/workspace-list.test.mjs
git diff --check
```

不运行全仓 build/check，不启动 Electron 或长驻服务，不把合成测试表述为生产 Runtime、真实 AgentArts、Artifact/Evidence、完整 MOD-18 或 PA-017 已完成。

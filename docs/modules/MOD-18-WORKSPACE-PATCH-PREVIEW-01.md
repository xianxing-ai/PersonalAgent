# MOD-18-WORKSPACE-PATCH-PREVIEW-01：工作区文本 Patch 只读预览

<!-- current-design-20261009 -->
> 当前目标与协作规则（2026-10-09）：[完整设计](../design/resident-developer-agent-20261008/DESIGN.md) · [离线阅读/全部 SVG](../design/resident-developer-agent-20261008/index.html) · [两人确认与本机阅读门槛](../reviews/DESIGN_READING_GATE.md)。WSS 主通道、HTTPS 备用；Wiki 记忆由 goo122 接入。goo122 与 Potatos498 均确认后才可按授权合并，禁止强制合并/管理员绕过。设计不等于已实现；本文历史验收与作者记录保留，旧合并规则以当前门槛为准。

> 维护入口（2026-10-07）：项目主要负责人为 zemeng；当前分工以 [模块分工](../../docs/MODULE_ASSIGNMENTS.md) 为准，最新状态见 [ROADMAP](../../docs/ROADMAP.md)。历史日期、作者和验收结论按原记录保留。

目标 Profile：`huawei_ict_agentarts`

负责人 / 非作者评审者：`zemeng` / `goo122`

状态：`in_progress`；从旧本地实现 `9ca55a4` 的限定文件移植到
`origin/main@63703ae`，等待本工作包 PR 的非作者评审与集成。

拥有范围：`packages/coding-tools/**`、本文档；不修改 Runtime、contracts、根装配或锁文件。

## 交付

本工作包新增显式注册的 provisional 工具 `workspace.preview_text_patch@1.0.0`。可信宿主通过 `createWorkspacePatchPreviewTool(options)` 固定工作区根，或用 `registerWorkspacePatchPreview(host, options)` 接入现有 `ToolHost`。工具为 `sideEffect:'read'`，要求既有 `workspace:read` scope，不产生新授权。

输入固定为：

```json
{"path":"src/example.ts","expectedSha256":"<64 lowercase hex>","edits":[{"oldText":"before","newText":"after"}]}
```

- 只接受相对路径、1～32 条编辑和精确字段；路径、敏感文件、越界或指向敏感路径的 link/junction、UTF-8、二进制、字节上限、deadline 与取消全部复用 `workspace.read_text`。根内且目标不敏感的文件链接仍按 reader 规则处理，并非一概拒绝。
- 输入在首个 `await` 前复制为普通 own-data 结构；拒绝 getter、稀疏/超长数组、未知字段、重复 `oldText` 和超限序列化输入。
- 每条 `oldText` 按数组顺序在当前候选中定位，必须非空且精确出现一次；缺失、多处出现或前序编辑造成后续歧义都拒绝。
- `expectedSha256` 对读取到的精确 UTF-8 字节做并发前置检查。由于既有 reader 会剥离 UTF-8 BOM，无法精确重建原始字节的文本直接拒绝，不伪造 hash。
- 每个中间候选和最终候选都受 UTF-8 字节上限约束，拒绝二进制控制字符与无法稳定编码的孤立代理项；结果 JSON 继续受 960 KiB 模块预算限制。

输出仅为 `{path,beforeSha256,afterSha256,changed,previewText}`，不含绝对路径、授权引用或写入句柄。文件、目录和 Git 状态保持不变。

## 明确不在范围

- 不写文件，不实现 command、unified-diff parser、Git 操作或 `workspace:write`。
- SHA-256 只绑定本次读取；读取之后文件仍可能变化。本工具没有文件锁或 OS 原子 compare-and-swap，预览成功不是应用成功或可写承诺。
- 不自动加入 Runtime production tools，不把正文发往 AgentArts，不提供 Artifact/Evidence，也不把离线 Policy 验收称为 Competition 云端闭环。

## 验证

在系统临时目录的合成文件上完成；只移植本模块源码、测试和记录，旧分支的
`tests/integration/workspace-patch-preview-policy.test.mjs` 与 Competition Fake 接线
未纳入本工作包，也不把旧分支结果充作当前集成验收：

```powershell
node node_modules/typescript/bin/tsc -p packages/contracts/tsconfig.json
node node_modules/typescript/bin/tsc -p packages/coding-tools/tsconfig.json
node --test --test-isolation=none packages/coding-tools/test/workspace-patch-preview.test.mjs
git diff --cached --check
```

当前在 Node 24.15.0 下完成 contracts/coding-tools 构建，预览模块测试 5/5 通过，
`git diff --check` 通过。模块测试覆盖精确 hash、非 ASCII、输入快照、编辑唯一性与顺序、
BOM/UTF-8/控制字符、路径/敏感/越界 link、上限、scope、取消/deadline 和注册释放；
成功预览与关键失败路径核对原文件未变。没有在此分支重跑 Policy/ToolGateway 集成测试。
这些均为本地合成证据；生产装配、真实工作区和 AgentArts 仍未验证。

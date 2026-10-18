# MOD-09：私人来源控制器关闭生命周期

<!-- current-design-20261009 -->
> 当前协作规则（2026-10-17）：[接线交付总包](../competition/COLLABORATOR_WIRING_PACKAGE.md) · [模块分工](../MODULE_ASSIGNMENTS.md) · [当前设计](../design/CURRENT_DESIGN_20261015.md)。各 MOD 负责人自行闭环实现、公开契约、实际调用方接线、必要测试与 Evidence/文档。常规 PR 须由 zemeng5208、goo122、Potatos498 中任一非作者对当前提交有效批准；Owner zemeng5208 对具体 PR 的审核例外须在该 PR 明确记录，不伪称独立批准。拥有合并权限者（包括作者）可在最新必需技术 CI 通过、严格同步 main、无冲突且阻断意见已处理后合并；三位协作者跨 PR 均衡承担审查与合并，禁止强推、直接推 main 或绕过技术检查。下文历史正文、作者及验收按原日期保留，旧流程不作为现行门槛。

- Profile：`huawei_ict_agentarts`；需求 PA-020、PA-024；负责人 goo122。
- 工作树：`.worktrees/goo122-mod09-vault-lifecycle`；分支：`codex/goo122-mod09-vault-lifecycle`。
- 基线：`origin/main@4b5ec614663908dde938bd1f463203319f7c09d2`。
- 本包独立于已提交的 #304，已完成本地验收；提交及 PR 状态以 Git 为准，MOD-09 仍为 `in_progress`/`provisional`。

## 复现与修复

既有 `close()` 关闭数据库后仍保留 Vault，`search()` 没有关闭检查。
异步选择在关闭后仍能安装来源；已经开始的搜索也会继续返回私人引文。
三条合成来源回归在原实现上均报 `Missing expected rejection`。

- 关闭时释放 Vault 引用；新搜索明确拒绝关闭的控制器。
- 异步选择读回后、安装来源前检查关闭状态，不改变关闭后的配置版本。
- 搜索完成后、返回结果前再次检查关闭状态，拒绝已开始的搜索结果。
- 不声称中断已发生的系统文件读取；不新增取消协议、公开端口或配置项。

关闭检查位于原主进程控制器，不复制到 Renderer 或 Runtime。
未修改公共 Schema、数据库迁移、依赖、消费授权、写入确认、删除语义或云调用路径。
只读取合成临时 Vault，不保存真实私人记忆；关闭测试均验证没有创建私人数据库。

## 验证

- 根 `npm ci --ignore-scripts --no-audit --no-fund`、`npm run build` 通过。
- 原实现关闭回归 3/3 失败；修复后的三条回归及既有私人控制器、消费和删除路径 14/14 通过。
- `npm run typecheck --workspace=@personal-agent/desktop` 通过。
- `npm run test --workspace=@personal-agent/desktop`：455 项，453 通过、0 失败、2 跳过；`git diff --check` 通过。
- Node 24.15.0；全量测试沿用已校验的 .NET SDK 8.0.425/Runtime 8.0.31 缓存及工作树外独立 TEMP/TMP。
- 忽略的 `.cache/mod09-vault-lifecycle/` 保留构建、失败复现、定向及全量测试日志。

这些结果只证明合成来源的关闭门禁，不能替代真实用户逐条确认后的保存、更正、
重启、撤回、全版本删除或 AgentArts 消费。真实原生只读/取消证据仍以 #304 的记录为准。
本次没有真实模型/云账号操作，没有修改用户 Vault 或共享工作区。

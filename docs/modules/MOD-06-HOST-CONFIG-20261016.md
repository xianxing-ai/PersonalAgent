# MOD-06 / G14：加密宿主配置与会话恢复

- Profile：`huawei_ict_agentarts`；负责人 goo122；PA-005。
- 状态：`in_progress`，接口 `provisional`；本包不完成整个 MOD-06/G14。
- 基线：PR #370 `0ac50edc084b1ce040867b26c2ef6231b2044142`。
- 工作树：`.worktrees/goo122-mcp-config-20261016`；分支 `codex/goo122-mcp-config-20261016`。
- 方案：[ADR-0031](../adr/0031-remote-mcp-host-configuration.md)；[接口目录](../interfaces/CURRENT_INTERFACE_CATALOG.md)。

## 实现与兼容

新增受信主进程配置模块，复用 Electron safeStorage 的既有 provider 加密文件模式。配置字段严格校验，cipher wrapper version=1；全量加密、临时密文原子替换，失败保留旧状态。成功轮换更新 revision/secretRef 并撤销旧 host；revoke 先撤销内存再清除本机文件，失败报告 revoke_pending 和原文件保留，不保证服务端 token 撤销或取证级擦除。

加载产生新会话 nonce 纳入 configurationRef；重启不连接、不恢复旧授权。新增 host 装配通过受信原生确认回调决定是否连接，回调前后、取消/期限、断开与关闭均检查；默认拒绝。业务参数仍走原 bound envelope，工具由原 Runtime/Policy/ToolGateway 授权；无新任务/授权库，原 SQLite 执行记录和 Evidence 保留。配置变化后需重新装配工具和 Runtime。

无 Renderer 页面/IPC、wire/contracts Schema、数据库迁移或新增依赖。配置文件首次引入，不更改任何已发布迁移。未默认注入生产 main；native confirm UI 仍由下一工作包实现，不把回调接口当作已交付原生管理页面。

## 已执行验证

- 构建工作区依赖通过。
- `node --test apps/desktop/test/remote-mcp-config.test.mjs tests/integration/remote-mcp-host-runtime.test.mjs`：8/8。配置单测使用显式 Fake safeStorage；MCP 为真实 loopback HTTP + synthetic 服务/token，Runtime 为实际 SQLite，模型/AgentArts 不参与。
- 验证保存无明文/无隐式许可、失败保存保留旧状态、损坏/不可解密记录保留、轮换/撤销、失败清理明确报告、延迟确认的拒绝/变更/取消/超时/断开/关闭均零远端请求。
- Competition Runtime：原单次审批前零工具调用，批准后只读调用 1 次，原执行记录 confirmed / Policy allow / executionStarted，Evidence conditional；重复命令和重启读回不重放。新会话旧 envelope 拒绝，旧待审批任务不能执行；重新提交并批准新任务才调用。
- 完整 `npm run check`：退出 0；37 个汇总块、3199 项，3163 通过、36 跳过、0 失败、0 取消。架构/生成类型/类型检查、工作区与根集成通过；原 stdio 回归通过。跳过范围为本机 helper、平台/权限、真实服务 opt-in 和既有跳过，未放宽断言。
- `npm run test:remote-mcp-storage-smoke --workspace=@personal-agent/desktop`：真实 Windows Electron 44.2.0、两个不同 OS 进程，safeStorage 加密/跨进程解密通过，恢复断开、新会话引用、撤销删除密文均通过。使用独立项目缓存与合成 token，无窗口、真实账号或模型调用。
- 初次双进程探针用 `app.exit()` 强制终止，未落盘 Chromium 加密状态，后进程恢复失败；改为正常 `app.quit()` 后通过，原失败/成功回执保留。恢复失败不清库、不回退 Fake，原文件保留。
- 既有 `test:runtime-application-smoke` 默认 Competition 启动停在旧 Local 的 `#model-add`；未改产品或放宽断言。显式 `PA_RUNTIME_PROFILE=local` 后原窗口回归通过，7 次本机模型 fixture 请求、2 次取消；只作为 Local 旧链路回归，不作 Competition Golden Path 证据。
- 实际真实模型/AgentArts 调用 0；无 Vault/用户记忆访问。

证据为工作树忽略日志 `.cache-check.log`、`.cache-mcp-config-targeted.log`、`.cache-mcp-two-process-storage-final.log`、`.cache-runtime-application-smoke.log`、`.cache-runtime-local-smoke.log`；实际双进程回执 `.cache/remote-mcp-secure-storage/case-dTy3gg/receipt.json`。公开复现入口为新增 Desktop smoke script，后续运行的 case 名不同。

## 未完成与交付

原生配置/连接管理页面、生产 main 装配、真实 endpoint、OAuth、跨进程并发配置写入及完整未知副作用恢复未交付。配置保存成功不等于连接或工具授权；不承诺首次密钥状态未落盘的强制终止恢复。撤销文件清理失败时保留原文件并报告未完成，下一进程仍默认断开且旧许可失配。

用户已授权本包提交、普通推送并创建基于 #370 分支的独立 PR。提交、PR 与 CI 状态以远端当前提交为准；非作者评审和集成仍待真实完成，完整模块不提升 done。

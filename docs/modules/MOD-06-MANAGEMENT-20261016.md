# MOD-06 / G14：原生管理与生产装配

- Profile：`huawei_ict_agentarts`；PA-005；负责人 goo122；拟非作者审查 Potatos498。
- 状态：`in_progress`；接口 `provisional`；不完成整个 MOD-06/G14。
- 基线：PR #371 `49c2854d51aa2a479dc1f0fcb4a2ead21e92672b`。
- 工作树：`.worktrees/goo122-mcp-management-20261016`；分支 `codex/goo122-mcp-management-20261016`。
- 方案：[ADR-0031 增量](../adr/0031-remote-mcp-host-configuration.md)；[使用说明](../../apps/desktop/README.md)。

## 行为与边界

Competition 主进程启动时创建单个配置/host，由已保存固定定义注册 `mcp.remote.*` 工具；不加入 automaticTools、Competition 云目录或结果导出，不启动第二个 Runtime。无配置时不注册远程工具。未初始化原 Runtime 时仍可管理加密配置，试调用明确拒绝。

普通后台只有打开管理窗口的操作和布尔状态；限定 admin 主 frame、无 payload。独立管理窗口使用 sandbox/contextIsolation、内存 partition、禁导航/新窗口/权限、无网络 CSP、专用 Preload/IPC，逐次核对原窗口主 frame。定义通过原生文件选择读入，大小受限、禁止内嵌凭据或未知顶层字段；限定远程命名空间避免覆盖固定工具或继承已有 automaticTools。新命名限制会将旧的非远程命名配置置为不可用，原密文保留。

token 只在独立窗口临时输入，提交后清空字段，主进程加密保存；无日志/快照/普通 Renderer 持久状态回传。保存/连接分别原生确认。保存取消、关闭窗口或并发撤销不能使迟到保存恢复配置；连接取消/窗口关闭不能使迟到确认联网。保存/轮换即废止旧 host，必须正常退出并重启装配新的 Schema/绑定，禁止热更新旧任务。

管理试调用复用 `submitHostToolTask`，Runtime 创建原任务、单次审批和持久 `host-tool-intent`。原生确认核对工具/业务参数、当前绑定和审批 revision，原 `authorization.respond` 执行审批；结果由 `readHostToolTask` 读回，原执行/Evidence 保留。管理窗口只读回带本包可信 checkpoint 的任务，不接受其他宿主任务或调用方自报结果。外部字符串只用 textContent 展示。

撤销立即废止内存凭据并尝试删除原配置；失败明确 `revoke_pending`，保留文件，不声称服务端 token 已撤销。应用正常退出先关闭管理窗口、释放 host、清除内存引用，再沿原 Runtime 生命周期关闭。等待审批任务不重放；新会话不能批准旧 envelope 执行。

无 wire/contracts Schema、数据库迁移、新依赖或锁文件变化。新增本地管理 IPC 不作为 Runtime wire capability，不提高 Core Runtime Profile 1 冻结集合。

## 已执行验证

- 工作树按锁文件独立安装、构建通过。首次定向运行早于 Runtime dist 生成，出现 `ERR_MODULE_NOT_FOUND`；构建完成后重跑。
- 定向 `node --test apps/desktop/test/remote-mcp-management.test.mjs apps/desktop/test/remote-mcp-config.test.mjs tests/integration/remote-mcp-host-runtime.test.mjs`：12/12。配置测试使用显式 Fake safeStorage，Runtime/SQLite 和本机 HTTP listener 为实际实现。
- 覆盖错误窗口/子 frame/未知 IPC、密钥不回传、夹带凭据/覆盖既有工具名拒绝、取消保存/关闭/撤销竞争、延迟连接关闭零网络、原审批 revision、断开后拒绝批准、确认后一次执行与 Evidence、其他宿主任务拒绝读回、撤销后拒绝调用。
- 标准 `npm run test:smoke --workspace=@personal-agent/desktop` 通过：Fake Runtime 窗口、Preload 隔离、提交/取消、悬浮/拖拽/托盘与独立后台关闭均保持原断言。
- 首轮完整 check 发现退出回调的旧 VM Fake 未声明新增 `remoteMcpHost`，8 条原退出测试出现 `ReferenceError`。补齐显式可选宿主和关闭状态，保留所有原断言；新增活动任务先拒绝退出、MCP 释放后才关 Runtime、释放失败不自动重试的测试。包含 `quit-task-preflight.test.mjs` 的最终定向回归 25/25，首次完整失败日志保留，随后重跑完整门禁。
- `npm run test:remote-mcp-product-smoke --workspace=@personal-agent/desktop`：实际 Windows Electron 44.2.0、产品 main/Preload/管理窗口、safeStorage 和 SQLite。两次进程重启；批准前工具调用 0，批准后 1；原结果读回不重放，新会话旧审批拒绝，撤销删除密文，普通后台/ORB 越权拒绝。实际截图已检查，外部 HTML 字符串不执行。
- 原生对话框的响应使用显式合成适配；测试专用入口只将固定 HTTPS 合成地址映射到真实 loopback HTTP fixture，拒绝其他 fetch。非 MCP fetch 尝试 0；真实模型/AgentArts 调用 0，无 Vault/用户记忆访问。此证据不代表真实远程 TLS/OAuth、真人确认或云端工具编排。
- 完整 `npm run check`：最终退出 0，37 个汇总块，3205 项，3174 通过、31 跳过、0 失败、0 取消；架构、生成类型、类型检查和工作区/根集成通过。未修改任何跳过条件或放宽断言。
- 相比 #371 的 36 跳过，本机本轮构建出了 WindowsJobProcessHost，原来跳过的 5 项进程树/超时/输出测试实际执行通过；其余 31 项仍属未提供 helper、符号链接/POSIX 平台、真实服务 opt-in 及既有跳过。

证据：工作树忽略日志 `.cache-mcp-management-targeted-with-quit.log`、`.cache-mcp-product-smoke-final.log`、`.cache-desktop-smoke.log`、`.cache-check.log`（首轮失败）、`.cache-check-final.log`（最终门禁），最终产品截图 `.cache/remote-mcp-product/case-NKk7nA/management.png`。公开复现入口为 Desktop 新增 product smoke script；case 名随每次运行变化。最终产品烟测另验证 Runtime 未配置时仍可保存加密配置、试调用保持禁用；真实模型/AgentArts 调用仍为 0。

## 未完成与交付

真实远程 HTTPS/MCP 服务、OAuth、服务端 token 撤销、任意服务/写工具、云端目录和结果出口、真人确认、跨进程配置并发写与首次系统加密状态未落盘时的强制退出恢复未验收。本界面是固定单个已审查只读定义的管理入口，不是通用市场或任意工具自动授权。

用户已授权本包提交、普通推送并创建基于 #371 分支的独立 PR。提交、PR 与 CI 状态以远端当前提交为准；非作者评审与集成待真实完成，完整模块不提升 done。

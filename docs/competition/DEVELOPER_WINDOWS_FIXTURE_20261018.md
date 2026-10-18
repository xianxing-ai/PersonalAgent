# Developer deployment Windows fixture 修正（Local / Synthetic）

基线：#406 `2e45faa5885ed5370eaa654aa0802f79f7c69450`。本增量只修改 `apps/desktop/test/developer-deployment-config.test.mjs` 与交接/证据文档，不修改生产 deployment adapter、main、公开 Provider 或权限检查。

原 fixture 使用没有 `.exe` 后缀的 POSIX shebang synthetic-gh，且未注入 Windows 私有文件 ACL 检查；生产 adapter 在 Windows 要求真实 `.exe` 和严格 ACL callback，因此原 fixture 无法代表 Foundation 的 Windows 运行环境。修正不放宽生产要求。

## 平台分支与保留的检查

- Linux 默认仍由原 deployment adapter 构造原 `GhCliProvider + SpawnGhCommandRunner`，直接启动原 shebang synthetic-gh。测试脚本额外核对精确原 gh 参数、`GH_TOKEN`、固定 `GH_HOST` 及 ambient secret / `GH_CONFIG_DIR` 未继承。
- Windows 的配置 executable 使用 canonical `process.execPath`（真实 Node.exe），生产 adapter 仍绑定其文件身份、原 config/token 身份及撤销行为。通过既有公开 `createHost` factory 注入**明确 Synthetic 的 provider transport**：原公开 `GhCliProvider` 生成 gh 参数，受限 wrapper 委托原公开 `SpawnGhCommandRunner` 启动该 Node.exe 和固定 `.cjs` fixture，脚本验证原参数和环境。这不是实际 gh.exe、真实 GitHub 或账号验收。
- 替身读取 token 使用 factory 原 `options.git.options.getCredentials(scope)`，继续经过原 deployment 的 `assertCurrent`、有界私有文件读取与 token digest 检查，不自读 ambient 凭据，不用固定 token 跳过撤销。原 availability/export/workflow 配置全部保留。宿主关闭同时释放替身与原已构造 provider。
- Windows 私有 ACL 仅由明确的 Synthetic allowlist callback 模拟。撤销 case 显式撤回该 allowlist，不依赖 Windows 上 `chmod(0644)` 的 POSIX 语义。Linux 仍实际验证 POSIX 权限撤销。
- token symlink case 若当前主机返回 `EPERM` / `EACCES` / `ENOTSUP`，明确 skip 并标记此主机未验证链接拒绝；其它异常仍失败，不把权限不足写成通过。

另一个强制 Synthetic Node transport 的小场景可在 Linux 运行，验证公开 runner 实际 spawn、原凭据撤销与双 provider 释放；它不模拟 `process.platform`，也不冒充 Windows ACL 检查已执行。

## 本次证据与限制

独立 worktree `.worktrees/voice-windows-fixture-20261018`，独立 `node_modules`；使用 Node `24.15.0`、npm `11.12.1`，`npm ci --ignore-scripts --no-audit --no-fund` 与依赖构建通过。仅运行：

```sh
node --test apps/desktop/test/developer-deployment-config.test.mjs
```

Linux Local/Synthetic：**23/23 通过，0 失败、0 跳过**，报告耗时 `1993.502896ms`。包含原 Linux adapter/provider spawn 路径与显式 Node transport、原 Runtime/ToolGateway/Evidence 的仓库上下文读取、出机/配置撤销等原有定向场景。

原始日志位于忽略缓存 `.cache/wiring-20261018/voice/windows-fixture-test.log`，冻结清单为同目录 `windows-fixture-freeze.json`。此次没有运行 Windows CI、真实 Windows ACL、真实 gh.exe/GitHub/账号、云模型、音频、Laya 或全仓测试；Windows 平台通过与否以实际 Foundation 日志为准。Live 后台结果端口仍只是另附的 [交接提案](LIVE_BACKGROUND_RESULT_HANDOFF_20261018.md)，没有因本 fixture 修正而实现或注册。

# F21 原参考能力接线

目标 Competition。固定已锁定 filesystem MCP `2026.8.31` / SDK `1.31.0` 与原 reference-summary Skill；不安装浮动依赖、不执行第三方 Skill 脚本。

原 workspace 许可/manifest/安装入口与 probe 哈希绑定到同一图。固定公开 sample 在独立目录，由原 PSEC 命令执行 initialize/tools-list/read_text 与 OS 读写拒绝检查；stdout 仅协议观察，隔离/终止必须再由原 native audit 证明。未知原操作只读，不换 run 重跑。启用仍需独立原生精确确认，之后业务工具仍独立 Policy。

复用 Runtime/原 command host/MCP/Skill 注册，没有新任务库、调度或授权层。新增只读安装/配置口 provisional，现有直接 UI 启停默认行为兼容。旧未绑定安装/探针证据不能自动迁移为已验证。

真实本机检查：`PA_TEST_JOB_HOST_EXE=<已核验原自包含 helper> node --test packages/mcp/test/f21-native-probe.test.mjs`，1/1 通过。重新核对的 helper SHA256 `2be82f75176a7ea6a11236d837317501415d38caeee4329c32e2460a219b4ca7` / 191 companion pins；固定 probe SHA256 `472b636385c442c04ead421948e60439e14075080752ad76435e9c43d27d9975`。原 native receipt 为 `windows-psec/enforced=true/executionStarted=true/stopped=true/exited/exitCode=0`；真实协议 `2025-11-25`，固定 read_text_file 返回一个公共样本，实际越界读与样本目录写入均被 OS 拒绝。初测 Node 默认入口 realpath 被拒后，采用仓库既有固定 `--preserve-symlinks --preserve-symlinks-main` 参数修正父/子 Node，没有扩大根目录权限。

MCP/Runtime 构建、架构 3/3 通过。`node --test apps/desktop/test/f21-workflow-worker.test.mjs` 1/1 通过：五节点全链、精确原生启用决定、未知探测后 SQLite 重开及新图零重放。该项使用真实 Engine/Runtime/Policy/SQLite/AuthorizationIntent，模型、原生点击、参考连接与 native 执行为显式 Fixture；与上述真实本机协议检查分开。真实 AgentArts 固定部署整图、真人启用确认与第三方 Skill/MCP 能力未验证，不提升 F21 完成或 frozen。

Main 注入：`createConfiguredDesktopF21WorkflowPorts({runtimeModule,mcpModule,codingModule,getApplication,getReferenceHost,nativeExecutionHost,getAuthorizationIntentHost,probeRoot,authorizeExport})` 返回 `tools/configuredWorkflowWorkerPorts/unavailable`；原 worker `workflow.skills.enable_reference@1.0.0` 仅接受 `{capability:'workspace-reference'}`。`probeRoot` 为专用公共样本目录，命令只允许原只读 profile。已注册但关闭的 MCP 由原注册表核对，不要求先启用才进入图。原生确认绑定原图、原 probe 审计与当前 manifest/配置；正文读取和出机仍独立授权。

# MOD-33 失败日志读回与 goo122 接续验收

<!-- current-design-20261009 -->
> 当前目标与协作规则（2026-10-09）：[完整设计](../design/resident-developer-agent-20261008/DESIGN.md) · [离线阅读/全部 SVG](../design/resident-developer-agent-20261008/index.html) · [两人确认与本机阅读门槛](../reviews/DESIGN_READING_GATE.md)。WSS 主通道、HTTPS 备用；Wiki 记忆由 goo122 接入。goo122 与 Potatos498 均确认后才可按授权合并，禁止强制合并/管理员绕过。设计不等于已实现；本文历史验收与作者记录保留，旧合并规则以当前门槛为准。

- 负责人：goo122；基线 main `4b5ec614663908dde938bd1f463203319f7c09d2`。
- 工作树：`.worktrees/goo122-dev-workflows-acceptance`；分支 `codex/goo122-dev-workflows-acceptance`。
- 范围：既有 Local DEV-WORKFLOWS 的 MOD-33 修复及 MOD-36 回归，不新增 Local Agent 能力，不计入 Competition 验收。
- 接口仍为 provisional；无 Schema、公共类型、迁移、依赖、锁文件或授权变更。

## 失败复现与最小修复

README 已记录不兼容 CLI 可能成功退出但返回空失败日志。生产 Provider 原先直接把它
分页为 `text='' / nextOffset=null / truncated=false`，无法区分日志不可读与完整读回。
新增空文本、纯空白两条负例在原实现均因 `Missing expected rejection` 失败；成功 job
的空失败日志与非空日志的末尾空页正例通过。父 subtest 汇总为 1 通过、3 失败。

现在只对远端 job 的 `conclusion=failure` 且原始全文为空/纯空白时拒绝，沿现有脱敏
边界返回 `EXTERNAL_FAILURE / GitHub operation failed`。不重试、不更换 CLI、不读取
其他 job，也不拿部分内容代替完整日志。先检查原始全文再分页，末尾合法空页不受影响。

## 本机验证

- Windows、Node 24.15.0、npm 11.12.1；锁定依赖安装和根 build 成功。
- MOD-33 全部模块测试及 MOD-36 `code-review.test.mjs` 共 139/139，零失败、零跳过。
  模型、评论及异常传输均为显式 Fake；这些结果不证明真实 COMMENT 或模型可用。
- 公共消费门禁 `npm run check` 退出 0：31 个 workspace/根测试汇总 2145 项，2116 通过、
  0 失败、29 跳过；其中 Runtime 351/351、根集成 22/22。架构、生成类型与类型检查通过。
  运行使用此前已校验的缓存 .NET 8 SDK，以及工作树外 TEMP/TMP，不将默认 TEMP 兼容问题记为已修复。
- 29 项跳过包括 4 项未编译 Job helper、11 项缺少 PowerShell 7 helper、2 项链接权限、
  11 项未启用的真实服务测试和 1 项 knowledge controls UI 测试；不将这些计为验收通过。
- `npm run dev`、`npm run demo:protocol`、`npm run demo:runtime` 均退出 0；演示使用既有
  storage-only/Fake 路径，不代表真实模型、工具或 Electron 交互已验证。

## Windows 生产 Provider 的真实只读回执

使用现有 gh 2.97.0、公开 `GhCliProvider / SpawnGhCommandRunner`，仓库 allowlist 固定
为 `zemeng5208/PersonalAgent`。凭据仅在内存中使用；受信命令端口只接受 GET 和失败
日志读取。没有读取私人 Vault、发送模型请求或 GitHub 写入。

- run `37474438969` / job `112306058042`；repo 元数据及六页失败日志实际读回。
- offset 连续、最终 `nextOffset=null`，348224 个 UTF-16 字符。
- 脱敏全文 SHA256：`334b89ed82dc50fd73546b104ce4d760e2ca1c526ada1f6c565e4696245a253d`。
- 已知 TIMEOUT/EXTERNAL_FAILURE 标记存在；13 条只读命令，写入 0、模型调用 0。
- 脱敏收据留在忽略的 `.cache/dev-workflows-acceptance/`，不提交正文或凭据。

该结果只证明所测 CLI/来源的只读路径，不声明最低兼容版本、修复原 Calendar 失败、
真实 Policy/Runtime 审批消费、真实写入或 AgentArts 验收完成。

## #298 共享 CI 兼容检查与记忆继续入口

静态检查 #298 的准确 head `7480feb1719aed04a7f4a59dfc24854fd45b8aa0`：复用现有构建
脚本和 `PA_TEST_JOB_HOST_EXE`，产物置于 RUNNER_TEMP；SDK/构建失败明确报错。测试在
所有路径取消、观察终态并等待收尾，保留原期限、PID/进程存活、CANCELLED/ESRCH 和输出断言。
实际读取 run `37566677214` 原日志，四项 WindowsJobProcessHost 测试均标为通过而非跳过。
当前两项 Foundation 成功，静态兼容检查未发现阻断项；本轮未代作者改代码、批准或合并。
这不证明 UIA、默认 TEMP 现场、账号写入或 #291 的完整自动收尾。

2026-10-07 按更新后的 Computer Use 技能重置并初始化原生工具，仍报
`windows sandbox failed: helper_unknown_error: setup refresh had errors`，没有窗口输入。
MOD-09 已合并增量保留；真实来源具体摘要确认、持久生命周期、原生交互及完整私人消费仍待验收。
MOD-33/36/09 均不因本工作包转为 done；MOD-37 本轮未启动。

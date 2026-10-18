# Desktop 开发工具显式部署配置

目标 `huawei_ict_agentarts`；zemeng 主进程配置适配，复用 MOD-33/34/35/36/38 已有公开 Provider、工具和工作流，不改变其原负责人。实现为 `apps/desktop/electron/developer-deployment-config.js`；不包含 Electron、第二 Runtime、第二模型 Provider 或环境账号回退。

## 主进程调用

```js
const deployment = await createDesktopDeveloperDeployment({
  configPath: trustedExplicitAbsoluteConfigPath, // 未配置时省略，不自动搜索
  workspace: codingWorkspace.readDeveloperConfiguration(),
  cacheRootPath: trustedParserCacheOutsideWorkspace,
  readModelGateway: (modelId, configurationRef) => modelApiHost.getModelGateway(modelId, configurationRef),
  available: ({capability, taskId, deadline, signal}) => trustedOriginalTaskScopeIsCurrent({capability, taskId, deadline, signal}),
  confirmExport: ({taskId, kind, payload, deadline, signal}) => confirmExactPayloadInTrustedHost({taskId, kind, payload, deadline, signal}),
  assertPrivateFile: file => { verifyWindowsRecoveryAcl(file, fixedPowerShell7Path); return true; },
});
```

以上函数名中 `trustedOriginalTaskScopeIsCurrent` 和 `confirmExactPayloadInTrustedHost` 表示主进程必须提供的既有任务归属检查和原生确认 UI，不是此适配器新增的服务。`confirmExport` 只有严格返回 `true` 才同意；展示当前精确内容后由用户决定，不可直接恒真。配置路径、factory 和这些回调均为可信主进程输入，不从 Renderer 或工具参数接收。

返回 `{host,snapshot,prepareExport,close}`。将 `host.tools`、`competitionToolAvailability`、`competitionToolExports` 和 `runtimeOptions` 接入原 Runtime，创建后 `host.bind(originalApplication)`；把 `prepareExport` 串接原 `prepareCompetitionToolExport`。它只处理本宿主的已注册工具。`close` 撤销配置/出机许可并释放原宿主。修复 CI 仍依赖原补丁 preview/apply、`workspacePatchReconciliation` 与 namespace，不能仅配置 GitHub 就宣称整链可用。

没有 GitHub 配置时，仍保留所选原工作区的固定 command 与空根目录的安全日志 parser；GitHub、Git、工作流保持明确 `unavailable`。没有工作区时，只能由 `available` 对真实原任务范围明确放行安全 parser，默认拒绝；parser 不读取源码。配置路径已提供但无效时固定脱敏拒绝，不静默使用另一账号或假 Provider。

## 配置形状

配置与 token 文件置于所选源码根之外，使用主进程明确选择的绝对 canonical 路径。以下全部是示例值，token 文件只存一项私有 token，JSON 不存凭据：

```json
{
  "version": 1,
  "repository": "example/project",
  "workspaceRoot": "/selected/project",
  "github": {
    "executable": "/trusted/bin/gh",
    "tokenFile": "/private/credentials/github-token"
  },
  "git": {
    "sourceBranch": "codex/developer-task",
    "remoteName": "origin",
    "remoteUrl": "https://github.com/example/project.git",
    "allowedPaths": ["src/example.js"],
    "authorName": "Project Developer",
    "authorEmail": "developer@example.invalid"
  },
  "workflows": {
    "bindingId": "reviewed-project-config-v1",
    "modelId": "configured-model-id",
    "configurationRef": "original-model-config-ref",
    "maxSteps": 12,
    "maxTokens": 4000,
    "reviewRules": [{"id": "scope", "text": "Review only the requested change and supplied diff."}],
    "issueTriage": {"labels": ["bug", "documentation"], "minConfidence": 0.85},
    "ciFix": {"verifyRecipeId": "node-check", "baseBranch": "main", "maxAttempts": 2, "maxLogBytes": 65536}
  }
}
```

`workflows` 可省略；模型相关工作流需要显式 modelId/configurationRef、原 Gateway getter、规则及精确出机确认。列表工作流也需要明确结果投影确认。CI recipe 必须存在于当前所选工作区的原 `recipeIds`；sourcePaths 固定为 allowedPaths，headBranch 固定为 sourceBranch。未知配置字段拒绝。Git remote 只接受同一 repository 的 credential-free `https://github.com/...` URL；不支持其他服务或账户自动发现。

GitHub runner 只使用配置的绝对 executable 与私有 token，不继承 GH_TOKEN、GH_CONFIG_DIR、PATH 或已登录 `gh` 账号。可选 `github.environment` 只允许显式 `SystemRoot`、`TEMP`、`TMP` 三项绝对目录，供 Windows 必要运行环境使用。POSIX binary 需可执行且不可由 group/other 写入；Windows binary 需 `.exe`。沿用公开 GitTools 的 Git 进程策略，不添加 shell 命令入口。

配置/token 必须为 canonical 普通单链接文件。POSIX 要求当前 owner 且 group/other 无任何权限（例如 `chmod 600`）。Windows 必须由 `assertPrivateFile` 实际检查受保护 ACL 并返回 `true`；现有 `verifyWindowsRecoveryAcl` 成功返回 `void`，所以需要示例中的包装。此轮未运行 Windows ACL 真机验证。配置、token、gh binary 必须在所选源码根之外；源码 allowlist 只接受根内实际普通文件，拒绝链接、逃逸、`.git`、`node_modules`、`.env` 与凭据/秘密文件。工作区、配置内容、凭据或 binary 身份改变后原 lease 失效，应重新显式装配。

Windows ACL 校验在初装与实际读取私有文件时执行；目录 availability 只读取已绑定文件身份、mtime/ctime/size 与原工作区范围，不为每个工具重复启动 PowerShell，也不据此宣称凭据已通过实际使用校验。真正读取 token 前后仍检查私有 ACL、内容摘要与原文件身份。

## 出机与运行边界

每个原 task/proposal 的参数元数据先经 `developer_tool_metadata` 确认；实际工具结果另经 `developer_tool_result` 确认。模型请求的完整 messages/tools 经 `developer_model_request` 确认；工作流结果经 `developer_workflow_result` 确认。许可绑定 task、proposal、参数与结果摘要，不能用于替换输入或另一个结果。单次 JSON 出机载荷上限 512 KiB，超限拒绝而不截断；已知当前 token、常见 GitHub token/Bearer 凭据不得出机。来源内容仍是不可信数据，不成为新权限。

未提供确认回调时不发布这些工具的 Competition export，模型相关 egress 保持不可用；注册不代表已授权、实际执行或可出机。回调等待贯穿原 signal/deadline，拒绝或取消不生成 permit。出机许可只属于当前宿主生命期，重启不自动恢复；已执行但尚未获准输出的动作沿原 Runtime 待核实处理，不自动再执行。

## 本轮 Local / Synthetic 定向证据

`node --test apps/desktop/test/developer-deployment-config.test.mjs`：19/19 通过。实际公开 `GhCliProvider + SpawnGhCommandRunner` 执行显式 synthetic gh 子进程，验证私有 token 注入、零环境账号继承、仓库白名单及脱敏；另验证原固定 command/安全 parser 保留、无 workspace 的任务范围、模型原 Gateway 注入、精确许可/digest、拒绝与取消、错路径/branch/remote/宽权限/symlink/未知 token 字段，以及配置/凭据变化失效。

隔离 fence 验证使用测试专用 `PA_SYNTHETIC_DEVELOPER_HOST_MODULE` 指向另一工作树未改动的公开 factory；集成后默认使用同目录 factory。该变量只存在于测试，不是产品 Provider 配置。未执行真实 GitHub/账号写入、付费模型、云、Laya 或全仓测试；不据此宣称 CI 修复/Review/Issue 全业务实机验收完成。原始日志与冻结清单位于根忽略缓存 `.cache/wiring-20261018/voice/deployment-*`。

最终定向运行 UTC `2026-10-18T21:31:53.530551+00:00`～`21:31:54.302981+00:00`，wall `0.772s`，exit `0`。日志 SHA256：`032a27779ade35ff940012af8c64c24a5d8ed6f985dd11ae7c694cbab993b9bc`。实际公开 factory 源码 SHA256：`cbaf476f467564a4520e52bc3e911b24e855f7b9707d47c10fe041a4e3f879f7`。

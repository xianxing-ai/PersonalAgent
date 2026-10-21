# 原对话卡至实际 Windows 原生执行整链（2026-10-21）

在干净集成提交 `e3105aa05813b37ec6becc4b0b12b6d1f8916477`，Node 24.15.0，以普通用户执行 `apps/desktop/test/authorization-native-execution.integration.test.mjs`：**1 pass / 0 fail / 0 skip**。测试源码来自 `29dc221b4d407996dc664fca4a8d362b2ccdef58`，已经正常合入该集成提交；本次没有安装依赖、编译 helper、重跑原 7 项 native focused 负例或启动模型/账号。

## 实际生产组合

测试使用真实 `createRuntimeApplication`、TaskRuntime、Policy、ToolGateway、`AuthorizationQuestions`、Desktop question host、`createDesktopNativeExecutionHost` 和 coding-tools command adapter。Synthetic 仅限卡片用户决定与本测试自有工作区/固定 Node recipe；没有 Fake Gateway、替身 executor、子进程自报 enforced 或绕过 Policy 的授权。

实际消费顺序：

1. 原 `submitHostToolTask` 冻结 recipeId、task/run/参数摘要；生产 native host 使用可信完整 helper bundle 做当前必要 readiness，然后原卡同时列出 tool/native-execution requirements。此时业务 marker 不存在，Policy grant 和业务 native audit 均不存在。
2. Synthetic 用户在原 questionId/revision 回答一次 allow；Runtime 正常消费 Policy，PSEC 对原固定 Node recipe 执行一次。真实 marker 读回仅一个 `x`，原 run 为 confirmed，工具返回 exitCode 0。宿主审计 backend=windows-psec、enforced=true、executionStarted=true、stopped=true；Policy 使用次数为 0。
3. 重复原问题回答明确拒绝；相同 command 重放仅读回原结果，不重新运行。相同身份下替换 recipe 参数被拒，第二 marker 从未产生，使用次数没有补回。
4. 生产 configuration 不可用后另一次提交失败，没有新问题/业务 native audit，也没有普通 spawn 降级。原生 factory 向实际空 env 调用方注入最小 SystemRoot/LOCALAPPDATA；测试没有单独补 env 来掩盖生产差异。

已有实际 helper 的 apphost 与 DLL/deps/runtimeconfig 完整 hash 在[安全回执](AUTHORIZATION_NATIVE_INTEGRATION_20261021.receipt.json)。原生通用审计仍准确保留 `sideEffects: possible`；测试只用自有 marker 的宿主读回证实本条合成写入一次，不把所有外部副作用提升成 verified。

## 复现与证据

显式选择已由宿主准备且完整 pin 的 helper；普通用户下设置 `PA_TEST_JOB_HOST_EXE`，并用 `PA_TEST_NATIVE_SANDBOX_REQUIRED=1` 保证后端缺失时失败而不跳过：

```powershell
node --test --test-concurrency=1 --test-reporter=spec apps/desktop/test/authorization-native-execution.integration.test.mjs
```

本次在集成树本轮已经构建的依赖上运行。`apps/runtime/src`、`packages/coding-tools/src`、Policy 与 ToolGateway 源码在 `fe0149c6` 到实测 `e3105aa0` 没有差异；后续 Main factory 的 JS 环境接线是实际测试加载的 e310 版本。本测试专属 TEMP/TMP 为仓库外临时目录，业务 workspace/readiness/SQLite/日志为本任务的 ignored cache。日志 SHA256：`e2d630cfd9d4d64a5730498497bc47dea33fb2422766b268c4e4f355cc0a1471`。

## 边界

这是实际本机 OS 与生产执行组合证据。它没有点击真实 Electron 卡、调用真实 AgentArts/模型、公开网络或用户资料，也不重复声称所有 git/npm recipe 可运行。PSEC readiness 自带固定自有文件/loopback 诊断，不执行待批准的业务 recipe。没有 helper 的默认 CI 可明确 skip 此环境型测试；本次 REQUIRED=1 实际运行没有 skip。界面、其他权限类别及云端验收由统一 PR 的独立结果记录。

## Hosted 夹具输入与失败诊断修正

WindowsServer2025 / 10.0.26100 的实际旧 CI 日志中，baseline/readOnly/workspaceWrite/cancel 全为 `invalid-or-unavailable-trusted-configuration`，连普通用户 full-access baseline 都未启动；whole-chain 随后只等卡而产生 30 秒泛 timeout。该日志不能证明 OS 缺 PSEC。TEMP 中的短名/别名与生产严格 canonical 校验有明确夹具风险，Hosted 真实新结果仍须当前 CI 读回。

`e15486ad` 与 `400b5671` 只修改测试：自有 mkdtemp base 与 SystemRoot 使用真实 realpath，Node/helper 继续原 canonical；不改生产 alias/ancestor/reparse/完整 helper pin 拒绝。whole-chain 同时等待原卡或原任务终态，pass-through 记录真实 readiness 后区分失败；没有 card/Policy/业务 marker/audit 才能处理不可用。共享 test helper 仅当 baseline 真正 exit 0 且三个受限 probe 明确报 create-environment 的已知缺 API/NotSupported 错误时，允许非 REQUIRED 环境记录 skip；空 probe、配置错误、未知 HRESULT、OS 断言失败均保持失败。`REQUIRED=1` 永不以此跳过。coding-tools focused 前置也不再将任意 unavailable 误记为 OS 不支持。

在隔离组合 head `6781f30f1b70e504d95e9bafea9de3553d6ca10e`，普通用户、实际原 trusted helper、`PA_TEST_NATIVE_SANDBOX_REQUIRED=1`，专属仓库外 TEMP junction 合成别名：whole-chain 与分类断言 **2/2 pass、0 skip**；focused 变更夹具 **7/7 pass、0 skip**，实际 baseline/PSEC 受限执行均成功。原计划父名称过滤仅验前置，Node 同时匹配其子项，故确实运行并按 7 项记账，不冒称只跑前置，也不再重复该组。没有模型/账号、全局配置或生产代码变化。[脱敏回执与日志散列](NATIVE_HOSTED_FIXTURE_20261021.receipt.json) 保留本机与 Hosted unknown 的区别。

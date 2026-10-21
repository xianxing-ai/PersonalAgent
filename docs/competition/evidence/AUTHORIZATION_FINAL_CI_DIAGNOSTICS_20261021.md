# 最终授权树 Windows CI 诊断交接

源 `2485648e59bcfee7eff9e409b1948b0b7f858105` 的实际 Foundation
`39627082923`（manual）及 `39627874875`（PR）均在完整 Windows check 失败。
两轮均为 coding-tools 302 pass / 1 fail / 1 skip、Desktop 1629 pass / 1 fail /
7 skip；Runtime 1063/1063 pass。Linux image、路由与设计审批成功不能替代此失败。

- `windows-native-sandbox.test.mjs:28`：baseline 为
  `native-request:-2146233079`，受限探针为 `native-stop-or-protocol-unconfirmed`。
  `SandboxLauncher.cs` 的 request 阶段明确拒绝 elevated helper；该阶段
  `InvalidOperationException` 与本 HRESULT 一致，但尚无真实 token 诊断证明。
  不把此结果解释为平台不支持，不跳过、不改变 guard、不回退普通进程。
- `authorization-native-execution.integration.test.mjs:90`：实际任务错误
  `REVISION_CONFLICT`，原夹具错误期望 `UNSUPPORTED_CAPABILITY`。
  `runtime-application.ts` 在 host prepare 抛错后先调用
  `invalidatePendingApproval(ref,'stale')`；`index.ts` 将原 pending approval
  从 revision 1 变为 denied/revision 2，写原 question-invalidation 记录并终结任务。
  本补丁严格检查这条原记录、零执行、撤销的 authority，以及原 preparation error
  仍为 `UNSUPPORTED_CAPABILITY`。后续实际 native 不可用仍失败，不变成成功。

新增测试诊断仅输出继承 token 的 administrator 布尔值、固定错误码、原审批状态和
原 readiness 结果；不输出身份、组、凭据、账号或私有路径。不创建 OS 用户、不登录、
不更改 CI 执行权限。当前源 ci.yml 直接 `npm.cmd run check`，没有普通 token 启动入口。

本次 Linux 仅完成三份文件 syntax、diff 检查与 test helper 的非 Windows 分支/
未知 baseline 不可分类为 unsupported 的定向断言。新独立树无依赖或 dist，未运行
Windows 或全仓测试。本补丁只修明确夹具错误并增加诊断，**未证明 CI 已恢复**；
下一步必须读取新 head 的真实 Windows 诊断后决定普通权限执行方案。

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

## 9239b356 实际新 CI 与普通权限接线

官方 Foundation `39630576674` / Windows `119327573339` 已失败，聚合 check 也失败。
两个 native 测试实际诊断均为 `administratorToken:true`。Desktop 严格审批失效断言
已通过，最后在原 native 不可用分支明确失败：task 为 REVISION_CONFLICT、prepare
为 UNSUPPORTED_CAPABILITY、approval denied/revision 2，baseline 为
`native-request:-2146233079`。coding-tools 本轮 baseline 和其他 probe 为
`native-stop-or-protocol-unconfirmed`。保留这些不同实际回执，不能把所有 probe
概括为同一 HRESULT。coding-tools 仍 302 pass / 1 fail / 1 skip、Desktop 仍
1629 pass / 1 fail / 7 skip；本轮 Runtime 实际 1073/1073 pass。

新增 CI-only `scripts/ci/windows-standard-token/`，不修改产品 native helper。
当前标准 token 直接启动；elevated 时优先现有同用户 Limited linked token，只有
缺 linked token 才尝试 own LUA restricted token。选择 token 和实际 suspended
child 均严格校验 SID/session/primary/Elevation0/medium/Admin deny-only/UIAccess0，
Job 纳管后才恢复。缺权限、句柄/ABI/Job 或 token 不符均失败，不登录、不创建账号、
不改 UAC、不跳过 native。详见该目录 README 的 API 权限与真实未验证边界。

ci.yml 在原 helper build 后编译新工具并执行短 smoke，只有成功才发布该 job 的
完整原 `npm.cmd run check` 入口；全仓原测试和 required 聚合保留。没有重复 dispatch。
静态复核已纠正 C# supervisor 分支局部变量重名。当前 Linux YAML parse、diff 与
原 CI merge-group/source-transfer 两文件 16/16 pass；首次误用了不存在的
`scripts/ci/cleanup.test.mjs`，该命令未执行测试，不计通过。没有 .NET/PowerShell，
因此新 C# 编译、Win32 ABI、合法普通 token 获取、短 smoke 和完整新 head CI
均**未验证**；必须由真实 Windows 新 CI 给结果，当前不得声称已恢复或可入队。

## 12083a7b：真实短 smoke 成功，完整 check 的后续阻断

Foundation `39634245104` / Windows `119340508898` 的实际 PR merge checkout 为
`5ec29ac526d015b58c48248481cdba910a2070b3`（12083a7b 合入 352cb7a）。
新增 launcher 真实编译通过，选择 `restricted-own`，stdout/stderr、exit23、env/cwd、
主动 Job 关闭及杀死独立 launcher 后的原子孙 process-handle 回收全部通过。
完整原 check 已开始，架构 3/3、契约 4/4、生成一致性通过；typecheck 的原 voice
构建在 Framework64 csc.exe 以 3221225794/0xC0000142 失败。npm 内部 CALL/npm-prefix
子命令同时输出不可识别诊断。没有到达原 native 测试，不宣称该链已恢复。

后续仅加入原 token/普通 token 固定对照：同一 canonical cmd/npm prefix 与
Framework64 csc /help（全环境及原 voice 四变量环境，shell:false/windowsHide:true），
只记录数字退出码/能力布尔，不预编译产品；只读继承 windowstation/desktop
AccessCheck、enabled logon SID 存在/保留布尔。不修改任何现有对象 ACL，不把
HRESULT 当成 desktop 根因。私有非交互 desktop 方案保留为待实证候选，未接入。
本次 Node syntax、Linux fail-closed 与 diff 通过；新增 C#/Win32 诊断仍待新 Windows CI。

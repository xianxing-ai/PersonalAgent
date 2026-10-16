# 合成工作区的 AgentArts 联合验收入口

<!-- current-design-20261013 -->
> 本文按所记版本阅读，API/阶段/验收事实保留。当前依据：[完整主架构](../../../docs/design/workflow-architecture-20261013/DESIGN.md) · [28功能流程](../../../docs/design/workflow-architecture-20261013/WORKFLOWS.md) · [连通图](../../../docs/design/workflow-architecture-20261013/index.html) · [接口状态](../../../docs/interfaces/CURRENT_INTERFACE_CATALOG.md) · [协作规则](../../../CONTRIBUTING.md)。当前实验为本机Laya有限候选判断，资格不足升级原受信teacher，国内执行模型经AgentArts调用；自有ARM64镜像串行编排，架构未最终定型。历史部署方案不覆盖当前决定，模板数量不等于业务验收；旧双人本机阅读不作为现行要求。设计不等于实现；非作者有效Approve和真实检查仍须满足。


`synthetic-cloud-workspace.mjs` 提供可导入的 fixture，由已经获准调用 AgentArts 的可信宿主使用。
它不读取环境变量、配置或凭据，不自行连接云端。导入没有副作用；创建 fixture 只准备本地合成工作区。
目标 Profile 为 `huawei_ict_agentarts`，真实云端配置、授权、传输与应用生命周期由调用方负责。

## 固定范围

fixture 排他创建 `.cache/mod18-cloud-workspace-*`、独立 SQLite 和受限 ACL recovery，
使用生产 Desktop coding host 的路径/身份固定与恢复端口。只公布以下三个工具并按顺序各执行一次：

1. `workspace.read_text`：只读 `demo.mjs`。
2. `workspace.apply_text_patch`：只接受初始字节摘要及预定的单处替换，保留 BOM/CRLF。
3. `workspace.run_allowed_command`：只执行 `verify-synthetic-patch`，用可信 Node 读取并比较固定字节，输出 `SYNTHETIC_PATCH_CONFIRMED`；不执行修改后的脚本。

入口只允许当前任务的精确参数摘要，额外参数、其他路径/命令和次序不符均拒绝。
自动审批仅适用于这一组已明确授权的合成操作；每次使用实际待审批 revision，由 Runtime/Policy 签发和消费许可。
出云前逐项核对固定正文、摘要、补丁结果和命令输出，变值或非空 stderr 均拒绝；
只投影已知合成常量，排除绝对路径、recovery 身份和本地 Evidence，发送前再次比对完整投影。
本入口没有系统指标或用户项目的出云授权。

## 可信宿主接入

依赖与 Runtime/coding-tools 按当前仓库已有构建顺序准备。以下示意放在仓库根的宿主脚本中；
`trustedAgentArtsOptions`、`trustedPowerShellPath`、`trustedNodePath`、`approvedDeadline` 和
`cancellationSignal` 必须来自已经授权的可信宿主，不把密钥粘贴到此文件或聊天中。

```js
import {createAgentArtsRuntimeApplication} from '@personal-agent/runtime/application';
import {createSyntheticCloudWorkspace} from './tests/manual/coding/synthetic-cloud-workspace.mjs';

const fixture = await createSyntheticCloudWorkspace({
  powerShellPath: trustedPowerShellPath,
  nodeExecutable: trustedNodePath,
});
const app = createAgentArtsRuntimeApplication({
  ...trustedAgentArtsOptions,
  ...fixture.runtimeOptions,
});

// 此新应用专用于本次 fixture；不要同时提交其他任务或覆盖 fixture 绑定。
const receipt = await fixture.run(app, {
  deadline: approvedDeadline, // ISO 8601；由调用方提供，不另设运行预算。
  signal: cancellationSignal,
  cloudConsent: true, // 调用前已获准将上述合成数据交给真实 AgentArts。
});

// 成功返回前已确认本次 worker 结束。
app.close();
fixture.close();
```

使用已确认的 WSS/HTTPS 配置与原凭据提供者。不要复制别的 userData/safeStorage 凭据，
不要注入 Fake 后将回执当作真实云端证明。传输回退选项沿用宿主的明确配置，不能静默回退 Local。

失败或取消先撤销 fixture 的执行与出云资格，再按任务非终态尝试取消原任务，
包括没有活动 worker 的等待审批任务；保存 `failure.json` 并返回脱敏的 `RESULT_UNKNOWN`，不自动重新提交。
调用方必须保留原 app、目录和任务，等待其 worker 停止并核实原执行；`activeTaskCount > 0` 时
`fixture.close()` 明确拒绝释放绑定。不要在无条件 finally 中强行关闭仍运行的 app。
Runtime 后续增加了 [Competition 原任务恢复](../../../packages/coding-tools/ACCEPTANCE-20261013.md#competition-原任务恢复增量)。
本入口失败时仍会撤销自身执行与出云资格，不自动续云或重做任务；新恢复能力不能据此自动恢复已撤销的许可。
真实云段和本入口故障后的宿主交互仍需联合验收。

## 回执与本次实际验证

成功只在原任务 succeeded、三个真实工具记录 confirmed、授权各消费一次、文件原始字节匹配、
固定命令输出匹配，且 competition-loop 回执与同一 run/输入匹配时写入 `receipt.json`。
`localToolLoopVerified=true` 表示这些本地事实；`remoteDeploymentAndTraceVerified` 始终为 false，
由宿主另行读回本次真实 deployment/version/API/trace 和传输结果。请求 ID 不自动等于平台 trace ID。
保留完整本地 fixture，不把 SQLite 或未经检查的诊断直接公开上传。

2026-10-13 运行下列四个定向测试，4/4 通过、0 跳过：

```powershell
node --test tests/manual/coding/synthetic-cloud-workspace.test.mjs
```

测试覆盖精确参数拒绝、出云变值/异常 stderr 拒绝、去除本地附加元数据、
**显式 Fake coordination** 驱动真实 Runtime/Policy/本地 read/apply/command 的三步闭环，
以及缺少出云确认拒绝、真实等待审批且 worker 为 0 时取消并撤销执行/出云资格。
Fake 提案不经过 Runtime 的真实云导出路径；投影限制为纯函数定向验证，未把它称作线上出云验收。
这次未读取云凭据、未联网调用 AgentArts、未验证正式 Desktop UI；不能据此完成 MOD-18 或比赛验收。

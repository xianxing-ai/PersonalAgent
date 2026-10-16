# Windows 聚合观测的本地 Runtime 验收

<!-- current-design-20261013 -->
> 本文按所记版本阅读，API/阶段/验收事实保留。当前依据：[完整主架构](../../../docs/design/workflow-architecture-20261013/DESIGN.md) · [28功能流程](../../../docs/design/workflow-architecture-20261013/WORKFLOWS.md) · [连通图](../../../docs/design/workflow-architecture-20261013/index.html) · [接口状态](../../../docs/interfaces/CURRENT_INTERFACE_CATALOG.md) · [协作规则](../../../CONTRIBUTING.md)。当前实验为本机Laya有限候选判断，资格不足升级原受信teacher，国内执行模型经AgentArts调用；自有ARM64镜像串行编排，架构未最终定型。历史部署方案不覆盖当前决定，模板数量不等于业务验收；旧双人本机阅读不作为现行要求。设计不等于实现；非作者有效Approve和真实检查仍须满足。


目标 profile：`huawei_ict_agentarts`。这是显式运行的实机验收，不是默认测试，也不调用云端。

安装当前工作树的锁文件依赖，按根 build 顺序构建 Runtime、Client、windows-client 及依赖后，在 Windows 执行：

```powershell
node tests/manual/windows/system-observation-acceptance.mjs
```

脚本在 `.cache/mod17-runtime-*` 新建独立 SQLite。默认 `createSystemObservationTool()`
只执行一次真实 CPU、内存、uptime 聚合采样，经生产 Runtime 的短期观测许可、Policy、
ToolGateway 和 Evidence；wrapper 在进入 provider 前拒绝第二次执行。
无许可任务的拒绝、审批前取消、缺 capability、停止后的许可及 Runtime 重开后的旧许可均须拒绝。
同一进程关闭并重新打开 Runtime/SQLite 后，历史结果、执行记录和 Evidence 必须保持一致。
这不等于整个 Desktop 重启、进程崩溃或物理设备恢复。

`receipt.json` 和终端只输出白名单元数据：来源、采样时间、不可用项、opaque task/run ID、
授权消费与记录状态。原始聚合指标仅保留在本地 SQLite，**不要把数据库作为公开附件上传**。
不读取用户名、主机名、进程列表、私人文件或窗口正文。
失败不回显 assertion 中的指标；保留新目录以便本地排查，不重试旧任务。

runner 不检测管理员令牌；需要声明普通权限时另记录当前会话令牌检查。
公共 Evidence 的等级按实际存储读回，不把本地独立验证提升为 `verified`。
当前回执见 [MOD-17 记录](../../../packages/windows-client/ACCEPTANCE-20261013.md)。

MOD-16 现场入口和未验证条件见 [Windows Host 记录](../../../apps/windows-host/ACCEPTANCE-20261013.md)。

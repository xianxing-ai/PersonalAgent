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

## 记事本隔离手工脚本

`notepad-full-access-acceptance.mjs --run-public-notepad` 是显式 opt-in 的真实原生写入脚本，使用独立 SQLite、journal 和脚本内已有的 `manual-full` 策略。它不读取或证明正式 Desktop 的用户沙箱选择；脚本通过不能代替原 Desktop 模式与凭据验收。执行须另有对新空白记事本公开测试文本的授权。

普通用户令牌检查复用 Desktop 的 `findWindowsExecutable('pwsh.exe')`，从 PATH 解析规范路径并排除当前仓库。未发现可用 PowerShell 7 时，在打开原生窗口之前以 `NOT_FOUND` 失败；不回退到旧 Windows PowerShell，也不安装工具。

## F15 原补丁窗口的单次目视路径

正式 Competition Desktop 的设置页须已有实际审核者配置，以及原任务生成的待审核项。对该项点击「在本机查看原补丁」会调用 `coding.review.show`；Main 复核原任务、工作区许可与授权，再启动 WinForms。不要用临时审核者、替造签名或脚本内的 `manual-full` 代替这些前提。

在原任务 deadline 前目视确认补丁窗口的内容，再正常关闭该窗口。原 viewer 只有收到 `SHOWN`、`CLOSED` 且子进程正常退出，才向 UI 返回展示完成。单独 `SHOWN` 只表示 WinForms 的 Shown 事件；保持窗口打开直到 deadline 会得到 `deadline_expired`，不证明用户已看见窗口。展示完成也不构成审核批准，审核结论仍须原独立签名。

2026-11-03 本轮仅核对代码与本机工具发现，并做脚本语法检查；未打开窗口、采集音频或执行上述手工验收。

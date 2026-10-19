# MOD-17 主文字与 Live 系统观察消费（2026-10-18）

`computer.system.observe@1.0.0` 已由 `packages/windows-client` 提供并注册在 Desktop product tools。
原 public connector host 刻意不导出机器数据，所以只有工具注册并不能让主模型调用或收到结果。
本包增加 `system-observation-conversation.js`，只消费这个原 RegisteredTool、Runtime 和 CompetitionExport。
没有新探测器、定时器、任务库、进程归因或系统写入。

## 可信 main 组合

```js
const systemObservationConversation=createSystemObservationConversation({
  getApplication:()=>runtimeApplication,
  resolveUserConversation:taskId=>conversationToolAccess.resolveConversation(taskId),
  tool:productTools.tools.find(tool=>tool.descriptor.name==='computer.system.observe'),
  confirmExport:confirmTaskPayloadExport,
});
```

factory 返回 `tools:[tool]`，是原对象，不是新 wrapper。main 保留原 product tools 的该工具，
不要重复注册；从原 availability 移除同名项，再加本包唯一 availability，exports 加本包唯一策略。
原空输入 schema `{}`、`read`、`computer:system:read`、非幂等/不可恢复能力声明均不改变。
main 将此工具排除 automaticTools，使原 Runtime/Policy 仍逐次审批；本包不签发任何工具许可。
关闭 main 时调用本包 `close()`，撤销进程内出机 permits 并中断尚未完成的确认。

`confirmExport` 接收 `{kind:'system_observation',taskId,conversationId,proposalId,payload,deadline,signal}`，
必须用可信 Native UI 展示完整 payload，只有精确同意返回 `true`。使用通用“本任务资料出机确认”，
不能把机器观察误标为源代码或开发仓库资料。会话开关、语音模型自报同意、先前允许公开 connector，
都不代表机器数据可以出机。缺 callback/可信 canonical task/原有效期限或信号时 unavailable。

同一 Runtime 能力元数据使文字看见原工具及完整参数 schema；Live 通过分页 `read_context`
理解相同接口，经原 `request_work` 在 user-work 子任务实际调用，不能在 Live 另开采样通道。
原工具此前已计入目录上界；本包补 export/readiness 不增加 descriptor 或 schema 字节。
最终目录容量以 devtools 的真实组合测量为准，不能简单在现有计数上再加一次 CPU。

## 结果与确认边界

只在原 task 的实际提案和 Policy 允许后采样。导出先验证原 competition pending proposal、
原 task/run/input/scope、confirmed execution、Policy allow 和原 `tool-result`，再校验原 output schema。
投影仅包含原 source/capturedAt/requestedSampleWindowMs、原可选采样起止与实际窗口，
CPU logicalProcessorCount/utilizationPercent、内存 total/free/usedBytes/utilizationPercent、uptimeSeconds，
以及原 unavailable 列表；不含新指标、hostname、进程、路径、凭据或推断出的卡顿原因。

每份完整投影限制 4096 UTF8 字节，Native 精确批准后才能成为 continuation。
批准后的最终发送再次核对同一 canonical task、deadline、取消/撤回状态、原 confirmed 结果及完整投影。
不能把批准挪给别的提案、不同结果或新采样。取消、过期、close、来源改变都拒绝发送。
拒绝出机时原本地 confirmed/Evidence 保留在 `waiting_reconciliation`，不自动重复采样。
进程重启不恢复本进程的出机同意；缺原 permit 的持久 continuation 仍 hold，不静默授权。

`process_breakdown/disk_io/thermal/network_activity` 继续 unavailable。
CPU/内存利用率只表示所采样时段的负载，不能证明具体进程、磁盘、温度、网络或“为什么卡顿”。

## 定向证据范围

Node 24.15.0 定向五项测试包括：生产 #406 user-work 派发与两次原 Policy，
注入计数探针的完整 Native 确认与续答、拒绝/关闭只保留原本地确认、缺 callback 零采样、
canonical/deadline/signal 约束。Synthetic 探针返回 `source:'injected'`，与实采样分账。

另一个测试确实调用本机原 Node `os.cpus/totalmem/freemem/uptime`，保留 `source:'node:os'`，
经过原 Policy 和显式 Synthetic Native 确认；结果只进入进程内 Synthetic 模型 transport，
没有真实 HTTP 云请求。它证明本机 NodeOS 读取与宿主消费，不证明 Windows 实体设备、
Electron Native 对话框、真实 Live 音频、远端模型质量或 Windows-MCP 操控验收。

main 数组合并、统一 Native UI 与最终接线检查由 Root 主写；专项通过不等于全部 MOD 通过。

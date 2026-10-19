# 两种电脑控制引擎的共享执行锁

2026-10-18，目标 profile：`huawei_ict_agentarts`。本层供 Desktop 主进程将既有原生 Notepad 与
独立 Windows-MCP 工具装配到同一个 Runtime；它不实现 Windows 输入、不签授权、不排队调度，
不写任务/结果库，不修改 descriptor，也不重放失败或未知的操作。

```js
import {createComputerControlLease} from './computer-control-lease.js';

const computerControl = createComputerControlLease({
  getRuntime: () => runtimeApplication?.runtime,
});
const tools = computerControl.wrapTools([
  ...notepadHost.tools,
  ...windowsControlHost.tools,
  ...otherTools,
]);
// 同一实例的 tools 交给原 Runtime/Policy/ToolGateway。
// 诊断：computerControl.snapshot()；关闭：computerControl.close()。
```

`wrap(tool)` / `wrapTools(tools)` 仅包装以下七个精确名字：

- `computer.notepad.replace_text`
- `computer.desktop.observe`
- `computer.desktop.click/type/scroll/move/shortcut`

包装器保留原 descriptor 对象引用，保持原 Gateway 的 scope、presence、参数绑定与 Policy 审批。
不相关工具原对象不变；系统指标读取与 `computer.request_access` 不属于引擎调用，也不占用输入锁。
工厂可先于 Runtime 创建；实际调用时缺原 Runtime reader 则 fail closed。
reader 只需原公开 `listTasks`、`readToolExecutions`、`matchesToolExecutionInput`，不注入第二存储。

同一实例一次只有一个真正的控制调用，包含 Snapshot 观察；所有权检查与取得之间没有 `await`。
另一个引擎的并发请求在调用 provider 前以 `REVISION_CONFLICT` 拒绝，不排队、不触发设备 I/O。
原 ToolGateway 在授权后可能将写工具异常保守映射为 `RESULT_UNKNOWN`；此层不绕过或放宽这一行为。

写工具 promise 返回时，原 Runtime 尚未提交 confirmed，不能立即给另一个引擎放行。本层暂保留
**一个执行锁的原 task/run/参数身份**，下一请求只读原 Runtime 比对原执行记录与参数/scopeRef。
正常返回须看到该原记录 confirmed；不确定返回须看到原 Runtime 的 applied/not_applied 核实结果。
单纯切换工具、取得新 targetRef、构造新 run、取消旧任务或再次观察都不能释放未知写入的锁。
这个内存中的交接锁不持久化结果，也不代替原 Runtime 记录；参数不进入诊断快照。

每次新写入还读取原 Runtime 所有 `waiting_reconciliation` 任务的电脑写记录。任一真实已获 Policy allow、
executionStarted 的 `started/unknown` 记录都会拒绝所有新的电脑写入；因此重建本层实例仍不能绕过
原持久未知结果。只读 `computer.desktop.observe` 可在没有正在执行的控制调用时运行，但不会清除写封闭。
恢复只消费原 Runtime 的核实状态，不再次执行原动作。

取消、过期、关闭和 reader 缺失在 provider I/O 前拒绝；工具返回过期、未知或无效结果时，仍保留
原写锁。`close()` 只阻止新调用，不自行取消、撤销或认定正在运行的原任务已经结束；任务取消与
具体引擎进程释放继续走原 Runtime 和各 Host 生命周期。

定向验证：

```sh
node --test apps/desktop/test/computer-control-lease.test.mjs
```

Local/Synthetic **7/7 通过，0 失败，0 跳过**：跨引擎互斥、观察互斥、落库前交接窗口、原未知结果
跨实例重建封闭、原核实后才允许新工作、取消/过期/reader 缺失、无效结果不放行，以及真实
Policy/ToolGateway 在 Synthetic 确认前保持两种引擎零 I/O。没有运行 Windows 设备或真实 F9，
不证明新的输入引擎或 OS 目标隔离已经验收。生产 main 装配由根集成人使用同一实例完成。

# 终态未知电脑输入的重开保护（2026-10-26）

目标 profile：`huawei_ict_agentarts`。独立工作树 `<source-worktree>/.worktrees/large-control-20261026`，分支 `codex/large-control-repair-20261026`；源基线为主集成第十轮检查通过的 A10 工作区快照，HEAD `b2fb20dd094743c411656b7e7703c8aae7571a8e`。HEAD 本身不包含该快照的全部未提交改动。主代理负责集成，未提交、推送或创建 PR。

## 触发与修复

`TaskRuntime.finishNativeReconciliation` 可以在可信宿主确认原执行已停止后，将编排任务终结为 `failed` 或 `cancelled`；它明确保留原工具 `unknown` 记录，不证明该次写入已经执行或未执行。共享电脑输入锁和浏览器重开检查此前只查 `waiting_reconciliation`。于是重开后，这类已经停止但结果未知的原输入可能被漏掉，后续受控写入被放行。

两处检查现在使用同一候选状态集合：`waiting_reconciliation`、`failed`、`cancelled`。候选仍逐页读取，每页最多 100 个原任务；随后检查原允许执行、确已开始且未解决的工具记录。正常 `running` 不在恢复候选中，因为 Gateway 会在当前调用进入驱动前写入当前 `started` 记录，不能把它当作旧未知操作阻止自身执行；成功历史也不进入热路径扫描。

浏览器同时复用共享输入锁的写入分类。此前它按 `browser.*` 前缀把 `observe`、`screenshot`、`wait` 的未知读取也当作未知写入阻塞。现在只有原 `allow`、`executionStarted=true` 的受控写入能触发这个阻塞。共享全局输入资源的既有跨引擎互斥语义保留；没有从临时 `targetRef` 推断豁免，也没有扩大到其他工具或只读观察。

原任务终态、revision、工具记录、错误和 Evidence 不修改。该改动不签发权限，不重开任务，不重放驱动操作；内部分类导出没有改变公共 wire 或 Schema。

## 验证

使用固定 Node 24.15.0，在本隔离树运行：

```powershell
& '<source-worktree>/.cache/toolchains/node-v24.15.0-win-x64/node.exe' --test `
  apps/desktop/test/large-control-terminal-unknown.test.mjs `
  apps/desktop/test/computer-control-lease.test.mjs `
  apps/desktop/test/browser-control-host.test.mjs `
  apps/desktop/test/windows-control-host.test.mjs
```

- 新回归的最初版本为 13 项：修复前 6 pass／7 fail。四项失败复现 `failed`／`cancelled` 原未知写入在重开后漏扫，三项失败复现浏览器未知读取误阻塞；原失败日志保留。
- 补入跨页反例后，四份测试文件共 76 pass／0 fail／0 skip。聚焦测试有重叠，不与整仓计数相加。
- 原工具通过真实 Runtime／Policy／ToolGateway 写入 SQLite，合成 driver 调用一次后抛出 `RESULT_UNKNOWN`。显式合成的“驱动已停止”守卫调用真实 `finishNativeReconciliation`，随后实际关闭并重开 SQLite。
- 原终态和 `unknown` 记录逐字段不变。新 Notepad、原生电脑及浏览器受控写入均为零次驱动调用；读取和无关工具仍可执行。
- 在原未知任务之后放入 125 个较新的失败任务，第二页仍找到该原记录并拒绝输入，未截断为最近 100 项。

原日志位于此工作树 `.cache/large-control-terminal-unknown-before-20261026.log`、`.cache/large-control-terminal-unknown-focused-20261026-a2.log`；相对 A10 的补丁、日志和源码 SHA 由同目录独立交付回执记录。

## 边界与未验证项

这是真实 Runtime／SQLite 加显式合成 driver 与停止守卫的回归。没有启动真实浏览器、发送鼠标键盘输入、调用真实模型、访问账号或操作用户应用；浏览器网络测试只使用既有回环服务夹具。

未在子工作树运行整仓检查、Electron、安装器或真实设备验收；必要集成检查由主代理串行执行。本增量没有新增对终态未知结果的重新执行或解除阻塞 API，也不把“已停止编排”解释为“原写入结果已确认”。

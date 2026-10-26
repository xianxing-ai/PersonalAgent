# MOD-18 公开命令工厂配置绑定验收

执行者：受 root 委派的 coding_mod18_1025；基线 `ad1a045e1ec65f9ef280125d9df78b9cb63b4e51`。
Linux x64，Node 24.15.0 / npm 11.12.1，独立依赖 `npm ci --ignore-scripts`；只复用固定工具链，全部 dist 在本工作树从源码构建。

## 已复现问题与修补

公开 `createWorkspaceCommandTool(options)` 原先在每次 execute 读取 `options.trustedSandbox`。
宿主注册后复用 options 并删除该属性，会让原工具执行旧的非隔离进程路径，违反 README 的注册期配置复制和受限请求不回退约定。
新回归选择 Node 固定 recipe 在临时目录写 marker，并注入明确 unavailable 的 Fake sandbox；删除 options 属性后原实现意外成功，修补后返回 `UNSUPPORTED_CAPABILITY`，marker 不存在。

这是公开 factory 的配置稳定性问题。只读检查 `apps/desktop/electron/native-execution-host.js:77`，当前生产宿主以新对象字面量传入配置，未发现删除该属性的实际产品路径；不据此声称已发生产品越权。
`apps/runtime/src/dev-workflows-runtime.ts:225` 直接传入宿主配置，亦未发现变更该属性的行为。

修补只在 factory 捕获所选 sandbox 对象引用，不复制或冻结其方法、执行器状态与 Runtime 租约。
回归随后替换原对象的 executor.execute 为实时撤销拒绝，仍得到 `SCOPE_DENIED`，不会写 marker。
Desktop 的 `assertBinding` 仍每次检查 closed/current、配置身份、取消、deadline、Policy revision 和任务状态；没有改其撤销路径、公共 Schema 或 Windows PSEC guard。

## 先红后绿与必要检查

日志位于本树忽略目录 `.cache/mod18/`。UTC 时间和 wall 来自执行器/计时器；红例 UTC 为日志写入时间，Node 报告时长如下。

| 检查 | UTC | wall | exit | 结果 | 日志 SHA-256 |
| --- | --- | --- | --- | --- | --- |
| 原实现新增回归 red.log | 2026-10-25 06:09:38Z | Node 296.355ms | 1 | 0/1，Missing expected rejection | d8ce5b48a7909c210fbfc6a653f561815e7f6b5f8d9b78f1933e8435fd89d68b |
| 最小修补单例 green.log | 2026-10-25，红例之后 | Node 289.753ms | 0 | 1/1 | 06f183f2632bad074f824f9494e15e8a0057cbbed65fe634493a513c909f882a |
| 定向真实 fs / 进程与 synthetic 分支 targeted.log | 06:10:28.524649–06:10:30.702327Z | 2.178s | 0 | 72 pass / 21 skip / 0 fail | 942d9620aab7d9305dd0d582b4973fa9941f88fdde20cb80b2a25d5eb5aa4a06 |
| typecheck.log | 06:10:30.702549–06:10:33.168456Z | 2.466s | 0 | 通过 | 5716a06603cea2df1bf202b02fe3dba117dbff9d504c4940559de275f246f666 |
| architecture.log | 06:10:33.168651–06:10:33.415284Z | 0.247s | 0 | 3/3 | c4b0a97c471a911c05e6b7764496ff6ba6922632140a1a3eca017840cd231fdb |
| coding-tools 全模块 module.log | 06:10:47.621170–06:10:53.006895Z | 5.386s | 0 | 290 pass / 25 skip / 0 fail | f10abb4e494349752d58484012c367518b761ec193d9a6d8ce2affd71f555c00 |

定向命令：`node --test packages/coding-tools/test/{workspace-read,workspace-read-wire-boundary,workspace-list,workspace-patch-preview,workspace-patch-stage,workspace-patch-apply,workspace-patch-reconcile,patch-apply-dispatch,workspace-command}.test.mjs`。
全模块：`npm test --workspace=@personal-agent/coding-tools`；类型：`npm run typecheck --workspace=@personal-agent/coding-tools`；架构：`npm run check:architecture`。

## 证据边界

- 实际 Linux 临时文件系统：read/BOM/CRLF/hash、preview 不写源、stale hash 保留用户修改、stage 候选、链接/敏感路径拒绝；command 固定 recipe、输出/非零退出/超限/取消，现有 Policy/ToolGateway 参数绑定及一次授权回归。
- synthetic：本次 unavailable sandbox 与 live 撤销；patch helper READY/dispatch/取消；reconcile 使用注入进程身份检查及合成 marker 核实 after/before/unknown，unknown 不重写源、存活/身份不明保留 marker。不能称真实 Windows helper 写入或跨重启证明。
- 未验：Windows 独占 apply/CAS、PSEC OS 文件与网络边界、JobObject 子孙停止、真实用户工作区、Desktop 整链和 Huawei 云整图；Windows 专项如实 skip。此次不放宽 guard，不增加 Linux apply 替代路径，不宣称 MOD-18 全部完成。
- 没有对外发布或 push/PR；所有测试子进程已随运行结束，fixture 清理只移除各自随机临时目录。

## 收尾独立核验（2026-10-25 UTC）

核验源码提交 `1cf6abe241ad5f214722557c0a872eefb797b296`，开始时工作树 clean。
使用 `/workspace/PersonalAgent/.cache/wiring-20261018/toolchain/node-v24.15.0-linux-x64/bin/node`（24.15.0），依赖及 dist 均为本工作树原有独立产物；没有重复大构建。
原红/绿、定向、类型、架构和全模块六份日志的 SHA-256 均重新核对一致。
以下命令均在本工作树执行，`node` 指上述固定二进制；完整参数、UTC、exit 和 hash 另存 `.cache/mod18/handoff-checks.jsonl`。

| 命令 | UTC 开始–结束 | wall | exit | 结果 | 日志 SHA-256 |
| --- | --- | --- | --- | --- | --- |
| `node --test packages/coding-tools/test/workspace-command.test.mjs` | 06:26:45.196785–06:26:46.285691Z | 1.089s | 0 | 21 pass / 5 Windows skip | 0b0375a979cc1308331809fa8ebef98fb2174bdb38d24525dbf428feb68ead51 |
| `node --test packages/coding-tools/test/windows-native-sandbox.test.mjs` | 06:26:46.286032–06:26:46.426032Z | 0.140s | 0 | 1 unsupported-platform guard pass / 1 Windows skip | f51a62ce481276fd26c04aa555b5f91060141286e908f110428964e9489efa22 |
| `node .cache/mod18/live-port.mjs` | 06:26:57.434855–06:26:57.704247Z | 0.269s | 0 | 独立 synthetic 端口核验通过 | df38542532513c9f5d2c2e068ff22557be4b24f9e8aafc53bc41378eac19eec4 |

独立脚本只使用随机系统临时目录：注册后把 options 的 sandbox 替换成会抛错的新对象，原 sandbox 的 bind 改为撤销拒绝，确认 executor 零调用；随后恢复原 bind、替换原 recordResult，确认仍经原 executor 返回 unavailable，并调用新的 receipt 方法一次。finally 删除自有临时目录。它补充检查实时方法访问，不能证明真实 Windows PSEC enforcement。
只读复核 Desktop `assertBinding`、executor 的创建前与 READY 后 `assertCurrent` 保持原样；本修补没有改变这些动态撤销或原生 guard。

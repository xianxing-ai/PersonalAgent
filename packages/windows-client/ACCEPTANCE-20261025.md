# MOD-16：异步校验期间观察过期（2026-10-25）

- Profile：`huawei_ict_agentarts`；仅客户端本地缺陷修复，不表示 PA-016 整体验收。
- 基线：`ad1a045e1ec65f9ef280125d9df78b9cb63b4e51`。
- 固定源码：`839898015a96a330ba6dcf0f9f6ddc7bc6dfdc6f`，父提交为上述基线。
- 工作树：`.worktrees/windows-client-20261025`；分支 `codex/windows-client-20261025`。
- 环境：Linux、Node 24.15.0、npm 11.12.1；本树独立 `npm ci --ignore-scripts` 及 dist。

## 缺陷与实际消费路径

`createWindowsDesktopControlHost` 的动作入口先确认原 targetRef 有效，再等待受信
`verifyTarget`、在场确认和 `attempts.record`。原实现在这些等待后只复核任务 deadline，
没有再次检查观察的 30 秒有效期，因而可能派发过期观察对应的 Click。

实际消费方 `apps/desktop/electron/windows-control-host.js` 注入本工厂，原 `attempts.record`
核验 running/取消、任务期限、presence、Policy 执行记录及精确参数，并通过原 Runtime
`saveCheckpointOnce` 持久化；它不保存 targetRef 的观察有效期，因此不能替代客户端检查。
生产 record 当前以 async 包裹同步持久化；测试使用明确合成异步接缝验证边界，未声明真实 OS 曾派发。

最小修复在在场确认返回后及 attempt 持久化返回后的 `ready(context)` 后复核原有效期。
过期返回 `UNAUTHORIZED`，零上游动作；任务取消/期限仍优先返回 `CANCELLED`/`TIMEOUT`。
已写入的 attempt 保留且不重放；本次未分派不标记 `RESULT_UNKNOWN`，分派后未知仍使用原封闭逻辑。
未修改权限、guard、Schema、公共 API、依赖、迁移或冻结状态。

## 当前可验收结果

日志保留于本树被忽略的 `.cache/windows-client-20261025/`。下表 UTC 为原日志最后写入时间；
命令结束码由执行器和 Node 测试结果确认，未记录精确启动时间。

| 命令 | UTC | exit | 结果 / 日志 |
| --- | --- | --- | --- |
| `node --test --test-name-pattern='target expiry' packages/windows-client/test/desktop-control.test.mjs`（修复前） | 06:03:15 | 1 | `Missing expected rejection: verifyTarget`；`windows-client-red-20261025.log` |
| `npm run test --workspace=@personal-agent/windows-client` | 06:03:41 | 0 | 23/23；`windows-client-green-20261025.log` |
| `npm run check:architecture` | 06:03:31 | 0 | 3/3；`windows-client-architecture-20261025.log` |
| `node --test apps/desktop/test/windows-control-host.test.mjs` | 06:03:53 | 0 | 11/11；`windows-client-consumer-green-20261025.log` |
| `npm run build --workspace=@personal-agent/windows-client` | 06:04:30 | 0 | `build.log`（补存日志检查） |
| `npm run typecheck --workspace=@personal-agent/windows-client` | 06:04:35 | 0 | `typecheck.log` |

模块 build/typecheck 均通过。依赖先构建 contracts；消费测试另先构建 policy、tool-gateway。
首次消费测试因独立树尚缺 tool-gateway dist 失败；补构建后通过，未修改测试或源码绕过。
新增回归覆盖 verifyTarget、presence 和 record 三阶段跨过有效期边界，以及 record 中取消和任务期限过期。
断言零 Click、明确错误、attempt 前拒绝不写记录、持久化后拒绝保留记录次数及 provider 未封闭。

| 日志 | SHA-256 |
| --- | --- |
| red | `64db5f8b041f76badb024429dc5cd4dac7cfb9d59e8227f10c42e20d4f93e1e6` |
| green | `be16022e23c7e5ecab0f4559b8d4bb718abd64d16b5c523c8e8756328b3974ef` |
| architecture | `09033ed3c69d14e6399e87c70e9e1d11c57ad2cbe78bf89fc0140f5a7d25a2e4` |
| consumer-green | `6c119a3d3d4ba514feef187ba4f0e04dda9cf2947f62963b9ef08a0f00b3a414` |
| build | `0f084bf1e437ef505a06c13e8989a6b5370d614003d602510274629c29205a9a` |
| typecheck | `b6979da4114aab4fde0f7374a4d0ea2334b6dc2ee50550e24c09ae3e93a97033` |

## 独立复核

`windows_host_1025` 对固定源码进行只读互审，未发现阻断问题；确认期限检查保留
取消/任务期限优先级，生产 create-only checkpoint 阻止同 run 重放；不证明系统时钟回拨行为。

`windows_acceptance_1025` 在独立验收树 cherry-pick 为
`8975aa5d37cac3e67199c8dc8ccd08005484febe`，与固定源码 tree 均为
`d2f71a73a95584066049e682510e87062c671870`，`git diff` 为零。
Node 24.15.0、Linux，无 dotnet。2026-10-25 UTC：06:04:30.850297 开始模块 build（exit 0），
06:04:35.636812 开始 typecheck（exit 0），06:04:40.637751 开始以下消费检查（exit 0）：

```sh
node --test packages/windows-client/test/desktop-control.test.mjs apps/desktop/test/windows-control-host.test.mjs apps/desktop/test/windows-host-fixture.test.mjs
```

23 tests：22 pass、1 原生 Windows 测试在 Linux 显式 skip；生产 Client/Desktop 代码消费 Fake MCP/Runtime。
日志为验收树 `.cache/windows-acceptance-20261025/fixed-{0,1,2}.log`；前两个 hash 与上表
build/typecheck 一致，消费测试 hash 为
`bf7dc342111fb491c2035ba524f769bbf74e6498ba41b973447ce044e29e733c`。
独立互审与本地复核不冒充 GitHub Approve 或真实 Windows 验收。

## 验收边界

未启动 Windows、上游 Python、云、真实账号或权限修改。OS 强身份、焦点竞争、跨引擎仲裁、
真实 F9、用户接管、Notepad/UIA 写后读回、正式 Desktop/AgentArts 全链及凭据适配不由本次测试证明。
原观察 fence 仍不是 OS 沙箱；`goalVerified=false` 与恢复不支持的语义保留。
提交仅供 root 集成发布；本分支未 push、创建 PR、批准或合并。

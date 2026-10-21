# 统一授权真实 Runtime 组合增量（2026-10-21）

目标为 Competition Profile，使用独立 Synthetic 数据和本树构建产物；未调用云、真实账户、模型或设备。不是完整平台验收。

## 实际执行

- 本树 Node 24.15.0 / npm 11.12.0，独立 `npm ci --ignore-scripts --no-audit --no-fund` 安装 201 包；首次受限 DNS ENOTFOUND 后通过最小网络授权完成，未运行安装脚本。
- 31 个 Runtime/Desktop 依赖 workspace 顺序构建通过。首次 AgentArts/Runtime TypeScript 收窄错误修复后仅重跑失败包。
- 原聚焦组 63 项：35 pass，28 项 F15 实体隔离夹具在外层沙箱 `realpath EPERM` setup 失败，未执行产品断言；只对该失败文件按最小平台授权重跑，28/28 pass（0 skip，约 17.3 秒）。覆盖完整原 F15 图、隔离模式、N05 重启恢复、并发用户修改 CAS、云自报拒绝、取消及有界错误回执；未弱化路径/进程身份限制。
- `node --test apps/desktop/test/approval-projection.test.mjs`：2/2 pass，包括 timer 到期后旧 pending UI 缓存按同一 Runtime approval ID/task/revision 刷新。
- `authorization-question-host.test.mjs` 与新增 `authorization-runtime-integration.test.mjs` 的前两例联合 5/5 pass；新增第三例“同操作各阶段派生”单独 1/1 pass。
- 8 份受影响知识/配对/remote MCP/语音消费者文件首轮 44 项为 29 pass / 15 fail。知识/配对的 12 项因外层进程/路径访问限制失败；只对其 2 文件最小授权并明确 PS7 路径重跑，15/15 pass。其余 remote MCP 撤销夹具区分“成功返回当前状态”和“旧配置成功保存”，仍要求 revoked/configured=false、原凭据不复活；语音改用 async rejects 保留原 release_unconfirmed 拒绝断言。只对这 2 文件最小平台重跑，14/14 pass，loopback connect 原断言未放宽。原 44 项分别取得通过，不冒充一次全组零失败。
- 整轮摘要 source binding 的 Runtime 增量构建通过；`harness-context-host.test.mjs` 与 `context-compaction.test.mjs` 67/67 pass。同一原范围不同 segment 的 policy binding 相同，更换来源范围不同；缺受信整轮来源时在询问/发送前拒绝。
- AgentArts 投影审计增量构建通过。原 `owned-workflow-driver` 6/6 pass；`owned-workflow-host-bridge` 首轮 1/2 pass，另一项因外层原目录 realpath setup 失败；只对该文件最小平台授权重跑，2/2 pass。实际 SQLite/ToolGateway 原结果与签名保留，已签投影可幂等读回，替换原 receipt、投影或 lease 均拒绝。
- 架构门禁 3/3、契约夹具 4/4、contracts 生成文件一致性检查通过。普通同步 main 的 Research 源码只定向重建该 workspace 通过，未重复全部依赖构建。
- [实际 Mail 本机批次组合](MAIL_BATCH_AUTHORIZATION_20261021.md)在 `5951d8e4` 新文件 6/6 pass、0 skip（约 1.83 秒）：101 条 Synthetic 信头经原每页 limit 100 形成两个原 Runtime 页，一张卡、各 run 独立 grant/confirmed。范围替换、撤销、配置/resource generation 变化、取消和到期均阻断，零云许可及零 export lease。首轮非法 Synthetic namespace、第二轮 provider 小页被生产正确聚合的夹具错误均保留，没有修改业务分页限制。

## 新组合实际证明

使用真实 RuntimeApplication、TaskRuntime、Policy、ToolGateway、AuthorizationQuestions、Desktop question/intent adapter 与 TodoService；仅 Coordination 响应、加密存储适配和提醒投递为显式 Synthetic。

1. 旧 Todo session consent 为 false 时目录仍可提出操作；一张卡覆盖 tool/session/export。批准前零 Todo 写入、零私人结果 continuation；批准后一次实际本地写入与原 confirmed execution、一次精确结果 lease。旧 `authorization.respond` 不能绕同卡，重复回答、替换 run 和结果内容拒绝。
2. 永久规则在重启后对同资源/profile 的另一任务及不同普通 title 参数复用，但新 task/run/arguments grant 独立产生；撤销后再次出卡，拒绝保留原 Runtime 的 cancelled 转移，未增加写入或发送。
3. 未配云的原 Competition Runtime 仍可处理本机管理 intent 卡，无 Coordination/模型可用性；猜测 host-only 工具的公开调用被拒绝。
4. 同一原 workflow 的模型与最终阶段共用首张 allow_once 卡，后续生成各自 confirmed intent task/run 和不同参数摘要；取消原 owner 后不创建后续阶段或发送。

## 组合发现并修复

原 final export guard 在工具已 confirmed 且 loop 保存 continuation、清除 pending 后仍要求 pending，导致已写入任务停在 waiting_reconciliation。现在只有**已消费 export requirement**可以读取原 confirmed receipt/不可变 anchor；工具执行 guard 不使用该条件。运行时已消费的 resultDigest 与持久精确 lease 必须一致，不能在任务结束后以另一份合法形状的 JSON 替换原结果。

独立复核还发现历史摘要的阶段派生未绑定整轮来源。Runtime 现在提供原 configuration/source/tail/goal-frame 摘要与数量，Main 结合原 conversation/cutoff 和模型配置/策略绑定；不是从模型生成的 segment 文本猜范围，也不按每个分段多问。签名投影写入既有审计后必须读回相同记录，不能忽略 write-once 冲突而签另一份投影。

## 尚未由本记录证明

- 实际 Electron 首屏可发现性和视觉复核已由 UI owner [独立保存](AUTHORIZATION_RENDERER_QA_20261021.md)：初轮业务通过但首屏视觉失败，修复后 `fe0149c6` render-only 通过并逐张检查 3 PNG；不重复声明所有业务/设备验收。
- 实际 ToolGateway→单卡→PSEC command 的集成已由 native owner [单独记录](AUTHORIZATION_NATIVE_INTEGRATION_20261021.md)：`e3105aa0` 单文件 1/1、0 skip，原生产 factory、真实 Policy 消费与一次原生写入、重复/参数替换拒绝、配置不可用无裸 spawn 降级。已有 OS probe 未替代这条链。
- 完整仓库 required CI、真实 AgentArts/模型、账号、日历、麦克风和安装包未由本组测试证明。

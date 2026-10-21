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

## 全仓 CI 发现与有界修复

`38b34d951a0aeec168cd0ed2a1a4e0b06121c0cf` 的 [Foundation 39617732454](https://github.com/xianxing-ai/PersonalAgent/actions/runs/39617732454) 中 Linux image、ecs-linux-check 成功，Windows [job 119283688561](https://github.com/xianxing-ai/PersonalAgent/actions/runs/39617732454/job/119283688561) 在完整原 `npm run check` 失败：Desktop 1613 项为 1576 pass / 30 fail / 7 skip；Runtime 1063 项为 1059 pass / 4 fail。此前本机聚焦通过不覆盖这些旧消费夹具，也不替代此失败门禁。

- 外部提交 `e7607ecb` 只修 Runtime 三份旧测试：expiry 不得晚于原 deadline，迟到 approve 明确 TIMEOUT，已到期 failed 任务不能被 cancel 重开成另一终态。保留零执行/零 grant 与原失败事实。
- `1cead754` 修五份 Main/桥接夹具：AST 读取真实新增 runId 回调；注入三个新 optional cleanup host；Laya-only fixture 明确本机授权初始化参与者且仍不创建云任务/模型；开发经验等待原卡并验证无第二 modal；语音仅映射现有卡，不能创造卡或显示私有参数摘要。连同上述 Runtime 三文件，实际定向 **82/82 pass、0 skip**，没有产品修改。
- UI owner 的 `d654bd4d` 只修四份夹具：Renderer 使用真实审批去重 helper；反馈 AST 只选择唯一非空实际反馈语句；workspace Fake 工厂消费公开命令 descriptor/outputSchema；路径按真实 Windows canonical 路径比较。集成 `2a2075dd` 定向 **23/23 pass、0 skip**（两 panel 文件 21 项、原 workspace 失败 case 1 项、固定 recipe metadata 1 项），保留原权限、错误归属与取消断言。
- 原生整链 Hosted Server 初轮只等 card，未观察真实失败任务，因而以 30 秒 timeout 隐去准备失败。同 job 的 OS probe 连 full-access baseline 均在 spawn 前报告配置不可用，不能据此推断平台缺 PSEC。`400b5671` 仅将自有 fixture 目录/SystemRoot 规范为实际 canonical 路径，并从原运行记录即时读取准备结果；生产 alias/junction 拒绝保持。只有真实 full-access baseline 成功且全部受限 probe 明确报告已知 PSEC API 不支持时，非 REQUIRED 环境才能 skip；未知、配置失败和 OS 行为断言失败继续 fail，REQUIRED=1 永不 skip。
- Native owner 在普通用户、专用 TEMP junction 模拟别名输入及 REQUIRED=1 下，本次受影响整链/严格分类 **2/2 pass、0 skip**；focused 文件实际 **7/7 pass、0 skip**，没有把父测试 name filter 冒称只跑 prelude。原始回执与边界由[原生证据](AUTHORIZATION_NATIVE_INTEGRATION_20261021.md)保存。此本机结果不证明 Hosted Server 已恢复；最终 current-head 完整 CI 仍须实际读回。

## 同步外部 stop/steer/queue 主线

普通合入 `f89de58a40bf7a2e7257193f9827868f08e0397f`，保留新停止/插话/排队行为与单卡授权。三处冲突仅按组合语义解决：Main 环境与 delivery/reconciliation imports 全保留；Renderer 问卡与队列 imports 全保留；审批 markup 同时执行原 `outputTruncated` 隐藏与精确 question/sourceApprovalId 去重。另加行为断言，确保截断任务不能再出现旧批准按钮、同一问题不能有第二组按钮、别的对话不能隐藏当前审批。

合并提交 `66b40e145dfdd3b4a1eda6a6e33387f489de97ff` 的七文件 stop/admission/反馈/expiry/readback/reconciliation 定向组 **63 项：55 pass / 8 fail**。8 项均在新主线 task-action-focus 的 AST 夹具取到问卡 render wrapper、未选中原 cutoff 投影时失败；真实投影仍保留。仅改夹具为唯一含原 cutoff 的实际语句，并保留非空/唯一与 cutoff 断言，该文件重测 **14/14 pass、0 skip**。这些是有重叠的执行回执，不合计为 77 个独立用例。实际受影响 Renderer 首屏/键盘复核另由 UI owner 保存。

## 尚未由本记录证明

- 实际 Electron 首屏可发现性和视觉复核已由 UI owner [独立保存](AUTHORIZATION_RENDERER_QA_20261021.md)：初轮业务通过但首屏视觉失败，修复后 `fe0149c6` render-only 通过并逐张检查 3 PNG；不重复声明所有业务/设备验收。
- 实际 ToolGateway→单卡→PSEC command 的集成已由 native owner [单独记录](AUTHORIZATION_NATIVE_INTEGRATION_20261021.md)：`e3105aa0` 单文件 1/1、0 skip，原生产 factory、真实 Policy 消费与一次原生写入、重复/参数替换拒绝、配置不可用无裸 spawn 降级。已有 OS probe 未替代这条链。
- 完整仓库 required CI、真实 AgentArts/模型、账号、日历、麦克风和安装包未由本组测试证明。

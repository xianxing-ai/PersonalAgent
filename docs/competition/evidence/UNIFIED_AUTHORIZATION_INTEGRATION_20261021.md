# 统一授权真实 Runtime 组合增量（2026-10-21）

目标为 Competition Profile，使用独立 Synthetic 数据和本树构建产物；未调用云、真实账户、模型或设备。不是完整平台验收。

## 实际执行

- 本树 Node 24.15.0 / npm 11.12.0，独立 `npm ci --ignore-scripts --no-audit --no-fund` 安装 201 包；首次受限 DNS ENOTFOUND 后通过最小网络授权完成，未运行安装脚本。
- 31 个 Runtime/Desktop 依赖 workspace 顺序构建通过。首次 AgentArts/Runtime TypeScript 收窄错误修复后仅重跑失败包。
- 原聚焦组 63 项：35 pass，28 项 F15 实体隔离夹具在外层沙箱 `realpath EPERM` setup 失败，未执行产品断言；平台授权重跑结果另行追加。其余原审批到期、重启、父任务/host-task 与 Mail batch 检查不据此重复。
- `node --test apps/desktop/test/approval-projection.test.mjs`：2/2 pass，包括 timer 到期后旧 pending UI 缓存按同一 Runtime approval ID/task/revision 刷新。
- `authorization-question-host.test.mjs` 与新增 `authorization-runtime-integration.test.mjs` 的前两例联合 5/5 pass；新增第三例“同操作各阶段派生”单独 1/1 pass。

## 新组合实际证明

使用真实 RuntimeApplication、TaskRuntime、Policy、ToolGateway、AuthorizationQuestions、Desktop question/intent adapter 与 TodoService；仅 Coordination 响应、加密存储适配和提醒投递为显式 Synthetic。

1. 旧 Todo session consent 为 false 时目录仍可提出操作；一张卡覆盖 tool/session/export。批准前零 Todo 写入、零私人结果 continuation；批准后一次实际本地写入与原 confirmed execution、一次精确结果 lease。旧 `authorization.respond` 不能绕同卡，重复回答、替换 run 和结果内容拒绝。
2. 永久规则在重启后对同资源/profile 的另一任务及不同普通 title 参数复用，但新 task/run/arguments grant 独立产生；撤销后再次出卡，拒绝保留原 Runtime 的 cancelled 转移，未增加写入或发送。
3. 未配云的原 Competition Runtime 仍可处理本机管理 intent 卡，无 Coordination/模型可用性；猜测 host-only 工具的公开调用被拒绝。
4. 同一原 workflow 的模型与最终阶段共用首张 allow_once 卡，后续生成各自 confirmed intent task/run 和不同参数摘要；取消原 owner 后不创建后续阶段或发送。

## 组合发现并修复

原 final export guard 在工具已 confirmed 且 loop 保存 continuation、清除 pending 后仍要求 pending，导致已写入任务停在 waiting_reconciliation。现在只有**已消费 export requirement**可以读取原 confirmed receipt/不可变 anchor；工具执行 guard 不使用该条件。运行时已消费的 resultDigest 与持久精确 lease 必须一致，不能在任务结束后以另一份合法形状的 JSON 替换原结果。

## 尚未由本记录证明

- 实际 Electron 首屏可发现性和视觉复核由 UI owner 独立保存；DOM/IPC 通过不代替截图视口通过。
- 实际 ToolGateway→单卡→PSEC command 的集成由 native owner 新 fixture 单独记录；已有 OS probe 不代替该链。
- 完整仓库 required CI、真实 AgentArts/模型、账号、日历、麦克风和安装包未由本组测试证明。

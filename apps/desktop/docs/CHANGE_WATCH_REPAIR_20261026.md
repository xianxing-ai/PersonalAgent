# UIDVALIDITY 变化触发修复（2026-10-26）

Profile：`huawei_ict_agentarts`。工作树：`.worktrees/large-runtime-20261026`，分支：`codex/large-runtime-repair-20261026`。本包只改 Desktop 变化触发宿主和合成回归测试；没有公共 Schema、数据库迁移或依赖变化。`docs/adr/0035-connector-change-triggers.md` 仍是 proposed；P1 邮件至 P5 的 `P1-MAIL-P5-PAGINATION` 仍是 provisional。

## 现象与依据

基于真实 SQLite、Runtime、Policy、ToolGateway、MailService 和显式 `FakeMailProvider` 的三项原始回归测试，修复前 3/3 失败（`.cache/xhigh-change-watch-20261026/before-tests.log`）：

1. UIDVALIDITY 轮换后，旧 `pending` 邮件变化仍交给本地 Laya。
2. 新 epoch 已建立基线后，迟到的旧 `confirmed` 读取能重新产生变化。
3. 本地推理进行中轮换邮箱，旧推理结果仍能投递通知。

连接器契约规定 `sourceRevision = String(uidValidity)` 是缓存域身份，变化时丢弃旧域和旧断点；它没有提供“数值更大即更新”的排序语义。跨 epoch 只用原 Runtime 工具执行记录的 `startedAt`/`finishedAt` 和已确认结果判定先后；同一 epoch 用已确认返回条目的 UID 水位处理页观察乱序。源任务、Policy 决策、执行证据及原始结果仍由 `original()` 逐次校验。

## 修复

`connector-change-host.js` 在原 `desktop-connector-changes` host-state 中附加可选 `mailEpochs` 指针。域键绑定当前配置、原 watch ID 或用户对话、账号和文件夹；指针只保存来源哈希与可信回执时间，不复制邮件正文。原 `sources`、`events`、`watches` 格式和事件/任务 ID 均不变。

- 新的确认页属于不同 epoch 且其读取开始时间晚于当前指针时，更新指针。该页只按原逻辑建立新基线；旧事件在原 `currentEvent()` 读回时变为 `REVISION_CONFLICT`，通过既有 `superseded` 路径结算。
- **不同 epoch** 的旧执行开始时间早于当前指针时，迟到或重放的结果不推进源状态。若两种 epoch 的开始时间落在同一毫秒，标记该域 `ambiguous`，暂时阻断两边提醒，等下一次具有更晚可信开始时间的确认读取重新确定基线。
- **同一 epoch** 的已确认页即使迟到仍补入 `heads`，但只把高于已实际返回 UID 水位的未见条目提名为新邮件；指针时间不倒退。空页回显的调用者 cursor 不抬高该水位，非零 cursor 的空页也不单独建立首次邮箱基线。
- 旧版 host-state 无 `mailEpochs` 仍可读取；下一次确认读取按原状态补充指针。此前已经投递的通知及原工具记录、Evidence、未知回执不被回写或重发。仍在执行的本地判断由原 Runtime 当前源检查失败结算，保留原任务及失败证据。

本改动不增加监听授权、读取重试、通知重试或模型入口；持续读取仍经原 watch/Policy/ToolGateway。Main 现有 `observeTask` 与 `flush` 接线无需新 API。合入共享入口时只应取本包 `connector-change-host.js`、`xhigh-change-watch-epoch.test.mjs` 和本文档的增量；`connector-watch-host.js` 的既有 A10 改动不属于本包。

源码绑定：`connector-change-host.js` 修改前 SHA-256 为 `2c13b38f1077b80fa0e25e627f3806c464d65e2a2886c50e59fbf397308cf31a`，v1 后为 `18812961ac0db06da6cf0ad6a9ae68b98044d80db3338e056913901f3140839b`。`connector-watch-host.js` 维持本包开工前 `1d707f5f6b0b7830f9858d6472f406af39ed5236b35b8c4bd2bbd160d7efc02c`，`connector-read-origin.js` 维持 `e0eb7b8940c834260ca76ce39b98bd688fc4e14e044040a4a9f2c27c1d495884`。原三项红用例所在的 `xhigh-change-watch-epoch.test.mjs` 开工时 SHA-256 为 `6d1b817ef8196ac16a0b88701290edd831d2c7348a9b1e7c2e541a3d7dd5edf0`；v1 两个边界用例后为 `8486497f96a4082fe64c618481b5d4b47b1131f41609413e8626f55e028db265`。v2 的精确源码、测试与文档 SHA 及补丁见 `.cache/xhigh-change-watch-20261026/delivery-v2/manifest.json`。

## 验证与界限

- 修复前：上述 3 项合成用例失败 3 项，日志见上。
- v1 修复后：`D:/PersonalAgent/.cache/toolchains/node-v24.15.0-win-x64/node.exe --test apps/desktop/test/xhigh-change-watch-epoch.test.mjs apps/desktop/test/connector-change-host.test.mjs apps/desktop/test/connector-change-watch-integration.test.mjs`，45/45 通过。覆盖原三个失败、旧状态、下降的 UIDVALIDITY、同毫秒歧义、SQLite 重开与回执回放，以及已有天气/通知/授权回归。
- v2 增量验证见 `.cache/xhigh-change-watch-20261026/delivery-v2/after-tests.log`，覆盖乱序分页和迟到高 UID；完整计数与哈希见同目录 manifest。
- v3 增量验证见 `.cache/xhigh-change-watch-20261026/delivery-v3/after-tests.log`；上述四个聚焦文件的 53/53 项合成用例通过，新增空页 cursor 不抬高 UID 水位、非零 cursor 空页不初始化首次基线的回归。
- 仅使用合成邮箱、本地选择器和合成通知回执；没有真实邮箱、真实模型、OS 通知、云端、设备或 GUI 验收。未运行构建和全量 `npm run check`。
- 老状态尚无 epoch 指针时，历史来源之间缺少可反推的账号/文件夹与可信时序元数据；首次升级后的确认读取是该域指针起点。指针建立后的过时读回和待判断事件受本修复约束。相同毫秒而无法可靠排序的跨 epoch 读取会保守暂停提醒，等待后续确认读取。
- `mail.inbox` 的公开输入允许传入 cursor；服务只返回大于该 cursor 的条目。因此，单个非零 cursor 空页不能证明邮箱没有邮件；非空首批也不能单凭该页证明此前 UID 已覆盖。当前 watch 是否会在真实邮箱场景选择这类 cursor 尚未验证，本包仅用合成读回验证宿主对空页的保守处理，不宣称任意首次 cursor 已形成完整基线。

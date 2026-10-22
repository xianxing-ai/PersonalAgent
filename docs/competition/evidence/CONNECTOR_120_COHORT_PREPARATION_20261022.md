# 真实邮件 / 天气来源验收准备

Profile：`huawei_ict_agentarts`。隔离树：`.worktrees/connector-real-completion`；生产源码基线 `ef3f4e71`。本记录只证明下述已执行前置，不代表真实闭环完成。

2026-10-22T08:29:16Z 至 08:29:21Z，原 Desktop 隔离实例配置前置检查退出 0：AgentArts 加密配置可加载，固定版本 `arm64-v5-d92a17a4-r3` / WSS；QQ 配置已绑定、无须重启，cloudAnalysisAllowed=false。只复制三份明确批准的加密文件，不复制历史。原设置连接页完成宿主 revision、正文与可见控件核对。未启动 Laya、未读信头/正文、未写邮箱、未发 Gmail；Runtime 来源读取数量为 0。实例已自行关闭，正式应用与专用 Radicale 未操作。该配置检查不证明本轮 IMAP 连接成功。

本轮固定公开样本：

- cohort：`pa-header-batch-bfb8d312-dff8-4745-ab31-3463e936f82b`。
- manifest：`tests/manual/connectors/mail-header-batch-20261022-bfb8d312.manifest.json`。
- manifest SHA-256：`0ad8be236cacc51ec4c8febfbe444862e4e0564d23cb12cd4a8bb9a2b14da721`。
- 120 封，6 类各 20 封，原单页 100 条；内容明确为公开虚构样本，传输验收必须是真实 Gmail → QQ，不以生成内容证明来源发生。

`mail-header-send-ledger.cjs` 在每次外部发送前，以 create-only 文件记录 attempted；仅 connector 明确 message id 才记 sent。未知或进程中断保留 unknown/attempting，禁止重试同 case。账本绑定相同 manifest/cohort、原 watch、完整最终页及分类结束后的 baseline_ready；保存逐封安全结果，不含地址、正文或账号凭据。发送者由原连接的 Gmail 承担，本模块没有 API 或凭据。

Node 24.15.0：原导航/阶段与 cohort 直测 14/14，新增发送账本直测 3/3，均 0 skip；语法和差异检查通过。这些离线断言不是邮箱、Laya 或通知的真实验收。

等待主控交接唯一 Laya 资源槽。真实 runner 可停在 `await-original-laya-resource-slot`，不会点击模型启动；公开释放文件须绑定当前 source/cohort 与本进程开始后的 UTC。真实邮件 baseline 要有原 confirmed/allow/started 最终 `hasMore=false` 页，且原 watch sequence 已推进、分类完整结束，之后才能发送同 cohort 的 120 样本。发送回执、QQ 收到、120 分类、Laya 自主选择、主对话、native show、设备/用户已读分别记账。

自然天气继续使用原查询的相同地点、日期、单位；只有真实显著变化才进入后续判断。不换城市日期、不刷缓存冒充变化、不强选 notify。尚未观测到的自然事件保持未验证。结束/错误只尝试停止原 watch，并关闭本 runner 自己的隔离实例；未知操作不重放。

## 首次真实邮件准备与 deadline 修复

主控交槽后，隔离 runner 实际启动原 Laya：ready=true、calibrated=false。原通知策略卡已确认；原 main `01f2a224-6ad3-4c2e-90fa-67db4a1f6adc`、child `be0e2468-31f0-4660-9dd1-069e9cfc5ff4` 均 succeeded，`connector.watch.start` 为 confirmed/allow/started。

本轮未到 baseline：首 mail host task `c1991eca-16ba-48bd-a8f9-e356adb6928e` 在公开 schema 验证失败，INVALID_ARGUMENT；来源读取执行记录为 0、Gmail 发送为 0。runner 以 start-exact-watch / ERR_ASSERTION 结束，已关闭自己实例；关闭后的原 watch 为 disabled。没有重放旧 watch。完整回执仅留本树忽略目录 `.cache/desktop-change-notification-live-KefalW/`，公开记录不含私人信头或原文。

明确边界：watch 接受的原 expiry 是 `2026-10-23T08:36:43.3031536Z`；其值原样成为 mail host intent / invocation deadline。Core public `tool.invoke` 请求 deadline 模式只接受 UTC 整秒或 3 位毫秒。用完全公开的离线 parseRequest 复现：7 位日期返回 INVALID_ARGUMENT；规范为 `2026-10-23T08:36:43.303Z` 则接受，二者 Date.parse 都等于 1792744603303。未放宽 Core schema。

修复只在原 connector-watch-host 的 startMailRead 可信调用边界将 deadline 规范为 new Date(Date.parse(...)).toISOString()。已批准的 watch.input 保留原字面值与绑定，授权时间点相同且不延长；天气本来已在其 host-tool 准备边界使用规范 UTC。非法日期和未知外部字段继续拒绝。新增回归先红、修后原 watch 单文件 20/20、0 skip；语法及差异检查通过。原 unknown / restart / stop / configuration / erasure 回归继续通过。此离线修复尚待新的真实读取，首轮失败不改成通过。

# #497 默认任务连接恢复与 Live 边界（2026-10-22）

Profile：`huawei_ict_agentarts`。本包在 `.worktrees/psec-real-completion`、
`codex/psec-real-completion` 承接 `d4711553`，没有读取真实用户配置、私人请求文件或数据库，
也没有启动账号、模型、云部署或实际 Desktop 实例。

## 证据判断与现有路径

已通过 GitHub 连接器读取 [issue #497](https://github.com/xianxing-ai/PersonalAgent/issues/497)。
其中记录另一设备 `dist=c15855f5` 的约 160ms 协调失败、日程服务零写和同时 Live 连接失败，
以及同 gateway/runtime 的两个未固定 pin HTTPS 200。没有 Upgrade HTTP status、服务端
部署删除回执或实际版本读回；“r3 被回收”仍是强假设，不能以此宣布部署死亡。两个 200
也不能证明旧 pin 对应 HTTPS 可用或日程业务写入已成功。

只读检查公开探针 `tests/manual/agentarts/support/run-text-probe.mjs`：原
`AgentArtsCloudAgentPort` 只传 gateway/runtime 时已默认 HTTPS，构造的原
`/runtimes/<runtime>/invocations` 不带 endpoint。Desktop 原受信 fetch closure 也支持
未配置 deploymentVersion 的相同路径。这是现有未钉版目标选择，不需要发明 Latest
resolver。实际 Latest 的具体版本仍未读回，不把它冒充原 pin。

只读定位 `packages/models/src/agentarts-realtime.ts`：原 adapter 逐字使用配置 WSS URL，
要求固定 endpoint、双受信凭据与 `pa.realtime.v1` 子协议，复用原 JSON/PCM 实时会话。
它没有 HTTPS 等价音频传输或 direct Qwen 回退。HTTPS-only 构造只能保留 connect 端口，
实际 connect 明确 `UNSUPPORTED_CAPABILITY`，不会打开 socket。故普通任务连接恢复与
Live 恢复必须分开记录；本包不改原生实时协议，也不宣称音频已恢复。

## 新显式设置动作

私有路由 `agentarts.restoreDefaultConnection`，无参数；宿主方法同名。
只有用户点击“恢复默认连接（HTTPS / Latest）”才提交此动作，render/失败反馈不提交。
宿主从原已保存配置内部保留 gateway/runtime/Authorization/appToken，使用原 validate、
safeStorage 和原子文件保存流程写入 HTTPS、空 pin、空 WSS、备用关闭。
不能用 Renderer 草稿替换目标，不能接受额外目的地参数，不向 Renderer 返回凭据。
模型目录偏好按原配置切换规则重新刷新；旧 transport/provider 绑定失效，不让活跃旧实例
偷偷改目的地。未配置或安全存储失败保留原已保存配置，无自动请求、重放或关闭实例。

快照兼容增加 `deploymentSelection` 与 `canRestoreDefaultConnection`，并修正显式已保存
HTTPS 下旧启动环境 WSS 地址又出现在快照的问题。界面同时显示当前 HTTPS/WSS 和
固定部署或“默认 Latest（未钉版，实际版本未读回）”，并说明 Live 仍需受支持的 WSS。
成功仅表示设置保存及匹配读回，不能宣称真实连接或任务已执行。

主控拥有 main 路由：确认沿原配置切换/重启提示装配此无参数方法，不新增审批卡（明确
设置点击已是用户动作），不自动重放任务或关闭用户实例。本包没有编辑 main。
本包 UI Fake 测试与合成渲染验证的是该私有 action 和 host API；完整 main 接线及真实恢复
由主控单独验证。

## before-invoke 跨层协作接口

已先交付两个小提交供 Runtime 负责人使用：

- `df50f61df459fa6a6b8b83b973802e0fc40de964`：公开
  `AgentArtsBeforeInvokeError`，本地 WSS 连接/Upgrade 错误继承固定安全消息类型，
  `AgentArtsCloudAgentPort.invoke` 保留 instanceof。
- `a163675a8f534e210b5a99693167f8dec47c788e`：补原
  `CompetitionCoordinator.execute` 消毒层对该类的保留；实际 Cloud→Coordinator
  串接正/负例通过。最初只测 port 导致漏掉此层，Runtime 真消费回归发现后已修正。

生产只从本地可证明从未将 invoke 交给 WSS 的路径产生此类型，不根据缺少 inflight 或
任意 EXTERNAL_FAILURE 推断。远端 JSON、伪造同名 Error、导出 guard 和已 fetch HTTPS
不能获得该类别；所有 post-send unknown 继续原 ResultUnknown，无 fallback/重放。
Runtime 对原树实际写入、unknown、cloudhold 及父子任务的决策由另一负责人实现，
此类型本身不签发恢复权限或改变终态。

## 验证

Pinned Node 24.15.0，配置夹具使用本树隔离 TEMP/TMP 和公开合成 safeStorage：

```text
node --test apps/desktop/test/agentarts-controls.test.mjs apps/desktop/test/agentarts-config.test.mjs
48 passed / 0 failed / 0 skipped / 0 cancelled / 0 todo

node --check apps/desktop/electron/agentarts-config.js
node --check apps/desktop/src/app/agentarts-controls.js
passed

node node_modules/typescript/bin/tsc -p packages/coordination/tsconfig.json
passed (before-invoke interface preparation)

node --test packages/coordination/test/agentarts-websocket.test.mjs packages/coordination/test/agentarts-websocket-error.test.mjs
39 passed / 0 failed / 0 skipped

node --test packages/models/test/agentarts-realtime.test.mjs
23 passed / 0 failed / 0 skipped
```

直测包括：显式动作无 payload、不保存草稿、不并发 save/revoke、不盲重试；错误/错目标/
仍有 pin 的结果不显示恢复成功；失败不泄露错误内容；同实例凭据保留/加密/重启；
旧 provider 失效、旧启动 WSS 不回灌；实际 HTTPS URL 无 query、原 host 注入凭据；
未配置/拒绝参数/存储失败均不发送网络或破坏原 pin。

### 合成渲染

Browser plugin/skill 未提供，按 frontend-testing-debugging 使用已有 Playwright 1.63.0
和本机已安装 Chrome headless；没有安装浏览器、访问真实页面或使用用户浏览器 profile。
直接加载原 controls 模块和原 tokens/style/surfaces CSS，about:blank 合成标题
`AgentArts default connection fixture`，视口 1280×1040 与 600×1040。
路径：已保存 WSS/pin → 点击恢复 → 一次无参数 action → 匹配 HTTPS/空 pin 读回。

| 检查 | 两个视口 |
| --- | --- |
| 页面标题/URL、非空内容、无错误覆盖层 | passed |
| console/page error | 0 |
| 恢复按钮可见且不越界，窄视口正常换行 | passed |
| HTTPS/Latest 未钉版状态及 Live 边界文字 | passed |
| 单击后只产生一次无参数 action，空 pin/WSS | passed |
| 截图检查按钮、状态、换行和文字 | passed |

本树忽略目录 `.cache/wss-fallback-tests/render/` 保存 `before/after-1280.png`、
`before/after-600.png` 和 `report.json`，均为公开合成内容，不是私有应用截屏或真实恢复
Evidence；截图未提交 Git。渲染脚本初次断言误把显式 `undefined` payload 当作缺失键，
修正夹具断言后两个视口通过，产品代码没有为此变化。

这些离线检查不能证明真实 Live 音频、平台 deployment 生命周期、日程写入或另一设备
已恢复。剩余真实验收仍需主控按用户授权读取实际 transport/deployment/任务终态；
没有以 HTTP 200、合成 UI 或未钉版配置保存替代业务和设备验收。

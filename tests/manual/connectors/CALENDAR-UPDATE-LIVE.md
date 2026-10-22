# 专用真实 CalDAV 修改验收

本脚本连接操作者已启动的真实 Radicale，不安装或启动服务。只支持回环地址、公开专用 principal `pa-public-calendar-test`，测试密码为公开值 `pa-public-calendar-test-only`。服务不得暴露到局域网或公网。这不是用户私人日历验收。

每次使用一个**尚不存在**的集合地址，例如 `http://127.0.0.1:5232/pa-public-calendar-test/calendar-<唯一编号>/`。脚本会 MKCALENDAR 创建集合、以 If-None-Match 预置一个唯一公开 UID；已存在集合直接失败，不覆盖。集合与测试事件保留供独立核对。

必需输入：

- `PA_MANUAL_DESKTOP_CALENDAR_LIVE=1`
- `PA_CALENDAR_TEST_URL`：上述新集合地址。
- `PA_CALENDAR_SAVED_CONFIG_DIR`：明确批准的原加密 AgentArts 配置目录；只复制 `agentarts-config.json` 与 `Local State`。
- `PA_CALENDAR_ELECTRON`：实际 Electron 可执行文件绝对路径。
- `PA_CALENDAR_TEST_MODE`：`restricted` 或 `full-access`。分别执行时必须使用不同新集合。

在已构建的集成树运行 `node tests/manual/connectors/desktop-calendar-update-live.cjs`。脚本创建独立 userData，原设置 UI 选择权限模式并配置专用日历，再由原主对话、原 AgentArts 子任务及 Runtime/Policy/ToolGateway 执行 `calendar.update`。不改变正式应用或原配置。

受限模式必须实际展示且只批准原 dispatch 与合并日历卡两张；Full access 通过原 UI 选择，任何 pending 卡都直接失败，不替它点击。DOM 记录卡片出现，完成时卡片须移除，原 snapshot 保留 allowed 历史。真实回执还要求父子任务 succeeded、一次 confirmed 日历修改、原云请求及结果续接。

独立 HTTP GET 用真实 ICS 核对 UID、标题、起止时间、强 ETag 改变及 SEQUENCE 只增加 1；关闭本脚本自己启动的 Desktop 后再次 GET，核对持久效果。遇 unknown/waiting_reconciliation 不重发。输出只含公开测试字段与安全元数据，保存在忽略的 `.cache/desktop-calendar-update-live-*`。

离线直测：`node --test tests/manual/connectors/desktop-calendar-update-live.test.cjs`。这些是合成输入断言，不证明真实 Radicale、云端、卡片或设备验收已通过。

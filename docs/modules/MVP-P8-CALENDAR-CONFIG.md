# P8 日历可信配置入口

<!-- current-design-20261009 -->
> 当前协作规则（2026-10-17）：[接线交付总包](../competition/COLLABORATOR_WIRING_PACKAGE.md) · [模块分工](../MODULE_ASSIGNMENTS.md) · [当前设计](../design/CURRENT_DESIGN_20261015.md)。各 MOD 负责人自行闭环实现、公开契约、实际调用方接线、必要测试与 Evidence/文档。常规 PR 须由 zemeng5208、goo122、Potatos498、2511375597-lab 中任一非作者对当前提交有效批准；Owner zemeng5208 对具体 PR 的审核例外须在该 PR 明确记录，不伪称独立批准。拥有合并权限者（包括作者）可在最新必需技术 CI 通过、严格同步 main、无冲突且阻断意见已处理后合并；四位协作者跨 PR 均衡承担审查与合并，禁止强推、直接推 main 或绕过技术检查。下文历史正文、作者及验收按原日期保留，旧流程不作为现行门槛。

> 维护入口（2026-10-07）：项目主要负责人为 zemeng；当前分工以 [模块分工](../../docs/MODULE_ASSIGNMENTS.md) 为准，最新状态见 [ROADMAP](../../docs/ROADMAP.md)。历史日期、作者和验收结论按原记录保留。

- Profile：`huawei_ict_agentarts`。
- 原工作包负责人：`zemeng` / P8；当时拟请 `goo122` 或 `Potatos498` 评审。当前 PR 的有效审批按上方协作规则和 GitHub 当前提交的实际审查记录判断。
- 需求：PA-013；范围：MOD-11/13 的主进程配置、设置输入与安全状态。
- 状态：review；不表示日历连接、读取、P5 改期消费或真实账号验收完成。
- 基线：P8 #236 `72453af`；独立分支 `codex/zemeng/p8-calendar-config`。

## 行为与边界

1. 正式 Competition 设置的“连接”页面增加 CalDAV 配置。参数依据已合并 P1
   `CalDavReadProviderOptions.calendarUrl/calendarName/authorization`，本片支持账号与应用密码的 Basic 认证。
   主进程验证 HTTPS collection 地址，不允许 URL 内嵌凭据、查询参数、片段或控制字符。
2. 凭据和地址整体经过 Electron `safeStorage` 后原子保存至本机 `calendar-config.json`。
   `snapshot()` 只含显示名、已配置/需要重输/读取未接状态和布尔标记；不返回地址、账号、密码、
   Authorization、accountRef 或 secretRef。Renderer 输入的密码在提交及离开设置时清空；错误不回显输入。
3. 同一地址与账号保存时，空密码保留原凭据。改变地址或账号必须重新输入密码；禁止跨目的地复用。
   宿主生成 accountRef/secretRef/revision；旧绑定在修改、撤销后不能解析凭据，修改后的 URL 也不能借旧引用取头。
4. “撤销并清除配置”是独立显式操作，只删除本片配置文件并清空设置输入。
   加密不可用、损坏或保存失败时保留旧文件/旧值；不会触及 AgentArts、Live、SIS 或邮箱配置。
5. IPC 限正式应用管理窗口主 frame；任务执行或 Runtime 启动期间不改配置。
   首次配置无需已连通 Runtime。Fake/Local/synthetic 不创建生产配置入口。
6. 保存只完成本机配置：不启动 Provider、不发送网络、不授予 scope、不持久化读取许可或恢复会话。
   状态为 `read_unavailable`，明确显示“配置已加密保存；日历读取能力尚未接入，本次未读取日历”。

未新增公共 wire Schema、capability、依赖、数据库/旧基线库或 CSS；未触及 P1/P5 负责文件。
宿主 `binding()` / `readAuthorization(binding)` 是可信配置端口，不暴露给 Renderer，也不替代 Policy。
加密文件采用单个配置的 version 1；旧代码忽略它即可，不能将它当未加密凭据导入。

## 验证

- 4 项显式 Fake safeStorage 定向测试通过：保存/重建后仍未授权读取，秘密和目的地不回显；
  原密码保留、引用变更/目的地变更拒绝；非法输入不覆盖；加密不可用/损坏保留、独立清除不动其它配置。
- 主进程、配置、控件与 admin view 的 `node --check`、`git diff --check` 通过。
- Browser skill 未列出；现有 Playwright 使用已安装 Edge，隔离 HTTP 设置夹具，没有安装依赖。
  1120×760 与 720×760 下实际渲染可读、无裁切/重叠；保存→空密码改名→清除配置交互通过，密码及清除后输入为空。
  页面 identity/非空/无错误覆盖层、console/pageerror 检查通过，未修改玻璃样式。
  夹具使用合成账号与 Fake 加密，仅调用本片配置对象；不连接正式 IPC、日历、AgentArts 或 Runtime。
  截图留在本机临时目录 `pa-p8-calendar-preview-*`，未提交配置、截图或原用户数据。
- 用户原 Desktop 进程保持运行；未重启模型或原生 Host，没有实际 Windows 加密读回/真实服务器验收。

## 下一片

已合并 #231/#228 提供 P5 投影与消费原语，并未提供生产读取装配。
等待 P1/Runtime 交付受控 Provider factory、单条读回 tool/export/scope 与受限凭据注入协议后，
P8 在唯一 main/public-connector-host 接入此配置，实际调用仍经过 Runtime/Policy。
旧 ConnectorItem 与 Fact binding 复用既有 Runtime checkpoint；本片没有另建事实或基线数据库。
`calendar.events` 列表过滤 cancelled，不代替单条读回；NOT_FOUND 保持人工复核，不推断撤回。

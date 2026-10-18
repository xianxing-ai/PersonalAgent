# 前端窗口控件与布局修复（2026-10-17）

目标 Profile：`huawei_ict_agentarts`，范围为现有 Desktop 窗口、前端展示和本机桥接，不增加 Local 产品能力。工作分支为 `codex/frontend-window-layout-20261017`，基于 main `5c5b90c3`，并带入此前已交付分支的悬浮球修复。本文不将本地验证或分支交付视为已合并 main。

2026-10-18 交付补齐：在 `codex/publish-frontend-fixes-20261018` 正常合并 main `6cd401b1`，保留模型设置、远程 MCP 管理入口和退出生命周期测试；远程 MCP 按钮放在窗口控制组之前。同步后的窗口动作、控件、悬浮球/面板拖动与退出专项测试 45/45 通过，语法检查通过。下方原生缩放矩阵与完整 Desktop 计数是 2026-10-17 原分支的历史证据，不代表同步后已重新完成全部验收。

## 实际问题与变化

- 管理后台原有标题栏只有关闭按钮，新增最小化、最大化、还原和关闭控件；与大工作区共用展示和交互实现。按钮明确属于 `no-drag` 区域，支持鼠标、Enter、Space 和可见键盘焦点。
- 原“桌面设置与恢复”普通按钮位于标题栏拖动区域，入口用途也不清晰。移到“常规 → 桌面与窗口”，改名“桌面偏好”，说明语言、字体缩放、悬浮球行为和窗口诊断的用途；保留实际桌面设置功能及错误反馈。
- Windows 透明主窗口调用 maximize 后可扩大到屏幕可用区域，但真实 `isMaximized()` 仍为 false，后续还原失效。管理后台和大工作区改用支持原生窗口状态的非透明宿主与原主题背景；悬浮球和小面板保留原透明窗口配置。依据为实际 Electron 44.2.0 对比验证及 [Electron 透明窗口限制](https://www.electronjs.org/docs/latest/tutorial/custom-window-styles#limitations)。
- 原生最大化、还原或系统窗口操作的状态由主进程推送，界面相应更新图标、标签和最大化边角。语言变化不会把“还原”错误覆盖成“最大化”；旧的初始读回不能覆盖更新的窗口事件。
- 大工作区首次显示时按实际原生窗口尺寸居中，避免分数缩放下的初始尺寸取整造成偏移；已保存的位置继续恢复。
- 窄窗口侧栏为长导航文字留出空间并允许换行；短窗口隐藏次要说明和页脚，保留主要导航空间。普通长按钮允许换行；表单中的复选框、单选框和滑块不再套用文本输入框尺寸。
- 两个既有窗口烟雾测试仍按旧导航断言没有 `tasks`。与现有产品保持一致：明确验证该入口存在，并继续检查完整导航列表、任务操作、主题和窗口行为，没有删除断言或忽略失败。

## 边界与兼容

- 新增的是 Desktop 内部 `window-state` 读取和 `desktop:window-state` 通知，仅包含 `maximized` 布尔值；读取限定管理后台和大工作区。仍校验注册窗口和主 Frame。
- `admin.minimize`、`admin.maximize` 只接受管理后台自身的可信 Renderer；其他窗口不能借此操作它。已有 workspace 控制路由保留。
- 窗口订阅、语言观察器及按钮监听随页面卸载释放，进行中的按钮操作抑制重复提交，失败后可重试。
- 无 wire Schema、数据库迁移、Runtime/模型执行逻辑、外部业务权限或生产依赖变化。新增 npm 脚本 `test:frontend-layout`，不升级 Electron、Node、npm 或根锁文件。

## 验证范围

验证环境为 Windows、Node 24.15.0、npm 11.12.1、Electron 44.2.0。测试使用显式 Fake Runtime/Model 和独立用户目录，不使用真实账号数据或云端模型。

本轮完整 Desktop 测试共 955 项：952 通过、3 跳过、0 失败。原先缺少 .NET 8 的 Windows Host 夹具已用项目缓存中的微软官方 SDK 8.0.426 实际运行通过；未改变系统 SDK 或降低测试门槛。

原生前端测试在 100%、125%、150%、200% 显示缩放下分别验证：

- 21 个设置页；1120×760、800×600、600×400 等窗口尺寸；100% 和 130% 字体缩放；深色与浅色主题。
- 模型编辑展开、管理后台和工作区窗口按钮、系统最大化/还原事件、键盘操作、真实桌面偏好入口及中英文控件标签。
- 每档 112 个布局场景，累计 448 个场景；内容和导航无非预期水平溢出，窗口控件没有重叠或裁切，页面脚本错误为空。
- 后台关闭后 Runtime 仍可读取，工作区关闭不结束应用；悬浮球原生拖动专项复测通过。

另实际通过：项目 build、Desktop typecheck、架构检查（3 项），以及原有 Electron、桌面偏好/持久化、大工作区、文字聊天、Runtime Application 烟雾测试。未以这些结果代替全部实体多屏设备或真实 AgentArts 云业务验收，也未宣称根级 `npm run check` 已运行。

### 复现

先使用 `.node-version` 和根 package.json 指定的 Node/npm，并按实际工作树构建依赖；Windows 完整测试需要 .NET 8 SDK。

```powershell
npm run build
npm run typecheck --workspace=@personal-agent/desktop
node --test --test-concurrency=4 apps/desktop/test/*.test.mjs
npm run check:architecture

$env:PA_FRONTEND_TEST_SCALE = '1.5' # 分别设置 1、1.25、1.5、2
npm run test:frontend-layout --workspace=@personal-agent/desktop
```

新增原生测试自行创建独立用户目录。运行其他烟雾测试时也应使用独立目录；不要把真实用户配置、数据库或测试缓存加入 Git。

原生测试输出在 `apps/desktop/.cache/frontend-layout/receipt-*.json` 及同目录截图。实现过程与最后一次完整回归日志位于本工作树 `.cache/frontend-*.log`，均为本地忽略文件。最后一次完整回归另校验前后源文件哈希，避免使用正在变化的源码作为最终验收依据。

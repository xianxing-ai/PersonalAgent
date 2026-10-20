# Desktop 点击反馈与界面层次优化

日期：2026-10-20。目标 Profile：`huawei_ict_agentarts`。模块：MOD-11/12/13 前端。
基线：`9eb2fb08505af94eb7bdee0c041973bf22422822`。
分支：`codex/desktop-interaction-polish-20261020`。
工作树：仓库内 `.worktrees/desktop-interaction-polish-20261020/`。
任务 ID：`DESKTOP-INTERACTION-20261020`；需求关联 PA-001、PA-002 的现有界面体验。
实际执行者：Codex。本地实现和自审，按用户后续授权提交 PR；不执行合并。
负责人身份与独立协作者批准不由执行者代签；模块整体不据此标记 done。

## 问题与变化

- 多数按钮缺少连续的悬停、按压和键盘焦点反馈。新样式统一短过渡，禁用按钮保持静止，原生窗口按钮不缩放。
- 侧栏选中项与普通项差异较弱。增加选中标记、轻边框与层次，整理搜索框、分组、卡片和表单间距。
- 设置导航直接切换且保留前页滚动位置。路由改变同步展示内容并回到顶部，附加 160ms 淡入；快速切换取消前一次动效，同页快照不重播。不等待动画，不推迟或重发 IPC。
- 普通快照会重建常规和外观页，导致按住 Space 时丢失当前控件。仅在内容与偏好未变化时复用原节点及原监听器；其他页面仍沿用原更新规则。
- 既有降低动效规则会给所有节点设置非零 transition-duration。新规则覆盖容器和伪元素，系统／应用两种设置均移除过渡及按压位移；动画中启用降低动效会取消导航淡入。

生产接线：`src/app/index.html` 加载 `interaction.css`；`features/admin/view.js` 消费 `ui/page-motion.js`。
只改 Desktop 界面、测试和本模块说明。不新增依赖、IPC、公共协议、迁移或 Runtime 路径；不改变任务终态、审批、凭据及云端调用规则。

## 验证

环境：Windows，Node 24.15.0、npm 11.12.1、锁定 Electron 44.2.0。
工作树独立安装锁定依赖；Electron 复用已安装同版本的二进制副本，两份 EXE SHA-256 相同。

| 检查 | 结果与证据 |
| --- | --- |
| `npm run build` | 通过；构建依赖，未改生产源码 |
| Desktop `typecheck` | 通过 |
| `npm run check:architecture` | 3/3 通过；`.cache/architecture.log` |
| `PA_INTERACTION_UI_TEST=1 node --test apps/desktop/test/interaction-polish.test.mjs` | 通过；真实 Renderer/CSS、显式离线 IPC。验证普通快照保留焦点、Space 单次激活、快速切页、同页不重复动效、系统／应用降低动效、深浅主题、12 组布局；0 pageerror |
| `node --test apps/desktop/test/admin-evidence-revocation.test.mjs apps/desktop/test/capability-status.test.mjs apps/desktop/test/private-memory-render.test.mjs` | 最终代码 14/14 通过，保持 Evidence 迟到回执、页面卸载、能力目录及记忆页原有行为。`.cache/interaction-regression.log` |
| `npm run test:frontend-layout --workspace=@personal-agent/desktop` | 22 个入口、117 组原生 Electron 布局检查通过；窗口控件、桌面偏好通过，0 pageerror。`.cache/frontend-layout.log`，`apps/desktop/.cache/frontend-layout/receipt-system.json` |
| `npm run test:smoke --workspace=@personal-agent/desktop` | 通过；面板展开／收起、分组拖动、菜单、SDK 提交／取消、窗口关闭隔离和 preload；0 pageerror。`.cache/electron-smoke.log` |

浏览器截图：`apps/desktop/.cache/interaction-polish/appearance-light.png`、`appearance-dark.png`，均已人工检查。
Electron 检查使用独立 userData 和显式 Fake Runtime，仅用于验证本机窗口和消费方，不构成 AgentArts 或真实账号验收。
华为平台不能直接观察本机 Windows 点击、窗口、字体缩放，本工作包按本机设备验证边界执行；未上传源码或用户数据，未调用付费模型。

完整 Desktop 回归的首次沙箱运行：1333 项，1223 通过、100 失败、10 跳过。
日志：`.cache/desktop-tests.log`。其中发现偏好读取越过页面范围导致的局部回归，已收窄到外观页；大量其余失败包含沙箱临时文件 rename EPERM。

正常权限完整复测：1333 项，1319 通过、5 失败、9 跳过，日志 `.cache/desktop-tests-native.log`。
随后修正 4 个前端回归：无 Web Animations 的轻量 DOM 不注册动效监听器；动画能力检查先于 DOM 偏好读取；常规页不额外读取仅外观页需要的本地偏好。最终上述三个相关测试文件 14/14 通过，新增浏览器交互测试再次通过。没有放宽断言或修改原测试夹具。

剩余一项为 `windows-host-fixture.test.mjs` 要求稳定 .NET 8 SDK；本机仅安装 9.0.305 与 10.0.401。已在未修改的根工作树 `main@9eb2fb08` 单独运行同一测试，复现相同 `Windows HostFixture requires an installed stable .NET 8 SDK`。未安装 SDK、未跳过该失败、未改 Windows Host；完整套件不宣称全绿。最终定向修正后未再重复全量套件，相关文件与界面专项均已复测。

## 预览与交付边界

独立预览沿用产品默认 Competition Profile，启动命令 `npm run start:desktop`。
`PA_USER_DATA_DIR` 指向本工作树 `.cache/preview-user-data`，未复制私人凭据或污染根工作树原会话。
日志：`.cache/preview.stdout.log`、`.cache/preview.stderr.log`。实际启动为 `configuration_required`：界面已启动，AgentArts/Live/SIS 均未配置；不宣称云端可用或静默切换 Local。

原运行版本与其他协作者的工作树保留。用户已授权提交、推送及创建 PR，未授权合并。
当前本机 GitHub 身份为 `2511375597-lab`；拟审查 `zemeng5208`、拟合并 `Potatos498`（均待实际接手，不代签批准）。
需独立协作者评审及正常 CI 后才能合并；实际提交、PR 编号、批准及检查状态以 Git/PR 为准。

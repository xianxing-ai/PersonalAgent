# 黑白亚克力主工作区与真实连接卡（review）

提交前基线已同步到 main a8f43d8b，分支为 codex/workspace-command-center-20261022。用户要求参考七张截图调整：删除单独的协作导航入口，连接器默认显示为右侧小卡片，顶部扩展成整条星空横幅，左侧改为 Codex 式侧栏并按真实状态排列主对话派生的子智能体／分对话。原主体亚克力和简洁输入框保留，首次打开默认深色，已保存的浅色或跟随系统选择仍有效。前期先运行本地预览；用户随后授权检查、展示最终画面后提交 PR。此前版本已保存到工作树的忽略缓存备份，其他旧预览工作树和数据保留。

## 最新同步与分对话语义修正

- 2026-10-22 fetch 后从 c15855f5 快进至 ca093481，保留新合入的玻璃小面板及安装更新。全部当前修改已先作文件备份与 Git stash 快照 cdf65f8f3c023171f2648d97841569d86bfaef0d，保留在忽略缓存和 Git 中；未创建普通开发提交。唯一入口样式冲突已同时保留新 panel-glass 顺序与 command-center 样式。
- 按主线要求重新完成 npm run build。新小面板采用透明裁剪窗口，与大工作区最大化不兼容；工作区恢复独立的原 DWM 材质绑定 workspace-material.js，保留主线的小面板裁剪实现，实际最大化／还原回归通过。
- 光晕改为与球面同一中心，轨道从 3 条增为 6 条，新增轨道亮度分层。首次未保存主题时默认为深色；手动 light / system 选择保留。
- 左侧按派生任务 goal 命名为分对话，删除前缀“[任务执行]”，Role 仅作为无 goal 的回退。不再用“研究助手／执行助手”作为示例身份。宿主按当前工作区主会话的真实父任务筛选子记录，切换主会话时恢复主对话视图；派生分对话仍使用原 taskId / parentTaskId、Runtime 和独立草稿。
- 65 项定向测试、最新主线上的独立子对话烟测、5 种尺寸与默认深色、黑白实际窗口烟测通过。日志 main-sync-refinements-unit.log / inline.log / sizes.log / window.log；之前透明窗口参数导致最大化等待失败的首次日志未作为成功，修改专用材质绑定后原烟测通过。
- 用户随后提供 AgentArts 网关、运行时、精确 WSS 和两项凭据，并授权配置及最小真实测试。通过原 agentarts.configure 在启动器 profile .cache/desktop-user-data 加密保存，凭据未写入源码、测试或文档。真实模型目录返回 177 项，默认主／子模型选择目录默认 deepseek-v4.1-flash，本地待办已就绪。随后按用户指定的青岛和自主配置要求接入天气、只读 Obsidian 与两项 RSS，详见末尾实测；邮箱账号仍缺少，未伪造连接状态。

## 实现边界

- 左侧采用窄文字侧栏，保留新建主对话和历史管理的原会话绑定；移除单独协作和连接器导航图标。子智能体按“进行中／已结束”分组，展示独立符号、角色和实际状态，不截断为六条，也不把失败或取消显示为成功。中央模型选择器、默认主／子档位和保存逻辑保持原实现。
- 连接器默认显示在主页右侧，每张小卡片沿用原天气、待办、邮件、知识、订阅与通知数据和状态；点击或键盘激活进入原连接设置。没有自动新增授权或真实账号读取。小于 1000px 时提供卡片按钮，小于 760px 时提供侧栏按钮；布局适配不挤压输入框。
- 顶部展示 PersonalAgent、标语和原粒子球，新增细轨道、轨道节点和球面边缘高光，仅更改样式，不改变亚克力背景或球体运行状态逻辑。黑球白粒子／白球黑粒子及跟随系统偏好仍保留。
- 球体参考散射效果补充：仅工作区启用 luminous 外观，球面由 170 增至 520 个细点，沿原 Orb 帧循环绘制外围尘粒；原小面板和常驻悬浮球保持默认外观，背景、滑块和任务状态不变。第一轮增亮与散射验证日志为 orb-bloom-unit.log / orb-bloom-ui.log / orb-bloom-window.log。
- 根据“缺少科幻感”反馈进一步加入：球面反射明暗、不均匀高光和自然粒子分布；轨道在同一 Canvas 分前后两次绘制，由不透明球体遮住远侧路径；移动节点具有短拖尾、星芒与衰减光晕。320 个外围尘粒和透明局部流线仅围绕球体绘制，不覆盖整个页面背景。全部动效复用原 Orb 循环，静态模式冻结，隐藏／卸载继续停止和释放。10 项原生命周期／动效／缓存测试、黑白实际窗口与子对话检查、5 种尺寸检查通过；日志 orb-depth-unit.log / orb-depth-ui.log / orb-depth-window.log / orb-depth-sizes.log。仍仅本地预览，未提交 PR。
- 最新要求明确将星空渲染扩展到顶部整条区域并再次提亮：hero-starfield.js 以分形光雾、全宽星尘、星芒和跨幅细光带组成透明程序化场景，横幅底色单独加深，标题背后遮光；球体与光带亮度分别增强到 1.4 / 1.45 倍。下方亚克力、会话／输入框及滑块仍复用原实现，浅色主题反色适配。场景仅在尺寸变化时重绘，隐藏时取消待绘制帧，卸载释放 observer 和监听；缓慢 CSS 光雾呼吸服从原减弱动态偏好。14 项定向测试、真实黑白窗口与子对话、5 种尺寸检查通过，日志 cosmic-banner-unit.log / cosmic-banner-ui.log / cosmic-banner-window.log / cosmic-banner-sizes.log。测试最初误将共享“直接移除动画”策略按暂停状态断言，已改为验证没有运行中的动画，未改变原减弱动态实现。
- 大工作区复用 panelWindowAppearance / bindPanelMaterial：支持的 Windows 开启原生 Acrylic，不支持、降低透明度或高对比度时沿原实现退回可读底色。球体画布整张只反色一次，包含现有呼吸与错误状态，避免白色主题球心仍为黑色。
- 中央默认主对话。点击左侧子智能体在中央显示原始任务与回答、已有追加消息及原发送／停止控件；点击主对话恢复原输入。每个嵌入视图保持不可变父子任务身份，保留独立草稿。缓存最多 12 个，只回收没有草稿和在途写入的视图；迟到反馈仅更新其原视图。
- 新增 Desktop 私有 workspace.subagent.snapshot / submit / cancel，由可信工作区主 frame 调用。每次读取校验原父子任务关系和返回身份，发送／停止继续复用原宿主 submitChildConversation / cancelChildConversation。窗口关闭后的迟到读取不能再产生写入。普通生产 Local 没有新增执行能力。
- 私有 workspace.appearance 只同步已验证的 dark／light／system 外观，不接触配置凭据或任务执行。未扩展 Preload 的通用桥权限，没有新增 Runtime、模型入口、任务库、依赖、公共 Schema 或数据库迁移。
- 原应用授权问题继续由 renderer 挂载，普通审批卡过滤已关联的统一问题，保留 revision／过期／去重保护。主对话草稿、输入法和关闭前保存沿用原 session-controls。

## 验证

### 最新主线与 PR #491 滑块复用复核

- 2026-10-22 重新执行 git fetch origin，HEAD 与 origin/main 均为 c15855f5ccceb76d6bf794203d9ebfbe9cb83cb3，左右差异 0/0；当前 UI 修改仍是该最新主线之上的本地增量。
- PR #491 已合并，精确 head 为 451f0264de672d630ebdae9e632133d777a53587，且为当前 HEAD 的祖先。model-thinking-picker.js、shared/thinking-selection.js、conversations.js、agentarts-model-settings.js 与该 PR 内容相同，直接复用，没有复制第二个滑块或改写档位映射。原消息定位条亦保持可见。
- 36 项偏好／会话／定位／授权集成定向测试首轮 35 通过、1 项因 AppContainer TEMP 的原子 rename 报 EPERM；普通用户环境原文件 4/4 重跑通过，未改断言，也不把重试累计为 40 个独立测试。
- PR 原 Renderer 烟测通过，覆盖全部模型搜索、原生枚举、保存失败与重试、部分保存、Fast、Escape、251px 深浅主题和工作区设置；桥为显式合成。
- 扩展 PR 原产品烟测：实际 Electron / Preload / Runtime 通过鼠标拖动与松手保存、原会话文件读回、新工作区提交；6 次合成 AgentArts 请求分别携带所选 high / max，主／子默认配置不变，外部意外请求和页面错误为 0。该结果证明产品参数链路，未冒称真实云模型效果。
- 日志：.cache/pr491-function-unit.log、pr491-default-user-test.log、pr491-renderer.log、pr491-mouse-product.log；截图和结果为 .cache/pr491-picker-renderer/、pr491-picker-mouse-submit/。
- 后续已使用用户提供的真实 AgentArts WSS 做两次独立最小文字测试：首轮测试脚本错误假定原生枚举顺序，实际保存 none，返回 OK；修正脚本为读取原 nativeReasoningState 的公布顺序后，鼠标拖动 high、松手保存、发送前读回 high，真实任务 63f790b2-54b1-4428-8867-fb58eb40fc96 成功返回 OK。未改变 PR #491 原档位映射。响应继续标注 verification=unverified，不将返回文本或已保存参数冒称云端原生推理效果的独立证明。脱敏回执在忽略目录 .cache/real-agentarts-minimal-receipt.json 与 real-agentarts-high-receipt.json。

### 工作区功能入口补齐

- 思考入口明确标注“思考”，仍只有原 PR #491 的一个滑块。权限按钮打开原安全页，显示可信宿主选中的只读／工作区写入／完全访问模式；有待批准时另有定位按钮，沿用原提问卡及普通审批卡。
- 新增 Desktop 私有 workspace.live.toggle，只接受 Competition 的可信主工作区 main frame 和无 payload 请求。未确认音频用途时打开原语音设置；已配置时调用原 toggleLive，采集、播放、对话归属、停止和审批仍由同一个面板 Live 宿主管理。界面明确提示在原语音面板开启，不暗中转换工作区对话。
- 修正 openAdmin 页名白名单遗漏 voice，避免原语音入口打开后台却停在其他页。配置 AgentArts 不会自动勾选音频同意，也不会开启麦克风、持续监听或启动问候；真实音频对话尚未验收。
- 新宿主入口、工作区审批和状态投影定向测试 11 项通过；Desktop typecheck、架构检查、原 PR #491 实际 Electron 合成请求回归、五尺寸布局及草稿／提交／停止回归、原黑白原生窗口烟测通过。真实 profile 重启验证密文配置读回、权限选择、拒绝非法来源及 payload、Live 正确进入语音设置，页面错误 0；权限测试后恢复只读，未授予工具操作。全量根 check 未运行。
- 当前保持真实 Competition 窗口运行，已新建空白主对话供试用，没有注入演示子智能体。截图 .cache/real-connected-preview.png，脱敏回执 .cache/real-connected-controls-receipt.json。

### 布局及原有交互回归

- 独立锁文件安装、全工作区构建完成；本轮 Desktop typecheck、新模块语法检查及 git diff --check 通过。构建与模拟测试不提升 provisional／unavailable 等级。
- 69 项定向测试通过：会话入口、主／子任务归属、子对话读取／写入参数、关闭与迟到反馈、审批、实际活动投影、子智能体分组与 Acrylic 回退。
- 实际 Electron 五种尺寸通过：1500×940、1200×800、900×800、600×780、420×780，验证模型浮层、输入和按钮边界、草稿切换、改名、连接器、原 IPC 提交／停止和任务详情，页面错误 0。
- 单独实际 Electron 测试使用显式合成子对话端口：验证主对话／两子对话切换、三份独立草稿、按原绑定发送和停止、迟到读取不覆盖另一对话，以及拒绝其他窗口和其他子任务。此测试不代表真实 Runtime 子智能体闭环已执行。
- 原窗口烟测通过：黑白外观、最大化／恢复、粒子球、设置主题、原小面板会话及原生截图。架构检查 3 项通过。
- 原 Runtime Application 组合烟测通过：7 次合成模型请求、2 次取消。未调用真实模型、云平台、麦克风或外部账号。
- 此次左右栏调整的回归日志位于忽略目录 .cache/：sidebar-unit.log、sidebar-layout-ui.log、sidebar-inline-ui.log、sidebar-window.log，全部通过。五种窗口尺寸还覆盖窄窗口的左右栏展开／收起。原生球体点击检查发现通用 active 位移和装饰层影响命中，已固定球体按下定位并限制装饰层命中，重跑原窗口烟测通过。
- 前轮构建、组合与架构日志：monochrome-runtime.log、monochrome-architecture.log、build.log；此次未改变 Runtime、原生窗口宿主或公共契约，没有重跑完整组合测试。截图及回执为 .cache/command-center-qa/、.cache/inline-subagent-qa/。

当前仅交付本地增量，未合入 main。真实文字模型调用与模拟回归分别记录，不提升接口冻结状态。历史三个演示子对话只在测试入口装配，生产入口不注入示例状态。后续全仓检查及真实连接验证如下。

## 真实连接、停止按钮与最终复核

- 目标仍是 huawei_ict_agentarts；本次新增仅 Desktop 私有天气配置／刷新入口和视图投影，没有新增 Provider、Runtime、任务库、公共 Schema 或数据库迁移。weather-card-host.js 用 prepareHostToolTask / finalizeHostToolTask 调用原 weather.forecast，只有原 Runtime confirmed 结果才成为天气卡内容。城市以普通配置保存，响应与证据来自原执行记录；主窗口打开时和点击天气卡均可查询，沿用原期限、Policy 与取消边界。
- 用户指定青岛。真实任务 680ed25e-d149-4d71-87d1-1b399156b116 与点击卡片任务 b165a5cf-09c8-438a-b5be-88f5445255d2 均 succeeded，并有 host-tool Evidence。重启后再次自动查询，任务 b25fbb48-9059-4713-8d49-92760c60c4b3 成功，源 open-meteo，fetchedAt=2026-10-22T13:51:03.812Z；卡片显示实际温度、范围、来源与时间，不保存演示天气。
- 通过原生知识源选择器连接现有 Obsidian 库。宿主读回 configured=true / available=true / dataLevel=private；保持只读、writeAvailable=false / cloudExportAllowed=false。卡片显示实际 displayName 并打开原 memory 设置。未将私人笔记发送云端，也未测试私人笔记内容检索。
- 通过原 feeds.add 加密保存 GitHub 官方博客和 Microsoft 开发者博客；重启读回两项订阅 available=true、requiresRestart=false。agent-reach 的 feedparser 已实际读取两个来源；额外通过仓库原 HttpFeedProvider + FeedService 再次实时验证，各解析 10 项、限量返回 2 项，transport.nativeFetch=true / credentialFree=true。该独立生产 Provider 验证不冒称主对话 feeds.collect 的整轮审批与云端汇总已执行。脱敏回执 .cache/production-feeds-receipt.json。
- 知识源身份失效和 RSS 待重启均保留真实不可用提示；待办空列表不再提示连接服务。增加“全部能力”入口打开原能力目录，当前报告 71 项；这是目录登记，不是 71 项真实账号执行验收。邮箱与 CalDAV 仍需有效账号授权，Live 仍需原音频同意与语音服务配置，不填虚构凭据或全局许可。
- 子智能体增加侧栏停止按钮和分对话顶部“停止子智能体”。侧栏先读回当前绑定的 activeTaskId，再经原 workspace.subagent.cancel；不会假定最初子任务就是当前追加执行。主会话切换废弃迟到停止请求，双击去重，不自行写任务终态。原取消反馈显示“正在请求停止”，不把取消受理冒称云端已停止。
- 编程环境通过原生选择器保存独立工作树和本机 Node，原宿主自动确定 npm；重启后 nodeConfigured=true / npmCliConfigured=true / readAvailable=true / commandAvailable=true / authorizationAvailable=true。具体读写与出机仍需当前对话提问卡。当前 checkFileConfigured=false，writeAvailable=false（原安全应用补丁的目录或 PowerShell 检查未通过），projectScriptsAvailable=false（原项目命令隔离组件尚未准备好）；没有绕过检查执行裸命令。选择器的最小化／用户输入工具错误保留，未直接改写安全配置。
- npm run check 已运行：架构、生成类型、类型检查和后续 Runtime 测试通过；Desktop 1669 项中 1658 通过、10 跳过、1 失败，失败是 test/windows-host-fixture.test.mjs 缺少稳定 .NET 8 SDK。Runtime 1073/1073 通过。全仓命令 exit=1，不能记为全绿。日志 .cache/connector-wiring-full-check.log。
- 天气宿主、连接卡、父子取消及命令中心定向测试通过（44 项首组、45 项末组有重叠，不累计成独立总数）；Desktop 类型检查、架构检查、五种尺寸布局回归通过。最新真实 Electron 分对话专项覆盖顶部停止和侧栏停止、绑定、独立草稿、迟到读回及外部窗口拒绝，日志 .cache/connector-subagent-stop-verified.log；该专项使用显式合成子任务端口，不宣称真实云子任务停止已经验收。
- 所有配置与脱敏回执留在忽略的 .cache/ 中，提交不包含用户配置。生产入口没有演示子智能体。真实音频、邮箱／CalDAV、原生编码隔离组件与完整主对话 RSS 汇总仍是未验证项。

### 提交前同步与复测

- 再次 fetch 后将本地增量完整备份并保留 stash fe2069534831d9a78912deb56b78cb448d8faf17，快进至 a8f43d8b。两处文件冲突保留主线连接器变更、自动授权过滤、麦克风策略和 environment 设置导航，再叠加本次视图及入口；没有覆盖主线新增功能。
- 最新主线 npm run build 通过；五尺寸布局、原父子绑定与两个停止入口、PR #491 鼠标／保存／IPC 参数、黑白原生窗口及最大化还原、Runtime Application 组合烟测均通过。日志 final-layout-smoke.log / final-subagent-smoke.log / final-slider-smoke-verified.log / final-window-smoke.log / final-runtime-smoke.log。鼠标烟测首次取布局坐标过早，保留失败日志；改为先等待真实滑块稳定并断言命中，原档位和持久化断言不变，复验通过。
- 在忽略缓存中准备微软官方 .NET 8.0.426 SDK，按官方 SHA512 核对后使用，不修改系统安装。此前缺 SDK 的 Windows HostFixture 已通过。完整检查的另一项原生测试因默认身份组件位于待测仓库内而被正确拒绝；将同一已构建组件复制至工作树外并核对 SHA256，使用原 PA_TEST_JOB_HOST_EXE 测试入口，原用例通过，不修改生产路径隔离或断言。首次失败分别保留在 final-main-check.log 与此前日志。
- 同步后的真实 Competition 窗口已读回：青岛天气任务 adc17428-1e3a-4d2b-bd38-35108c83ca41 succeeded，Open-Meteo 获取时间 2026-10-22T14:24:38.553Z；知识源只读、两项订阅可用、Node/npm 已保存，页面错误 0。当前目录报告 94 项能力（随已绑定编程工具变化），不等于 94 项已实测。最终截图与脱敏状态为 .cache/final-connected-preview.png / final-connected-receipt.json。
- 最后完整 check 中 Desktop 为 1802 项（1793 通过、9 跳过、0 失败），Runtime 为 1155/1155；架构、契约、生成类型和类型检查通过。显式启用真实原生宿主后，PSEC 的取消探测在并发套件下出现一次 native-verify-token:-2146233079，导致该次 npm run check exit=1；没有删除断言或隐藏失败。原设备用例单独重跑 7 通过、1 平台门跳过，完整 coding-tools 串行重跑 319 通过、1 平台门跳过、0 失败；缺失的跨模块集成阶段另行执行 52/52 通过。日志 final-complete-check.log / final-native-sandbox-isolated.log / final-coding-serial.log / final-integration.log。不能把含失败的原完整命令写成一次全绿；原生并发波动需在 CI 继续观察。

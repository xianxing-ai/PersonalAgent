# P8 原生来源与恢复桥

<!-- current-design-20261009 -->
> 当前目标与协作规则（2026-10-09）：[完整设计](../design/resident-developer-agent-20261008/DESIGN.md) · [离线阅读/全部 SVG](../design/resident-developer-agent-20261008/index.html) · [两人确认与本机阅读门槛](../reviews/DESIGN_READING_GATE.md)。WSS 主通道、HTTPS 备用；Wiki 记忆由 goo122 接入。goo122 与 Potatos498 均确认后才可按授权合并，禁止强制合并/管理员绕过。设计不等于已实现；本文历史验收与作者记录保留，旧合并规则以当前门槛为准。

> 维护入口（2026-10-07）：项目主要负责人为 zemeng；当前分工以 [模块分工](../../docs/MODULE_ASSIGNMENTS.md) 为准，最新状态见 [ROADMAP](../../docs/ROADMAP.md)。历史日期、作者和验收结论按原记录保留。

目标 profile：`huawei_ict_agentarts`。本增量只修改 Desktop 可信宿主与管理员入口；Runtime portable 源码仍由 Runtime 工作包负责。

## 参考 Skill 历史 Evidence

`ownsDesktopReferenceSkillTask(application, namespace, task)` 对照原 `application-reference-skill-v1`、完整 intent SHA 附件、`desktop-skills:<namespace>` 和原 `desktop-reference-binding-v1`。不依赖当前 MCP 连接，因此撤销参考服务后仍可通过现有管理员 EvidenceReader 读历史脱敏元数据。其他窗口、其他 namespace 或缺少原绑定的任务不通过。

## 订阅来源与原生选择

- `feedsHost.readSourceBinding(subscriptionId)` 是 host-only getter。返回来源、namespace、配置 SHA、generation、provider、协议、地址 SHA、是否含查询参数/凭据、分类和当前可用性。`transportVerified` 固定为 `false`，不把配置或 HTTPS 解释为真实获取证据。
- `prepareNativeSourceChoice({subscriptionId, taskId})` 只给原生对话框提供实际配置地址和真实任务绑定；地址不进入 Renderer、云端或 Evidence。
- `applyNativeSourceChoice(choice, classification)` 只能从可信主进程消费原生选择；前后重验配置 generation、原任务 conversation 与期限。含查询参数的来源保守拒绝公开分类。默认保持 private。
- 公开分类保存在原加密订阅配置中。分类变更会取消旧会话、重建原连接器实例与 generation，外部 Gateway 仍使用原 wrapper/descriptor；旧 task 绑定失效。实际分类通过新 FeedService 读取，不能只改显示值。添加/删除来源仍按原目录重启要求。
- 精确跟踪 grant 保存在原 Runtime SQLite 的 `knowledge-tracking` host store，键使用 `feed-source-grant:` 前缀；绑定 namespace/source/config/task/conversation/用途 SHA/expiry/revision。显式撤销或配置变更会持久撤销，普通关闭只关闭会话读取许可。成功的原 intake task 在期限内仍可使用原许可；失败、取消、用途改变或超期均拒绝。
- `readTrackingGrant({namespace, sourceId, taskId})` 缺任一绑定时返回 none。现有 P7 仅 namespace/source 的查询不足以消费该许可，必须由知识工作包用原任务真实绑定接线。不得改成整个 namespace 的 blanket grant。

真实 fetch receipt、来源获取时间/传输证明、完整内容与 citation 由 feeds Provider/Service 工作包提供；本 getter 不签发这些事实。

来源 getter 只使用公开 `feedConfigBinding(actualSubscription, actualProvider.source)`，没有该接口时 unavailable，不将 host 自定义哈希冒充 Provider schema。实际 page 返回后，可信 wrapper 调 `assertFeedSourceReceiptMatches` 校完整 page/config；保留原 transportFetchedAt 和逐项 citation，304 不生成新收据。`trackRevisions:true` 接原 connector；暂停/撤销前后均挡住 fetch。

`main.feedCollect` 在正式 Gateway host read 确认后保存 `feed-confirmed-read:<receiptId>` 元数据，绑定知识宿主的 receipt 容器到实际原 feed task/run/version；不在该索引复制正文或凭据。同步 `readFeedReceiptEvidence` 通过公开 `createKnowledgeFeedReceiptFromConfirmedExecution` 从原 intent、ToolRecord、结果 checkpoint 和真实 Evidence 重建，再核 receiptId。缺公开 helper/原证明时不补造证明；partial/304 没有新正文 receipt。相同 receipt 保留最初执行绑定，重启后只读核实，不再执行工具。

## 记事本原始执行核实

- `pendingTasks` 直接分页读取原 Runtime `waiting_reconciliation` host 工具任务，重启后仍能列出原 taskId。
- 新写入会在存在待核实原任务时拒绝。核实 IPC 仅管理员可提交 `{taskId}`；UI 不能指定 run、结果、HostResult 或授权。
- `recoverOriginalRun({taskId, runId, argumentsDigest}, {deadline, signal})` 是 host-only 端口。验证原 `host-tool-intent`、完整参数 digest、Policy 允许且实际执行的 ToolRecord、原 Windows attempt 与 target；读取前后重验绑定、状态与期限。仅调用原 adapter 的 `recover(taskId, runId)`，不调用 execute，不签新授权。
- `recover` 需要注入正式 Runtime reconciliation callback。没有该 callback 时 `recoveryAvailable:false`，按钮禁用。Runtime 应负责 HostResult Schema 验证、独立读回 Evidence、原 record 核实与终态；`in_progress` / `not_found` / 结果未知不能 immutable-pin unknown。

2026-10-05 P6 状态反馈补充：可信 reconciliation 返回 `not_applied` / `host_result`，
且原 Runtime 任务已失败或取消时，显示已核实未写入与该终态。`already_terminal`
仅表示任务已结束，不能作为原生未写入证明；没有匹配的 confirmed 结果/Evidence
时说明写入仍未确认。只有仍待核实的原任务继续显示“保留待核实”。所有恢复分支
只读原执行，不调用 execute、不签新授权。Node 24.15.0 的宿主测试15/15通过，
包括11种确认/失败/取消/终态和未核实组合；真实Windows UIA恢复仍待集中验收。

## 工作区程序发现与执行前隔离

2026-10-05 接续 goo122 在 #289 提供的 Windows 中文安装现场：
`where.exe` 输出按 UTF-8 解码后包含替换字符，原 PowerShell 路径无法找到。
可信主进程现在直接按宿主 Unicode PATH 顺序定位固定的 `pwsh.exe` / `git.exe`，
不调用定位子进程、不猜测代码页、不隐式搜索当前目录或 PATHEXT。
仅搜索本机绝对目录；合法安装链接与 8.3 别名仍通过原生 realpath 解析到同名常规文件。
第一个已存在候选若无法安全解析，不继续选用 PATH 后项。

在任何 PowerShell 恢复目录 ACL 设置之前，排除工作区、原恢复目录以及这些已存在目录的
canonical 别名，同时检查原候选与 canonical 文件。目录解析权限错误拒绝发现；
仅尚未创建的恢复目录保留原路径排除。原编码配置、恢复目录哈希、
helper 字节/identity/ACL 校验、Node/npm 原生显式选择与工具授权链不变。
离线路径/固定 GBK 字节回归只能证明发现与拒绝行为；真实 Windows Unicode 临时文件、
启动零执行门控及 goo 的原失败现场仍需分别回写精确提交证据，未运行不记通过。
Node 24.15.0 定向 discovery/workspace-config/workspace-command 共65通过、0失败、
2 Windows 门控跳过；另两项合成 coding/Notepad 验收通过，原 coding-host 的
6项 Windows 测试在 Linux 跳过。生产宿主语法和差异空白检查通过。

## 2026-10-05 续接：公开工作区命令工厂与控件

公开 recipe 工厂在每次 available/execute 前复核固定工作区的 bigint dev/ino/birthtime，
原路径被另一目录替换即拒绝，不以目录 mtime 锁住正常源文件修改。
此目录身份缺口限定公开工厂自身：正式 workspace-config-host 原有外层检查已经拒绝该替换。
每次同时重新验证原 node-check 文件及祖先路径仍为工作区内普通、无链接的同一规范相对目标；
缺失、目录替换和文件/祖先链接均零命令委派。检查文件内容不固定哈希，正常编辑后仍可检查。
修复前临时目录加明确 Fake 工厂能复现目录替换及四类检查文件变更仍放行；
这不是真实命令执行，也不能称为任意代码执行。Node 24.15.0 的受影响三文件测试
54 通过、0 失败、1 Windows 原生门控跳过；Desktop typecheck、语法及差异检查通过。
原 Windows 普通用户设备/现场命令验收仍待持有环境的协作者读回。

本轮按钮优化仅调整登记的 app/surfaces.css 与 desktop-settings/settings.css 控件规则：
普通按钮统一最小36px高度、9px圆角、13px字；授权主操作与撤销次操作区分，
禁用/aria-disabled 状态不接受旧 hover/active 动画，键盘焦点保持可见；
编码及窗口恢复按钮以8px真实间距换行。特殊窗口、悬浮球、图标与发送控件尺寸保留。
AgentArts 按钮组移除被原页面 style-src self 拒绝的内联样式，使用外部 CSS；
保存主操作、清除凭据危险次操作仅改变 presentation class，原事件、文案与权限不变。
720px以下主工作区上下排列对话/连接器及详情：480px原对话宽226px变为478px，
切换、刷新、详情关闭和各区独立滚动保留；1280px深浅主题几何保持原值。
实际入口使用 Chromium151/Playwright（Browser plugin unavailable）与明确合成宿主，
检查1280/480、深浅主题、等待互锁、焦点、保存/撤销读回及模型菜单；不是 Electron/云验收。
18个稳定 panel/admin/workspace × dark/light × regular/thin/thick 的计算材质快照严格相等，
包含背景、边框、blur/filter、阴影、容器圆角、clip/isolation和玻璃变量。
新增响应布局/配置页面16组材质及控件身份前后也严格相等，浏览器无控制台错误。
等待原主题过渡收敛后比较，未降低断言或修改材质。
三页控件类型、顺序、文案、标签与SVG相同，body innerText只有flex排版换行差异。
设计图生成的额外纹理、亮边及阴影有意不移植；原玻璃、系统字体与原SVG是权威。
上述浏览器材质验证不等于原生 Windows 壁纸合成验收，整包状态继续 review/验收待续。

## 公开参考资料原生许可

`public-reference-consent.js` 管理内存中的精确原 task/proposal/path/config/fullargs 许可。`requestPreflight` 经原生窗口确认 PUBLIC 来源与目的，不要求未发生的执行 SHA；真正 Gateway 读取完成后，`requestExact` 通过 P6 的 strict confirmed getter 获取原 run/SHA/字节数，再原生确认该内容出机。同步 `readPreflight` / `readAuthorization` 只读该许可，并重新核配置、真实任务、取消、期限、参数与原确认结果；不签工具执行授权、不造 Execution/Evidence、不读文件或向 Renderer 返回正文。

Main 的 `prepareCompetitionToolExport({phase:'preflight'|'projection',taskId,proposal,deadline,signal})` 消费这两步，P6 options 注入公开 3.0 工厂和同步 reader。Runtime 必须在原 parsed pending 持久后调用 preflight、原 confirmed result 持久后调用 projection，并在真 I/O 前以原 projection 做 final 重验；缺 Runtime 正式 hook / P6、MCP 原 candidate 时保持 unavailable。app 关闭清许可，重启需新原生确认。MCP 与 Skill source alias 的 Native adapter 到齐后接入相同路径，不能混淆 Skill 与 Competition MCP run。

## 当前验证范围

六个修改的 JavaScript 文件通过 `node --check`，差异通过 `git diff --check`。未运行阶段测试、Electron、F9、云模型或新的原生产物构建。新增原生入口、真实来源跟踪及 Runtime 恢复消费待完整组装后统一验收。

# 桌面集成复验（2026-10-25）

## 2026-10-26 邮件首读基线 UI（晚于 A11）

新增 `mail-baseline-ui-20261026.json` 与原始 `mail-baseline-ready-20261026.png`、`mail-baseline-narrow-20261026.png`；三者按独立白名单与禁止覆盖复制清单处理。JSON 绑定 Root 当前五文件 SHA：Desktop typecheck exit 0、文案前聚焦 68/68、最终文案 17/17。

已安装 Edge 加载真实 Renderer/Admin/邮件控件/CSS，Main `mailSnapshot()` 经 AST 回放；五状态、停止／核实优先级、草稿焦点与 600px 布局通过。另以原 WatchHost／MailTriageHost／Runtime-Policy-ToolGateway／ChangeHost 和 Main AST 核对同一 watchId 的首读、后续事件及撤销／过期，QQ/Laya/审批为显式 Fake。页面 IPC 也为合成；不代表真实邮箱、完整 Electron 生产 IPC、云模型或 OS 通知。A11 整仓 6,145 通过／29 跳过早于这五文件。

本轮使用真实 Electron、Runtime Application 和 SQLite 检查现有自定义模型兼容入口。模型为回环 HTTP 夹具，7 次请求、2 次实际中断；不代表真实盘古调用、AgentArts 云端质量或新增 Local 功能。默认 Competition 的真实 45 步开发及电脑／视觉回执继续按原来源单列。

窗口关闭时，快照发布器在 `closed` 事件再次读取已销毁窗口的 `webContents`，触发原生异常弹窗并阻塞后续 IPC。现在捕获创建时的 emitter 并释放其监听器；销毁事件、刷新检出销毁和整体关闭三个反例先失败、修复后通过。实际窗口关闭、重开和正常退出均通过。

同时修复模型停用和退出保护提示被泛化的问题，继续只公开审核过的固定文字，额外私人内容保持脱敏。现有 `provider=pangu` 的按钮显示可信宿主模型名称及停用状态；调用路由与权限未改变。

邮件监测的异步准备现在由短生命周期的宿主控制器绑定当前设置意图。停止、撤销、设置窗口关闭和应用退出立即使旧准备失效；不会停止其他功能共享的 Laya。配置更新期间，新启动和手动批量读取均被拒绝，重新打开设置也不能使用旧配置。停止与撤销按钮在准备期间可用，迟到响应不能覆盖较新的界面状态。

停止请求按原 `watchId` 去重，主对话切换不会创建第二个待批请求。原停止可能已禁用本地 watch 但结果仍为 unknown，此时继续返回原 `waiting_reconciliation`，不重做写入或改写原记录。后来新建的另一项 watch 使用独立身份，仍能单独停止。原 Runtime、Policy、ToolGateway 和 SQLite 的聚焦组合为 83/83；安装的 Edge 执行真实 Renderer 加合成 IPC 的渲染组合为 6/6。Main 邮件分支通过 AST 提取接合成服务验证，尚未声称完整生产 IPC 的真实邮箱验收。

- `runtime-application-ui.json`：实际 UI 操作、原失败日志 hash、当前源码 hash、聚焦检查及证据边界。
- `runtime-application-workspace.png`：修复后原窗口截图，已逐图查看，未编辑；模型名称与宿主一致。
- `combined-verification.json`：第七轮冻结源码组合检查，6,037 pass／29 skip／0 fail；早于邮件准备与跨对话停止修复。
- `mail-monitor-lifecycle.json`：邮件准备、配置更新、跨对话停止的精确任务状态、原失败日志 hash、源码 hash 及渲染边界。
- `mail-monitor-starting.png`、`mail-monitor-configuring.png`、`mail-monitor-settings.png`：真实 Renderer 的原始截图，使用合成 IPC 和公开测试文字，已逐图查看。
- `native-window-panel.png`：原生 Electron 窗口烟测的原图；该检查显式使用 Fake Runtime。
- `workspace-native-ui.json`、`native-workspace-dark.png`、`native-workspace-light.png`：工作区黑白主题、最大化／还原、主面板切换与对话控件复验；12 项 shell 状态、零页面错误及实际桌面合成原图。沿用原工作区 smoke 的断言，只在隔离副本修改输出位置并补首个失败日志；显式 Fake Runtime，不代表连接器实际调用。
- `vault-first-start.json`：第九轮之后实际生产首启巡检发现的 Vault 准备态修复。保留两条先失败回归、7 pass／2 skip 聚焦结果、Desktop 语法检查及非 Fake 生产界面的正常重开读回；四份新增量源码 hash 单列，第九轮全检不覆盖它们。
- `first-start-authorization-20261026.json`：后续首启能力目录、原任务投影及旧授权提示的增量。聚焦 30 pass／1 skip，实际生产 Main／IPC／Runtime／SQLite 的 Skill 取消、安装、预览、启用、正常重开和卸载通过；两次正常退出、四条原决策和未执行的取消记录单独核对。目录选择为显式合成；原 CUA 安装读回与最新产品冒烟分别记录。
- `combined-verification-mail.json`：邮件修复后的第九轮冻结源码组合回执，6,059 pass／29 skip／0 fail，171 份源码 hash 已逐项核对。

第六轮整仓检查的三项失败均为精简的进程 PATH 漏掉已安装 OpenSSL，原 exit 1 保留；补足路径后，三项实际 HTTPS 307/308 拒绝与取消测试通过，生产模型代码未修改。另保留主线 `d702fe43` 中已合并的语音启动取消、Wake 租约到期与 Windows-MCP 兼容目标过期修复；Windows Client README 手动保留原生默认入口说明。这里只合入工作树源码，Git 历史合并仍待提交交付，不声称分支已同步主线。

第八轮完整检查 exit 0，6,058 pass／29 skip／0 fail／0 cancelled，37 组及 57 项根集成完整执行；170 份源码 hash 在检查完成后再次核对。这一轮早于跨对话停止的最后修正。第九轮最终增量为 exit 0，6,059 pass／29 skip／0 fail／0 cancelled，37 组及 57 项根集成完整执行；`2026-10-25T14:10:44Z`～`14:20:56Z`，日志 SHA `70041fdd401f33324c0d03997149ff40885a5c708cd3bbb9d29d66f20d30cf97`。83 项聚焦检查、6 项渲染检查与整仓计数重叠，不能相加为独立用例数。

第一次旧脚本的清理错误覆盖了原失败，第二次中断没有退出码。后续原生弹窗、停用错误提示和退出提示失败均保留，不改记为成功。验收脚本现保留首个失败、绑定准确原任务、验证正常退出，异常清理只针对已核实 PID／出生时间／可执行文件的自有测试进程。

`Browser plugin not available`；本轮执行仓库现有 Playwright Electron 回归，并用 Computer Use 只读检查自有异常窗口。源配置、密钥、SQLite、完整模型请求和原 profile 均不进入本目录。聚焦检查之间有重叠，不能合计成独立用例总数；跳过的检查不算通过。

本轮邮件修复没有读取真实邮箱、调用新模型或发送云复核，也没有新增真实系统通知、自然天气事件或平台部署验收。此前 10 月 23 日真实邮件链与本轮真实默认云端开发继续按各自原始回执单列。

后续用 CUA 操作同一代码树的非 Fake Competition 新配置，发现私人记忆控制平面可用时，知识源宿主仍可能尚未装配。旧按钮允许点击，随后只显示笼统外部失败。现在沿现有 `knowledgeSource` 投影禁用该按钮并显示固定配置提示；宿主就绪位加入有界 DOM 保留键，恢复后能更新按钮，无关宿主 tick 仍保留输入节点。原 IPC 守卫继续拒绝缺失宿主，固定文案经过精确白名单；带额外私人后缀时保持脱敏。没有改变知识源权限或新增本地执行路径。

同一独立配置的 120% 字号、减少动效和关闭 hover 展开已保存并在正常重开后生效；合成个人资料的名称和简介也保留。实际修复后界面显示禁用的 Vault 按钮及配置说明，已保存记忆仍能读回空列表。配置完成后的真实 Vault 选择、云消费与写入未在这次首启路径执行；不以此替代其原验收。

10 月 26 日进一步修复未配置 Competition 时能力目录一直处于加载态、原授权控制平面没有持续投影任务的问题。复用同一 TaskRuntime、原能力目录端口、现有任务快照和每批最多 128 事件的读取；重新装配前释放这一个本机轮询，退出继续沿原生命周期清理。没有装配模型或放宽工具授权。

新授权仅撤下自身旧取消、失效或未获授权的临时提示，恢复被覆盖的原配置说明。较早取消不会盖住较新操作；较早的 `RESULT_UNKNOWN` 仍可显示并保留，其他来源后来写入的错误不清除。完整 Desktop 首轮为 2,102 pass／3 fail／10 skip；三项失败来自 Laya 启动 VM 缺少新能力读取依赖，原断言保留并接入实际读取函数后定向通过。产品脚本的错误来源调用、取消码假设、回退提示未归属以及一次 PATH 缺 Node 的失败也保留，不把这些记录改成成功或当作实际工具执行 unknown。

最终 Skill 产品流程验证四条原 Runtime 决策：一条取消、三条成功；取消记录 `executionStarted=false`，取消后未安装，重新安装默认停用，资源预览不会执行 HTML。启用状态正常重开后保留；未配置云端时使用 Skill 被拒绝，卸载仅移除应用副本，原目录不变。两个测试实例正常退出，页面错误为零。本轮原生目录选择为显式合成；较早 CUA 曾实际选择公开合成 Skill 并读回原快照，最新 CUA 原生复验在检测到用户输入及最小化后未继续，不冒充最新原生视觉验收。

## 2026-10-26 十一包与 Root MCP 后续增量（四项组合回执已核）

本节接续上述 10 月 25 日回执，不改写原组合计数。十一项局部修复及 Root MCP 已在主集成树按文件逐项核对；通知点击的展示后回调丢失／ack 失败重开增量已有独立计算的源码哈希与 Root 读回。作者工作树的聚焦通过、原失败日志及主树字节是三种不同证据，历史 A10 整仓和 MCP a7 产品链也早于此轮最终源码，不用其成功替代四项当前组合回执。

公开 Evidence 只收录脱敏路径、源与日志 SHA、原始测量样本和可复算统计；Runtime 启动用真实 SQLite 加合成任务人口，历史缓存／分页用独立 Node 进程，控制、邮件、视觉与通知的局部回归使用显式 Fake 输入。P50/P95/max、RSS/heap、事件循环／IPC／DOM 与最终桌面合成只对实际测到的表面作结论；没有测到的项目保留 unknown。聚焦计数重叠，不相加；旧失败及 10k 缓存终态化 P95 回退保留。私有持久邮件游标 checkpoint 无公共 Schema 或新数据库迁移，不改旧任务和原 Evidence。

最终[组合 JSON](combined-verification-repair-20261026.json)和[说明](repair-batch-20261026.md)只从四份实际回执、当前源码及白名单局部日志生成。整仓 check exit 0，6,174 项为 6,145 通过、29 跳过、0 失败；Runtime Application smoke、显式 Fake Runtime 原生窗口 smoke 与 Root MCP 产品链均 exit 0。四份运行期间 `changedInputs=[]`，共享 1,720 项源码快照 SHA256 `7a25e23633e72792bdd5d40b12044c0d60b419e32257dd3f9557592044d0a4a9`，45 项必需源输入逐项与当前 Root 一致。MCP a8 用实际 Electron 管理／对话页、safeStorage 与本机 loopback TLS 得到一次工具调用及四类拒绝负例；其目录和消息对话框显式合成，模型／AgentArts 调用为零。Runtime 公开 application 实际解析到本树已编译 `dist`，包含私有邮件持久游标检查；这仍不等于真实邮箱验证。真实 QQ 邮箱、AgentArts、物理设备、Windows OS 通知点击及 Git/PR/发布状态继续按各自证据单列。

# P8 正式消费者回执与窗口准备修复

<!-- current-design-20261009 -->
> 当前目标与协作规则（2026-10-09）：[完整设计](../design/resident-developer-agent-20261008/DESIGN.md) · [离线阅读/全部 SVG](../design/resident-developer-agent-20261008/index.html) · [两人确认与本机阅读门槛](../reviews/DESIGN_READING_GATE.md)。WSS 主通道、HTTPS 备用；Wiki 记忆由 goo122 接入。goo122 与 Potatos498 均确认后才可按授权合并，禁止强制合并/管理员绕过。设计不等于已实现；本文历史验收与作者记录保留，旧合并规则以当前门槛为准。

> 维护入口（2026-10-07）：项目主要负责人为 zemeng；当前分工以 [模块分工](../../docs/MODULE_ASSIGNMENTS.md) 为准，最新状态见 [ROADMAP](../../docs/ROADMAP.md)。历史日期、作者和验收结论按原记录保留。

- Profile：`huawei_ict_agentarts`；关联 Issue #212，P5/P6/P7 消费。
- 负责人：zemeng P8 共享装配写入者；公共 Runtime 兼容评审：goo122；Windows 语义交叉核对：P6。
- 基线：`16e2280`；状态：`review`。不代表整个 MVP、设备通知或真实窗口写入完成。

## 行为变化

1. Feed 的 `unchanged` 没有新正文与 source-read proof，只推进分页游标。
   保留来源的 observedAt、原始 receipt、重检上下文和绑定有效期，不重新生成同一 work key 的判断。
2. P5 IPC 消费公开 `getPendingProposals`、`applyMeetingProposal`、`listMeetingReceipts`。
   用户只能选择事件与来源；审批和执行端口仍由受信宿主提供。
   Renderer 提交的邮件内容不再冒充正式邮箱来源；正式邮件继续使用已授权 `mail.read` 和现有加密 Inbox 管线。
3. 设备通知先保存投递意图，再等待 Electron 原生 `show`。
   unsupported/failed 为未投递，超时/重启为 unknown，不盲目重发。
   迟到展示及已持久化的确定回执只能核实匹配的 P5 pendingDelivery，不能由 Renderer 调用。
   `show` 证明原生通知展示，不证明用户阅读。
4. 本地通知卡片存储由 v1 升为 v2。旧 `deliveredAt` 只证明卡片记录，迁移为 createdAt + unknown；
   不补造历史展示确认。未知投递意图不会为腾出容量而丢弃。
   降级到只支持 v1 的代码不能解释 v2，应保留原文件并使用本机备份，不清空用户历史。
5. P5 状态消费设备失败码和持久反馈，pendingDelivery 或反馈无法读取时不能显示 ready。
   模型、监控许可和实际采样状态仍分别检查；端口存在不代表设备提醒正在运行。
6. Notepad 主对话从公开 `readHostToolTask` 生成安全说明。
   只有 Runtime succeeded、原生 confirmed.result.state=verified 且 Evidence 非空才显示读回匹配；
   不向 Renderer 投影目标 HWND/PID/targetRef 或待写文本。
7. Runtime Notepad adapter 改为先授权存在检查、hello/bind 建立旧窗口基线，再运行 Desktop 新窗/F9 准备，最后 observe。
   原来的准备前开窗顺序使新窗口进入 Host baseline，实际导致 NOT_FOUND。
   准备阶段取消、超时或 adapter close 释放已建立的连接，不观察或执行。
   presence 异步返回后先重验关闭、取消、期限与当前预约身份，再打开 Host；关闭、取消或超时不能创建迟到连接。
8. QQ 宿主建立新读取会话时，通过授权的 `readCursor` 读取同邮箱持久游标，传给 Runtime 内部会话。
   重启不恢复旧会话或权限；读源明确返回 CURSOR_EXPIRED 时停止，显示重新同步状态，
   只有下一次用户主动读取才比对并清除该失效游标。分类和已受理 outbox 保留。
9. 分类记录与分析 outbox 记录分类指纹，包含当前 multilingual / prompt / strategy / batching / chunk / 阈值。
   标签仍沿原有存储键绑定，本增量不变更该键。未知分类器使用进程实例指纹，不能跨重启误用缓存。
   指纹变化使旧分类进入待复核，旧分析不可作为当前出云输入；授权读回相同信头时重新分类。
   同来源版本已受理分析保留，不能因分类器变化再次提交；来源游标不为此回退或隐去。
10. 目标决策按钮显示“交给主智能体处理”，消费 P5 新反馈的 status/taskId/核实标记。
    submitted/succeeded/失败/取消均不表示目标更新完成。旧“已在本地执行”文字不能代替证据。
    有 handoff taskId 时禁止重新提交同卡片；只有显式执行与目标核实标记都成立才显示更新已核实。

没有新增 wire Schema、公共 capability、依赖或数据库迁移；上述宿主端口仍是 provisional。
通知和窗口行为均沿现有明确的本地用户操作/观察许可，未替代 Policy 工具执行授权。
没有修改 AgentArts/Live/SIS 凭据、云绑定或玻璃样式。

## 必要验证与真实现场

- Feed 受影响的 collection/dialogue/delivery 三项既有测试通过。
- 通知 host 四项、通知存储四项通过：原生 Fake show、unsupported/failed、超时迟到、重启不重发、
  v1 保留、损坏拒绝、未知意图容量保护。使用显式 Fake Notification，不是真实系统通知展示验收。
- Desktop Notepad 三项通过：Runtime/Policy 一次性授权、目标过期拒绝、确认前取消及安全对话投影。
  原生 transport 是显式夹具，不是 UIA 写入证明。
- Runtime adapter 三项准备顺序/取消/关闭测试通过；Runtime TypeScript 构建及 Desktop 修改文件语法检查通过。
  CI 暴露的 presence 等待后迟到连接已修复；关闭、取消、期限、预约互斥/释放及三项准备顺序共八项定向检查通过。
  陈旧 Memory 类型与 Runtime 导出产物分别重建后正式应用成功启动，没有为此全仓重建。
- 正式 Desktop 实际显示 Competition 本地 Runtime，无 Fake/model-fake；设备服务 idle，监控未启用。
- 第一次真实新 Notepad/F9 任务被 Host 在 observation 阶段拒绝，Runtime 为 cancelled，Evidence 为空。
  没有原生 execute 回执或确认写入。现场暴露并定位了上述基线顺序缺陷。
- 修复编译后现有应用进程仍加载旧版本，按前端验收协调保留其窗口、Notepad 和任务库。
  新代码真实 F9/原生读回、目标接管保护及最终对话渲染待下一次安全加载验收。
- 邮件管线/Runtime session/宿主分析六项与目标状态一项定向检查通过，共七项新增或受影响测试。
  覆盖分页恢复、过期/撤销与重启旧权限拒绝、分类指纹失效、accepted 保留、CURSOR_EXPIRED 停止与下一次主动同步。
  读取工具和 Laya 使用显式 Fake，不是实际 QQ IMAP、本机模型或正式 UI 证明。
  Runtime 单包构建通过；未重建或重启当前 Desktop，也没有占用模型槽。
- 独立测试 userData 的 Electron Fake 预览在 420×640 / DPR 1 加载新 Renderer。
  用显式 UI 夹具核对尚未交接、handoff succeeded 但目标未核实、mail resync_required 与主动重同步按钮。
  按钮只调用注入的模拟返回，不接正式 IPC 执行端；无云、邮箱、Goal 或记事本操作。
  实际截图和 DOM 反馈匹配，页面有内容、无错误覆盖层、最终 console/pageerror 均为空。
  预览发现目标卡片三处 inline style 被既有 CSP 拦截，已移除，未放宽 CSP；视觉 CSS 由 Luna 单独负责。
  邮件设置默认按钮在浅色主题下黑底黑字问题已交视觉负责人，尚未在本包修复。
  仅关闭自己启动的预览进程，旧正式应用和 Notepad 现场保留。预览记录在忽略的 `.cache/p8-ui-feedback-preview/`。

本机记录保存在被忽略的 `.cache/p8-real-notepad/`；不上传原应用配置、备份、私人对话或截图。
没有新增云调用，也没有重新执行已成功的会议链路。未运行全量 `npm run check` 或全套 Desktop smoke。

## 继续入口

- 当前进程的窗口验收结束后，再协调加载此修复并用新独立空白窗口取得真实 F9 与读回证据。
- 消费 P5 #231/P6 #234 的最终精确 head，非作者评审后集成；不能将它们的独立夹具验收当本次 Desktop 证明。
- 邮件分页恢复与分类指纹消费已接线；正式 QQ 账号与模型验收待已有有效授权。
  本次不修改既有 labels→storageKey 行为；未来变更标签定义前须规划原键迁移，不能用新键隐藏旧 accepted/cursor。
  已越过游标的旧分类保持待复核，当前没有为了策略变化而自动回读全部旧邮件。
  指纹绑定的是 model 名与逻辑策略，并未校验 HF snapshot 或权重字节；允许切换权重前还需接入实际模型版本身份。
- P5 目标宿主新包合入后，安全加载并核对正式 IPC、handoff task 状态和恢复后的卡片；隔离 Fake UI 预览不替代该正式链路。
- Calendar 的受控读源工厂、持久旧基线和 Fact 种入仍需 P1 的正式端口，缺失时保持 unavailable。

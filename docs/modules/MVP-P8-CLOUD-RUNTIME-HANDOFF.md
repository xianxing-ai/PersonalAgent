# P8 公共 Runtime 接续交接

> 维护入口（2026-10-07）：项目主要负责人为 zemeng；当前分工以 [模块分工](../../docs/MODULE_ASSIGNMENTS.md) 为准，最新状态见 [ROADMAP](../../docs/ROADMAP.md)。历史日期、作者和验收结论按原记录保留。

Profile：`huawei_ict_agentarts`。公共 Runtime 后续源码交 Work 云端唯一作者，本机 P8 保留 Desktop/native/configuration 装配。所有既有未知结果、数据库和用户配置保留。

## 2026-10-08 用户复测修复交接

本节按用户本次“提交 PR 到 GitHub，该谁修就谁修”的要求登记。负责人为
`zemeng5208`，状态 `ready`；这是待实施工作包，未修复或完成验收。长期分工以
[MODULE_ASSIGNMENTS](../MODULE_ASSIGNMENTS.md) 为准，历史交接中的唯一作者限制不扩展到本节。
本次核对源码基线为 `cc64ebd`，开工时重新核对 main 和已有 PR。

### 已观察的故障与证据范围

- 用户实时语音中反复催促查询天气，助手多次只承诺查询、重复“紧张”及上轮回答。
- 纽约中文查询返回 `Open-Meteo geocoding found no place named "纽约"`。
  英文 `New York City` 查询和青岛资料查询另有本地工具 `confirmed` 记录，
  但第二次 AgentArts 调用的文本为“请求不是受限 JSON，无法生成提案。”。
  后者不能记作连接器从未执行，也不能记作成功完成用户目标。
- 东京查询的 Runtime 答复要求提供地点，未记录对应天气执行；语音随后播报天气数值。
  工具测试任务没有逐项执行记录，语音却宣称天气、研究可用、子任务不可用。
  这些播报均缺少相应结果依据。
- 用户截图要求：长对话滚动/消息定位控件自动隐藏并限制高度；文字能输入并发送；
  将输入框下面的“唤醒词 / 开启 10 分钟”显示和操作入口移到设置。
  用户随后明确说明功能保留，只调整显示位置。
- 用户要求 Live 内部的“查询某地天气”工具工作文本不出现在聊天中。
  用户原始语音转写、实际答复、审批及失败状态仍须可查看，任务记录不能删除。

以上来自本轮用户复测及本机对应任务只读检查。没有将原始数据库、私人对话、
截图、账号、密钥或凭据提交到仓库；概述不是正式云 trace 验收。

### 负责人拥有的修改范围

- `apps/desktop/electron/live-voice-host.js`：工作交接、真实结果与语音答复约束。
- `apps/desktop/electron/conversations.js`、`main.js`：区分 Live 内部工作与用户消息，
  保留原任务/审批/取消语义及重启后的视图投影。
- `apps/desktop/src/app/renderer.js`、`style.css` 和 conversation 视图：
  输入发送、滚动控件、内部工具消息展示；底部唤醒显示/入口迁至设置。
  设置侧组件属于本工作包，复用现有 voice.wake 操作，不另建控制链路。
- `packages/coordination/src/agentarts.ts`、相应测试及 `tests/manual/agentarts/`：
  核对普通业务工具续接与图谱修复候选的输入契约，必要时修复适配/云端协议。
  若修改公共协议或 Runtime 行为，与 goo122 的公开端口保持兼容。
- 原生实时 WebSocket response 生命周期交 goo122 的 ModelGateway 工作包；
  业务连接器接线及业务验收交 Potatos498，不把模块验收转回本负责人。

### 开工定位入口

1. Desktop 的 `repairCandidateVersion` 默认启用 `1.0`；适配器当前对所有
   continuation 加候选输出契约前后缀。先核对实际发布协调器是否接受该包装，
   并确认普通天气/研究 receipt 是否应走纯 `{continuation: ...}` JSON。
   包装不兼容是定位线索，尚未通过修复后的真实第二次云调用证实。
2. `live-voice-host.js` 把 `replyText` 作为工具返回；任务终态成功不证明外部事实。
   补充明确状态/证据范围，失败或缺地点时保留原意，不能自行填充数字。
   禁止把工具目录、历史播报或模型自述作为“已测试可用”的依据。
3. `renderer.js` 的 `setSendMode` 在任意非终态任务存在时禁用发送；
   `main.js` 的 `task.submit` 也拒绝该 surface 上的全部后续消息。
   “等待授权”历史任务导致发送被阻塞，有界修复必须同时覆盖两层；
   不能只移除按钮禁用，也不能自动批准、取消或重开旧任务。
4. `initializeLiveVoice` 的 `onTaskSubmitted` 当前把工具生成的 goal 加入
   普通 panel turns；timeline 同时渲染这些 turns 与 Live transcripts。
   通过可信宿主元数据做显示投影，不能靠“查询”关键词过滤用户文本。
5. 将底部唤醒控件迁入设置，保留原配置、启停、权限与状态反馈，
   保留音频释放与窗口关闭处理。不能删除功能、绕过麦克风授权或占用 Live 设备；
   不能因入口位于设置而扩大原先“关闭面板停止”的音频使用期限。

### 交付与最少验收

- [ ] 查询明确地点时调用真实工作端口；无参数则一次澄清，不重复承诺或复读旧答复。
- [ ] 纽约 / 东京地点通过 schema 合法参数及现有 `locationQuery` 表达；
  无结果或低置信度明确报错，不将同名地点或缓存过期结果冒充目标城市。
- [ ] 英文纽约天气与青岛资料各读回一次提案、Policy、工具结果及第二次云答复；
  独立记录两次云调用，HTTP 200 不能替代工具闭环。
- [ ] 模拟工具失败、缺地点、等待审批及成功纯文本，语音不编造天气或可用性。
  确保最终结果源可在桌面查看；真实 Live 音频另做设备复测。
- [ ] 内部工具 goal 不显示为用户聊天气泡；用户语音、审批和失败反馈保留；
  重启后仍保持视图区别，Runtime 记录和幂等性保留。
- [ ] 历史 waiting_approval 不永久锁死后续合法消息；验证 Renderer 与主进程行为，
  新请求仍经过 Runtime/Policy，原审批 revision 与权限绑定不变。
- [ ] 聊天面板无底部唤醒区域，设置中可查看配置、启停及真实状态，功能保留；
  输入、Enter 发送、Shift+Enter 换行及中文输入法正常；
  长对话控件在滚动/悬停/键盘操作时可用，空闲隐藏且不覆盖输入框。
- [ ] 按实际改动运行受影响测试与必要 Desktop 文字/窗口验证；
  公共协议或 Runtime 集成变更按 AGENTS 要求验证。

交付小 PR 并登记真实证据、未验证项及发布版本；不静默回退 Local。
本交接 PR 不修改云端、运行时环境变量或正在使用的软件，也不宣称上述检查已通过。

## 当前源码

- 默认子任务使用与主任务相同的 `runCoordinationWorker`；SubagentHost 仍只负责一次原 `runTask` 生命周期。主 AgentArts 默认可用性不再依赖独立模型 API；显式选择独立模型仍走原受信模型工厂。
- SubagentHost 来源 `2b07e34`：独立任务并行、原父子身份/工具目录冻结、原审批和取消恢复。Runtime 接收第三参数限定 ToolPort，为子任务建立同源受限目录；发送前从原子任务工具绑定重查目录。思考步骤预算保留，未支持的原生 reasoning 不宣称已执行。
- 同一 TaskRuntime SQLite 有序增加 migration 10 `trusted_host_state`。可信宿主得到绑定 namespace 的同步 get/set/delete，未注册 wire/Renderer/模型操作，不创建额外任务或数据库。只保存公开宿主元数据，私有正文及凭据保持原存储。
- 知识写入恢复从原 HostTool intent、ToolRecord、完整输入 matcher 和真实只读结果构造接受记录；独立 observation Evidence 绑定原任务/run/digest/operation/current SHA。先持久读回证据，再由原锁定 finalizer 清匹配 metadata，仅 finalized 后恢复原终态；unknown/in_progress/still_unknown 保持待核实，不重发工具、不提前钉死未知分类。
- 公开逐项 Feed 原结果 mapper 来源 `1ffe991`，新函数已由 application exports 发布。原生产来源 Evidence/TrackingGrant 消费尚未补齐。

## 本地必要检查

Runtime TypeScript 编译最终通过（此前缺 knowledge 新 dist/类型声明的问题已修复）。新增知识恢复 2 case、原 Runtime migration 9→10/namespace/reopen/旧 checksum 不变 1 case，共 3/3；新增默认 Coordination 子任务 case 与 P5 最终 KV 2 case，共 3/3。默认子任务检查复用 FakeCoordinationPort，证明原循环/审批/同 run/Evidence/父汇总，无独立 API 调用；不是真实 AgentArts 云调用。Node 26.3.0，不是目标 Node 24.15.0。

Goal 本地常规授权修复 `1bf0dca` 的实际 SQLite case 1/1 通过。原真实验收任务 `dfe3b24e-deb1-4e3e-91de-f9cbba8e146b` 仍 waiting_reconciliation，图 revision 3/Goal 1 未写，cloudCalls 0，Laya stopped。原未知写不得重发。

知识模块 sidecar 来源 `610dd9a` 的作者必要检查已通过，本机未重复。已消费 PA020 `e3a0d94`、设备 `ab08ded`、Live `e23b4cd`、MCP/Skill `d94e9f6`、P5 KV `e11ac12` 与邮件夹具/manual；本机尚未统一启动验收这些装配。

## 仍需云 Runtime 实现

1. 原 Cloud 请求和部署版本/trace 的真实绑定；P4 v17 发布与独立角色预览不是本地 Goal/Laya/CAS 证据。窗口释放及准确 pins 后，用新的隔离夹具执行真实主链。
2. 私有记忆的可信临时 goal 投影 hook：公开原 user goal 持久化，native task consent 后仅内存引用摘要；最终发送复验许可，重启无 lease 拒绝。原 Runtime/子任务/历史的本地派生副本登记、withheld 与终态精确清除，并真实读回，未知写 proof 不提前清除。
3. P7 原 Feed execution/result/Evidence→完整 v2 mapper 绑定、真实公开 transport proof/native TrackingGrant、主文字同源 answer 消费。
4. 同一原 Skill worker 的可发现云选择/续接，不能在工具锁内嵌套 invoke；MCP 公共 export 必须明确原生许可/task/proposal/path/config/SHA，workspace read 不自动成为出机许可。
5. Calendar 初始真实 Fact/Goal dependency link、Meeting execution 通过原 Runtime/Policy/Gateway，不能用旧 allowed 回调直接 appendBatch 冒充授权。
6. Windows 原未知运行 recover 的 HostResult 严格校验、只读接受到原 Runtime record/终态；不得重发 execute/not_found 伪完成。

Desktop/main 原生选择、安全配置、IPC、持久任务列表的恢复操作及最终统一验收由 P8 串行接线。现有 UI/源码/测试/模块合并不代表全部 MVP 完成。

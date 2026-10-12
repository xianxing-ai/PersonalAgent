# MOD-04A：Live 工具结果续答生命周期修复交接

交接日期：2026-10-08；实施更新：2026-10-10 · GitHub 负责人：`goo122` · 工作包状态：`review`（模块仍为 `in_progress`）

目标：`huawei_ict_agentarts` 中现有原生语音入口的兼容修复，不扩展 Local Profile。
这是按用户“提交 PR，该谁修就谁修”的要求交出的工作包；用户已授权执行计划，生产修复、离线回归与完整门禁已完成，按计划交付独立 PR。
分工依据为 [MODULE_ASSIGNMENTS](../MODULE_ASSIGNMENTS.md)；接口状态以
[CURRENT_INTERFACE_CATALOG](../interfaces/CURRENT_INTERFACE_CATALOG.md) 为准。
原交接核对源码基线为 `cc64ebd`，本轮开工重新核对后采用 `origin/main@e86bac53`。

## 复现与已知事实

用户 Live 会话出现多次只说要调用工具、重复旧答复和“紧张”，工具失败或没有天气
结果时仍播报天气数值。Desktop 宿主和 AgentArts 普通业务续接另由 zemeng5208 修复；
本包负责原生 ModelGateway 中可能导致重复续答或打断失效的具体生命周期问题。
用户观察能证明症状，尚不能证明每次重复均由以下竞态导致。

源码入口：`packages/models/src/realtime.ts`，已有测试
`packages/models/test/realtime.test.mjs`。交接时实现（2026-10-08）：

- 每个异步工具完成后直接发送 `conversation.item.create` 和 `response.create`，
  未等待当前 response 结束，也没有一批工具结果的单次续答协调。
- 打断记录的是当时 `currentResponse`。已发出的工作若随后完成，会继续发
  `response.create`；会话未关闭时，没有按用户轮次判断是否应自动插入旧结果答复。
- `response.done` 使用嵌套 `message.response.id`，当前丢弃旧响应的检查却只检查
  顶层 `message.response_id`；处理 done 时还直接清空 `currentResponse`。
  被打断的旧 done 可能清掉新响应标识，影响下一次取消。
- `onTool` 抛错后会返回固定失败文字，但原生模型续答仍可自由发挥。
  仅有提示词不能声明已阻止语音幻觉；需要保留实际工具结果的权威来源及验证边界。

## 拥有范围与协作边界

goo122 拥有本包的 `realtime.ts`、相应公开导出、测试和 README。
若涉及 Runtime 实时模型工厂的兼容接线，可随本工作包完成必要改动与消费验证；
不在 ModelGateway 新建任务执行器、读取凭据文件或直接调用连接器。

`apps/desktop/electron/live-voice-host.js`、对话投影及云端续接属 zemeng5208；
天气/研究等连接器及业务接线属 Potatos498。实现前通过已公开端口确定最小协作形状，
同一共享文件串行修改，保留其他协作者改动。

## 最小实现目标

1. 工具只执行一次，结果只回传一次；多工具并发完成不触发多个冲突的续答。
2. 将结果回传与自动开口分开。打断后旧任务仍可完成并保留结果，不能被偷偷取消、
   重发或重开终态；是否播报遵循当前用户轮次，不抢占新问题。
3. 使用实际响应身份处理 created/done/cancelled；旧响应完成不清空新响应，
   重复完成事件不再触发旧轮次播放、drain 或续答。
4. 与 Desktop 宿主约定真实状态和受限答复语义，失败、缺地点、等待审批不变成成功。
   若采用 per-response 指令或工具选择设置，先核对当前官方原生接口支持，再做真实验证；
   不能把未经平台支持的参数或提示词更强当作修复已生效。
5. 保留 deadline、取消、输出限制、标识冲突校验及脱敏错误，兼容现有调用方。

## 定向验收

- [x] 假 Socket 注入同一 call_id 的重复事件：业务执行一次，回传一次。
- [x] response 尚在输出时工具完成：不产生冲突的 response.create。
- [x] 同一轮两个工具交错完成：保留两份结果，完成本 response 及全部本轮结果后续答一次。
- [x] 新响应 r2 创建后收到已打断 r1 的 done：r2 标识保留，下一次打断取消 r2。
- [x] 工具等待时用户开始下一轮：迟到结果回传，旧答复不抢占；旧等待不阻塞新轮次。
- [x] 工具异常脱敏，服务端取消、close、abort、deadline 不触发迟到传输或重放；工作标识冲突拒绝。模型口头成功/幻觉仍不作保证。
- [x] 假 Socket 回归及 models/实际宿主消费验证；无真实账号调用。
- [ ] 用户授权的真实 Live 会话复测调用/打断/恢复；报告真实设备与模拟测试的区别。

## 原交接验证（2026-10-08）

本交接仅核对源码和分工，执行 `git diff --check`；未运行上述验收，未修改云端或
正在使用的软件，无新增公共协议、依赖、数据库迁移或权限。
负责人应在此 PR 的实现更新中列实际测试、兼容影响及剩余限制；交接文档合并不代表修复完成。
不上传原始用户录音、私人会话、凭据或本机路径。

## 实施与兼容性（2026-10-10）

- 实际隔离工作树 `.worktrees/goo122-live-response-lifecycle`，分支 `codex/goo122-live-response-lifecycle`，基线 `origin/main@e86bac53`；原共享目录与协作者改动保留。
- 生产只改 `packages/models/src/realtime.ts`。复用原 Gateway、Socket、公开事件与宿主，不新增工具执行器、权限、Provider/Local 能力、Schema、迁移或依赖。
- 同一用户轮次等待本 response 完成及全部工具结果，创建一次续答；结果回传与自动开口分离。打断不取消既有 Runtime 工作；旧/重复 done 及迟到音频不清空新响应或重复 drain。
- 异常、取消和未完整 response 不冒充完成；关闭前已接受但尚未开始的工具不再启动。真实模型是否遵守失败结果仍需独立验证，本包不宣称消除语音幻觉。
- 按官方 [服务端事件](https://www.alibabacloud.com/help/en/model-studio/server-events) 使用嵌套 response.id 与工具 response_id；[客户端事件](https://www.alibabacloud.com/help/en/model-studio/client-events) 未公布定向取消及响应与用户轮次元数据。续答已发但 created 未确认时打断，停止通话并显示重连提示，防止猜测响应归属；后台任务保留。

## 实施验证与剩余条件

- 新增六组 Fake Socket 竞态用例在原生产实现失败，原三项通过；保留 `.cache/live-realtime-before.log`。后续复核发现空响应 ID/无来源音频/转写边界，三个子路径在修复前全失败（含父用例 4/4 失败），保留 `.cache/live-identity-before.log`。最终 models 42/42，通过 `.cache/live-models-final-tests.log`。
- 实际 Gateway + Live host + SQLite TaskRuntime 组合用例证明：旧背景工作等待期间，新轮上下文已回传，未确认续答打断后通话释放，原任务仍 running 且 worker signal 未取消；随后原任务 succeeded 一次，零重复 submit/cancel，零迟到音频/旧结果传输。Socket、设备、面板、客户端适配与消费 worker 是显式合成夹具；没有实际录音或云网络。该组合及原宿主用例最终 14/14，日志 `.cache/live-consumer-final-tests.log`。
- 首次 npm ci 在受限环境报 `Exit handler never called!`，授权环境重试安装锁定依赖成功；不运行安装脚本，初次日志保留。
- Windows helper 编译通过。完整门禁首次在沙箱产生 235 失败、28 跳过，根集成未运行，保留 `.cache/live-check.log`。同一项目路径的只读探测在沙箱下 realpath=EPERM、授权环境正常；当前用原命令在授权环境复验，不改变生产权限、测试断言或系统设置。
- 授权环境完整复验 2595 通过、1 失败、29 跳过，唯一失败是未修改 Git 合成 copy→root 目录替换 `EPERM rename`，根集成未运行，保留 `.cache/live-check-final.log`；原 Git 文件定向复验 26/30，在四个相同替换路径失败。必要门禁修复复用 #318 已交付的同一夹具补丁：Windows EPERM 最多等待 950 ms，其他平台/错误或持续失败直接抛出，生产 Git 实现和安全断言不改。本包若先集成 #318，相同补丁应从剩余差异中消除。
- 最终完整 `npm run check` 退出 0：2652 项、2627 通过、25 跳过、0 失败；包含架构、契约夹具、生成类型、全工作区类型检查/测试及 23 项根集成。日志 `.cache/live-check-delivery.log`，最终生产代码未再修改。真实 Live 会话、真实设备与云端消费仍待授权，本模块保持 in_progress/provisional。
- 本包按已确认计划提交独立 PR；实际提交、PR 与远端 CI 以 GitHub 当前 head 为准，非作者评审与集成尚未完成。

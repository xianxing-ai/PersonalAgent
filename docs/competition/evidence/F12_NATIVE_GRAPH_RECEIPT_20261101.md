# F12 原工作流到 Windows 通知回执

2026-11-01 05:25:24 UTC，PR #531 集成树完成一次隔离验收。目标 profile 为 `huawei_ict_agentarts`；不构成 AgentArts 云端或全 F12 验收。

## 实际路径及结果

使用仓库原 `f12-runtime-scenario.mjs`，仅将其显式设备接缝换为生产 `createDesktopNotificationPort` 默认 Electron Notification；未替换显示回调、修改等待时间、主动标记已读或重发。真实 Runtime、OwnedWorkflowEngine、SQLite、ToolGateway、Policy、通知 CAS 轮次与 Windows `show` 回执参与执行。两个输入条目是公开合成数据；候选生成/选择、云协调传输、导出同意和审批响应仍为显式 Fixture。

- 根 task `8b55f414-751d-46fb-810d-b08b53de9757`，原 F12 子 task `a6539d91-33a0-489e-b913-1ec7d344c60a`，子任务 `succeeded`。
- 系统 `Notification.isSupported()` 为 true；发送次数为 1，一个 banner 绑定 `item` 和 `item-2`。
- 原 round `workflow-f12-6d33d1334af8c7c67ffb4ddb78c2c362b3f757f6111b709c092c6ad4b92f2583` 的 banner attempt 为 `delivered`，其原 quota `counted:true`。round 本身仍为 `active`，并未伪造关闭或已读。
- Electron 原 `show` 在 `05:25:23.758Z` 到达，原 CAS 在 `05:25:23.761Z` 记录投递；两条 feed 均有该投递时间且 `unread:true`，设备 `userRead:false`。
- 真实显示回执晚于发送函数返回，由原轮次有界只读等待收敛。全过程没有第二次通知发送，未访问邮箱、真实账号、云模型或私人内容。

隔离原始记录 `.cache/pr531-f12-native-graph/receipt.json`，SHA-256 `a72a340fcc5e170246ecc703357f1881a5a9d33e7b546656c5949fd79c408666`。SQLite 与 Electron userData 保留在本树被忽略的缓存目录，未提交 Git。

## 尚未验证

本记录只证明原工作流到真实通知投递和原轮次读回。没有真人视觉/听觉确认、用户实际点击、语音播报、用户返回事件源、真实 AgentArts deployment/trace/评估或真实业务来源；Fixture 的成功文本保持 `verification=unverified`。不得据此勾选 #531 全部真实验收或合并。

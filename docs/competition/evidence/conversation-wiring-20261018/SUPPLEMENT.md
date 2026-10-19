# 接线增量：最终本地组合验证

本增量保留 PR #406 首包 `2e45faa5` 及远端其后七项协作提交，整合到 `e1fb853c68511a6b3f716f2139a1ff47f4d8418a` 后继续沿同一分支交付。
最终 primary Runtime 构建通过；UTC `2026-10-18T22:27:20.873693+00:00` 至
`2026-10-18T22:32:42.786480+00:00` 的六项检查均 exit 0，测试 **226/226**，0 failure、0 skip。
这是当前源状态对应的分组结果，不与首包99项或各子包重复相加。
机器可读的精确命令、源文件摘要、时刻与日志 SHA 见 [validation.json](validation.json)。

## 已修复并实际消费

- Teacher 第二轮公开上下文变化不再撞普通任务的固定上下文槽。每次交换绑定原已批准 Gateway run，保留普通上下文不可变、原配置与出机 hook；最终发送前的 request copy 也须精确匹配当前唯一 lease。SQLite 重开后的未知交换不重发。
- 同一 user-work 连续审核不同 PR、重复读取新的 CI 页提案使用独立内部 run 标识，保持原 taskId。旧 binding 恢复沿原 legacy 身份；新 namespace 先持久化，避免进程在两次 checkpoint 写入间退出后误判 legacy。
- 自动允许的开发补丁在结果未知后保留原嵌套调用身份。首次 user-work 子任务和追加子会话都能在真实原记录核实后续接；不补造 Approval、不刷新 grant、不再次 apply。外来参数与回执仍拒绝。
- Live fallback 读回和异步审批摘要遵守原120秒工作等待期限。超时不冒充成功；原 task 保留，显式 wait 可续读而不重复 submit。
- Windows 部署测试使用明确的 Synthetic Node transport/ACL fixture；Linux 原直接 provider spawn 仍保留。退出测试补齐新增资源端口，并验证当前任务结束、Windows sidecar 释放后才关闭 Runtime 与许可。
- F15 真实生产 runner 现在消费通用 frontier driver，保留原 source bytes/SHA、N05验证、N06 CAS/隔离断言。真实 F20 Engine 与 Synthetic 工具验证第二图的四节点、审批恢复、重启和未知结果处理；没有注册 F20 生产入口或宣称 MOD37 接通。
- 消费 Owner PR #415 的显式 endpoint 旧边界、callback类型检查及实际 send 微任务内重验；保留此前 HTTPS/WSS 固定同版与冲突拒绝。两个 Owner 测试已复用，不整 PR 合并。

## 精确验证分组

| 分组 | 结果 | wall 秒 | 日志 SHA-256 |
| --- | --- | --- | --- |
| main-syntax | 通过 | 0.024 | `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855` |
| architecture | 3/3 | 0.138 | `bbc98b75cbb2927278d7efe635be84ca43c844f029f2d33bb7424ee248443c91` |
| conversation-integration | 135/135 | 83.536 | `ed6d0b06cd0aebd94d594fcf10ed4b3eef2de5b9742850ac3190a5f27cfd1c04` |
| live-handoff | 43/43 | 1.153 | `edd6d8d63f5645257372a2e798f8d06dbb8fe0557e4d7343f564525bbc0fc178` |
| desktop-lifecycle | 16/16 | 0.396 | `6c376a97ec06027e6287319f432fd83985675e6cc5eb31bd043ea46773454b85` |
| developer-deployment | 29/29 | 1.714 | `991b0502df47c15696465faef341f869c3734c24fcd357fccf069b6b4cbaa53d` |

Runtime 构建命令为 `npm run build --workspace=@personal-agent/runtime`，日志 SHA-256
`f12efe3b91f5fb80470dcf208852b80690176834cb51f584201062daf5149855`。Node `v24.15.0`，npm `11.12.1`。
仅运行受影响文件与原上下文/恢复回归，没有运行本地全仓检查。

整合远端时保留了四种 triage label 的原公开 cognition 工厂验证及文档。Runtime/组合135项与架构3项的源文件摘要未变；重叠的 Live、退出和开发部署三组单独重跑88项全通过，替代整合前的82项，所以最终为226项，不重复相加。变动文件、远端七个 commit 和每组时刻记在 JSON 的 postSyncProvenance。最后的 Windows 夹具提交采用同一修复意图，最终保留已测的真实 Node transport、原 getCredentials、双 provider 释放及可撤回 Synthetic ACL；测试文件字节未再改变。

## 原 CI 失败与当前边界

首包 `2e45faa5` 的 Windows PR/push Foundation 实际失败：部署夹具、退出 VM 夹具及 Live 期限回归。
本增量逐项修复，以上本地组合已通过；新提交的 Windows CI 须单独读回，不将旧头结果或 Linux通过当作新头 CI 通过。
Design 门禁需要当前 head 的非作者批准，未自行批准或合并。

28 图目录与逐图缺项见 [镜像矩阵](../../IMAGE28_CONVERSATION_WIRING_20261018.md)。
F15 原镜像仍依赖 `decision.choose_candidate` 与原本地 selector ready/资格回执；本轮未启动 Laya、未替代选择算法。
通用 driver 不是任意图的模型入口。其余业务 adapter、可信输入/guard、F22/F23配置/验证端口、真实云与设备仍按原 owner 处理。
Live 后台主动播报须模型负责人提供可信公开端口，见 [交接提案](../../LIVE_BACKGROUND_RESULT_HANDOFF_20261018.md)；目前仍经原 context/wait 续接。
没有真实云/账号写入、物理 Windows 或音频验收，没有发送邮件。

## 当前头 Windows CI 后续修复

`3000dcbdd4f26f4a27fdb62ae34c98653f02afe6` 的两条 Foundation 进一步暴露两个独立失败；未把本地226项记为远端通过。
PR run `39172889704` 已通过全部 workspace 检查，但根集成51项中50通过、1失败：
`tests/integration/live-response-lifecycle.test.mjs` 的旧 Synthetic consumer 把幂等键放进 `task.submit` 业务参数，
被当前 Live 的严格字段校验正确拒绝，随后夹具误读未赋值的 taskId。
本次仅将该夹具对齐原公开 consumer 契约：业务参数仅 goal/conversationId，幂等键进入可信 Client 调用选项，
再由夹具的原 Client→TaskRuntime 边界映射；保留并强化原任务只执行一次、幂等身份、打断音频不取消后台任务及迟到音频拒绝断言。
没有放宽生产字段、授权或恢复检查。新增定向复现/验证记录见 JSON 的 `postCiFollowup`；上表226项是原统一包的独立记录，不重复累加。

push run `39172886287` 仅有原 knowledge TLS 夹具的证书创建失败（55/56）：
原 PowerShell 进程在10,128ms触发10,000ms预算，被终止前未观测到 script_enter，尚未进入 TLS pin/descriptor 断言。
具体操作系统原因未知，不能归因为 RSA 或 TLS 逻辑；相同提交的 PR run 该组56/56通过。
knowledge 在 main→3000 无源码变动，本轮未修改其源码、延长期限、跳过测试或重试证书操作。
新提交自动 CI 将单独记录；若该环境问题复发，交原负责人 goo122 核实 Windows 证书首次启动预算。
两条 run 的 Desktop 均1298通过/0失败/6跳过，Runtime 均850/850；原部署、Live recovery和退出三簇均通过。
push 因 knowledge 失败未执行根集成，不能视为其已通过。

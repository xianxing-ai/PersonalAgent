# 原应用权限回调接入同一对话卡（2026-10-21）

目标是 Competition Profile 的既有 Desktop Main 组合入口，不新增任务库、Policy 或授权协议。此包基于 `c69383b262a24e437d478377c4c7c5ce27c7f740`，由 `codex/authorization-permission-callbacks` 交给统一授权集成分支正常合并；公共 Runtime/question/intent 端口由该分支的负责人维护。

## 实际消费与兼容性

- PUBLIC 参考：精确静态 MCP schema/version 和 Skill 公共版本三元组可公布；动态目录走 `reference.catalog` 原应用 intent。原工具运行预登记 `public-reference-read` 与 `public-reference-export`，执行仍等待 Runtime 的同一卡。确认阶段保留原 candidate 的版本、路径、配置、SHA256 和实际字节数核对。已完成的 F15 local read 只接受 Runtime 回调给出的 `authorization.taskId/runId` 与可信 candidate `readTaskId/runId`，用 `assertConsumedResult` / `authorizeConsumedExport` 消费原回执，不新增执行许可。Skill 的原 inner MCP 映射由 Runtime `bindPublicReferenceQuestion` 验证原 choice/manifest/source 后提供。
- 知识源：配置确认是能力偏好，不是会话 grant。真实 RegisteredTool 包装在 `withAuthorization` 内，执行前、await 后与租约当前性检查都核对同一 `knowledge-source` requirement。没有该上下文时不提供新的 writer.apply；原已接受写入的 reconcile/finalize 仍按原记录恢复。动态 PUBLIC 查询/笔记目录另走 `knowledge.catalog`；有界摘要出机是原工具卡的 `knowledge-export` requirement。
- 远程 MCP：配置、撤销与连接确认使用原应用 intent，原私密 token 输入/加密存储、实际连接和任务读回继续使用既有实现。旧管理窗口 `respond` 无法再调用 `authorization.respond`。
- Obsidian：保留真实配对码与连接过程，应用许可走 `knowledge.pair` 卡；owner、peer 或取消信号变化会使迟回失效。系统设备、OAuth/UAC 等流程没有被模拟卡代替。
- Voice：麦克风应用卡先于设备 permissionGate 和 Live 云连接/历史发送；用途、panel、期限及取消绑定，等待卡期间可撤销。系统麦克风检查保留。口头 yes/no 只聚焦当前 formal question，不消费 Policy、不修改设置、不新建问题、不重新提交任务。`sourceApprovalId` 映射原审批，UI 仍以原 question/revision 回答。Gemini JARVIS `INSTRUCTIONS` 原文没有修改。

旧的“语音说同意即可写设置/消费审批”测试已改成“同意/拒绝都只引导原卡”的行为要求；旧同步 microphone authorize 的消费者均改为 await，测试注入显式 Fake 卡。旧管理审批入口现在明确拒绝，不能凭隐藏按钮保留授权捷径。此包没有 contracts/lock/数据库迁移。

## 当前验证边界

本树固定 Node 24.15.0，以下 3 个无需内部构建依赖的 test 文件实测 **9 通过、0 失败、0 跳过**：

```powershell
node --test apps/desktop/test/public-reference-question.test.mjs apps/desktop/test/microphone-capture-host.test.mjs apps/desktop/test/voice-runtime-approval-bridge.test.mjs
```

覆盖原卡 prepare/consume、越任务/提案、超上限/过期、F15 worker/local 映射、动态目录、麦克风拒绝/等待中撤销/失效 owner、真实设备调用之前的应用卡、原卡唯一 voice 映射。它们是显式 host-port Fake / 合成 device receipt，不证明真实 Runtime 卡、AgentArts、麦克风或平台验收。

新增 `application-pairing-consent.test.mjs` 单独实测 **1 通过、0 失败**，覆盖拒绝、owner/peer 替换与关闭后迟回。所有受影响 JS/MJS 的 `node --check` 和 `git diff --check` 通过。依赖型 knowledge/remote MCP/voice 与现有 Live/Wake 消费者测试将随统一集成树新构建依赖运行；本树没有安装、借用其他工作树 dist 或启动 Electron。未运行的集成与设备检查仍是 `not_run`，不能以这 10 项 Fake 代替整包验收。当前源码先提交供集成，最终 PR 完成条件仍包括该分支必要检查与真实卡 UI 消费读回。

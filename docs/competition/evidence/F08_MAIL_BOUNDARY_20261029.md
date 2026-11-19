# F08 邮件图边界记录（2026-10-29）

- Profile：`huawei_ict_agentarts`；此记录仅覆盖本地代码和 Synthetic 定向测试，不是邮件账号或整图验收。
- `mail.mark_seen` 只标记已读，不是归档；`mail.save_draft` 写入 IMAP 草稿，不是 SMTP 发送。参见 `packages/connectors/mail/docs/cloud-business-handoff.md`。不得以这两个工具的成功证明 F08_N03 归档或 F08_N07 发送。
- 此前图宿主直接调用注册工具并合并其 requiredScopes，会跳过下游 ToolGateway/Policy。`apps/runtime/src/application/workflow-f08-mail-graph-host.ts` 已删除这条路径：N03、N07、N12 的公开工厂保留签名但返回空 tools 和明确 unavailable；不会读取凭据、调用邮箱或虚报执行成功。N12 暂不可用直到可通过 Gateway 安全绑定原发送身份及核对结果。模板中 N11 的 `mail.reconcile_send` 不受此改动影响。
- 后续需要为真实归档和 SMTP 发送提供正确语义的公开工具，经 ToolGateway、Policy、参数及原图身份绑定，并保留未知写入和核对语义；Desktop 在可信端口齐备前不得注册相应宿主。SMTP provider 中存在底层发送能力，不等于已有公开的 Gateway 发送工具。
- 验证：`node node_modules/typescript/bin/tsc -p apps/runtime/tsconfig.json` 通过（本机 Node 26）；Node 24.15 执行 `node --test apps/runtime/test/workflow-optional-graph-hosts.test.mjs`，13/13 通过。测试为 Synthetic，不能证明真实邮箱配置、发送或整图完成。
- 归属：此 Runtime/Policy 边界按 Owner 本轮授权代原底座维护方 goo122 修正；真实邮件连接器能力仍需按仓库分工交接 Potatos498。

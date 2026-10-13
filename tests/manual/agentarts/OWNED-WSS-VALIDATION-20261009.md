# 自有镜像 WSS 本地验收记录

<!-- current-design-20261009 -->
> 当前目标与协作规则（2026-10-09）：[完整设计](../../../docs/design/resident-developer-agent-20261008/DESIGN.md) · [离线阅读/全部 SVG](../../../docs/design/resident-developer-agent-20261008/index.html) · [两人确认与本机阅读门槛](../../../docs/reviews/DESIGN_READING_GATE.md)。WSS 主通道、HTTPS 备用；Wiki 记忆由 goo122 接入。goo122 与 Potatos498 均确认后才可按授权合并，禁止强制合并/管理员绕过。设计不等于已实现；本文历史验收与作者记录保留，旧合并规则以当前门槛为准。

Profile：huawei_ict_agentarts；分支：codex/agentarts-owned-image；日期2026-10-09。
证据等级：显式Fake模型，真实回环TLS/WS、SQLite、Policy/ToolGateway及合成文件。没有真实华为deployment/trace或付费模型证据。

## 验证

- 独立传输Schema6/6、编排18/18、HTTP/WS服务21/21、客户端/Runtime及既有回归187/187通过。随后取消默认公网地址猜测，Desktop可信配置与相邻测试34/34（配置5/5）、WSS客户端配置/行为18/18及Coordination构建/类型检查通过。
- 完整`npm run check`退出0，末尾24/24集成通过；日志忽略路径`.cache/agentarts-image/wss-root-check.log`。
- `owned-wss-integration.mjs`：10场景，6次Fake模型调用，仅一次未发送invoke的连接失败触发HTTPS备用；2次status查询。真实TLS验证开启，覆盖鉴权拒绝、同会话复用、同身份已确认缓存重放、严格信封、取消、断线未知不重发、心跳/关闭及进程重启后unknown。
- `owned-wss-runtime-integration.mjs`：2任务、4次Fake模型调用、2次实际文件读取、2次本地审批、2条confirmed Evidence、2次实际TLS Upgrade、0次HTTPS调用；每任务文件只读一次。第一任务成功，第二任务续答断线后为waiting_reconciliation/RESULT_UNKNOWN，保留原执行回执；SQLite重启后重复提交仍复用原任务，4次恢复被拒绝，模型/工具调用不增加。
- 真实工具联测发现Runtime的出机保持分支提前把未知分类成UNAUTHORIZED。窄修两个catch，只让可信本机AgentArtsResultUnknownError由原exchange分类，不放宽其他权限错误；含/不含coordinationInput两分支断言通过。修复后Runtime构建与受影响HTTP/WS回归43/43通过。
- ARM64本机Linux容器构建成功，实际隔离容器HTTP/WS/启动21/21与生产入口合成TLS9次回环模型请求通过（无外网、无真实模型账号）。此处验证的是本机构建产物，GHCR发布摘要与远端拉取验证另行记录。
- 窄审查用实际子进程exit86复现终帧后/Runtime消费前崩溃：修复前重启重发旧云续接一次，修复后received只保存身份/摘要并保留inflight，恢复返回RESULT_UNKNOWN，额外云请求0、本地工具执行0。提案须原competition-loop已持久保存，最终text须TaskRuntime已持久提交succeeded才清标记；无明确消费点保留hold。独立复现`.cache/cloud-review-repro/repro.mjs driver fixed`退出0，修复后的根集成再次24/24通过。
- 最终Coordination全包与Runtime coordination*/agentarts*受影响回归215/215通过（含新增WSS Runtime13/13）；初始/续答两轮实际子进程received落盘后退出，重启resume/duplicate submit均不新增云/工具调用，非法内层应用JSON不能提前清标记。新增durable-success消费回调曾使缺端口立即失败/关闭多一轮微任务，保留无port旧promise路径后回归通过；崩溃夹具使用异步子进程避免阻塞并发启动。Coordination/Runtime构建与类型检查通过，最后真实TLS Runtime9场景复测通过。
- 4SVG实际栅格查看，修复总图一处新增遮挡；模块估算与负责人未提升。manifest/阅读声明须绑定最终设计摘要和PR head。

手工脚本要求忽略目录中的合成证书（key.pem/cert.pem，SAN包含127.0.0.1），只在测试子进程通过NODE_EXTRA_CA_CERTS信任；不改系统信任、不关闭TLS。

```powershell
$env:PA_TEST_TLS_DIR=(Resolve-Path '.cache/agentarts-image/tls-fixture').Path
node tests/manual/agentarts/owned-wss-integration.mjs
node tests/manual/agentarts/owned-wss-runtime-integration.mjs
```

## 限制

自动status核实消费者未实现；unknown/inflight保持等待核实，缓存未命中不许可重发。容器/ws不证明公网网关Upgrade或路径；SDK当前公开客户端只有HTTPS JSON/SSE调用，具体WSS公网路径须实调确认。旧8Workflow/3Controller迁移矩阵包含未映射职责，不能计全部完成。Wiki由goo122另行实现。镜像发布、华为导入/部署、真实模型/工具及平台评估分别保留实际证据。

# 精确版本只读、四面、sampling、评估与构建计划验收

Profile：`huawei_ict_agentarts`。本文是可照做的步骤，不是已完成的真实云、真实镜像或真机验收。凭据只放在受信宿主的既有加密配置或进程环境，不要写入仓库、测试夹具、日志或聊天。

## 不需要云账号的自检

在仓库根、Node 24.15.0 上先构建 `@personal-agent/agentarts`，再运行：

```bash
npm run build --workspace=@personal-agent/agentarts
node --test packages/agentarts/test/pinned-version-readonly.test.mjs packages/agentarts/test/ordinary-competition-sampling.test.mjs packages/agentarts/test/platform-evaluation-binding.test.mjs packages/agentarts/test/owned-image-build.test.mjs packages/agentarts/test/owned-workflow-shadow.test.mjs
node --test apps/agentarts-runtime/test/pinned-platform-loop.test.mjs apps/agentarts-runtime/test/platform-services.test.mjs apps/agentarts-runtime/test/image-services.test.mjs
```

这些命令使用显式夹具。通过只说明注入端口的拒绝和关联行为，不说明华为云可用。

## 需要用户提供的环境

1. 华为云 AgentArts 项目中已存在的固定 runtime ID、endpoint ID、版本名和 SWR 镜像摘要。版本不能是 Latest，endpoint 名必须等于该版本。
2. 只读 IAM 身份，至少能 `ShowCoreRuntime` 与 `ShowCoreRuntimeEndpoint`。评估读回还需要该评估任务的查询权限。不要把 AK/SK 交给代理或写进 Git。
3. 一个已经由原 Policy 授权的公开只读工具、其参数和本地目标系统。本增量的默认形状是单次 `research.search`，生产必须换成当前授权的那个工具。
4. F26 真实构建还需要本机 Docker、ARM64 buildx、SWR 登录和既有 `scripts/agentarts/release-owned-image.ps1`。Linux 夹具环境不能代替这条。
5. F23 真实分数需要平台评估任务 ID、与原输出逐项对应的 `item` 数据，以及现行配置消费者的版本读回。没有这些数据时结果应保持 unavailable，不能手填分数。

## 真实只读闭环建议顺序

1. 用受信宿主读出固定部署，确认 runtime、endpoint、版本和镜像摘要与启动 pin 一致。
2. 经现有 CloudAgentPort 向该精确版本发一次调用，只接受与授权工具相同的 `tool_proposal`。
3. 由原 Runtime/Policy/ToolGateway 执行该只读工具一次，保存本地 evidence id。
4. 再次读取部署。版本或镜像变化则记为冲突，不把云端成功写成任务完成。
5. 知识、MCP、trace、评估分别读各自端口。模型代理成功不能填进 MCP 或评估。
6. 把请求 id、部署 pin、evidence id 和四面的各自状态记入既有证据，并标明 `realEnvironmentAcceptance` 只有在上述读回都完成时才改写。本仓库夹具不会改写它。

## 明确不算通过的结果

- 夹具 HTTP 200、`configured_not_verified`、控制面 `runtimeReady: true`。
- sampling 台账里的 `action: run`。
- `publish.record` 返回的 `prerequisitesRecorded: true`。它仍然是 `published: false`，发布写入仍要走既有 F23 CAS。
- 构建计划 `planned_not_built`。它没有镜像摘要。

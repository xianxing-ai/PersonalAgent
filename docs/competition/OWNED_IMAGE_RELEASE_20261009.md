# AgentArts HTTP 镜像历史预览发布记录

此处保留 `157d5769` 的 HTTP 历史产物与当时验证。当前 WSS 版本为 `97aa51a6`，获取、接口与验证见 [新版发布记录](OWNED_IMAGE_WSS_RELEASE_20261009.md)；不要用本页旧镜像替代新版 WSS 验收。

2026-10-09，Competition Profile `huawei_ict_agentarts`。本记录只说明镜像与文档工作包的实际 GitHub 发布，PR 尚未合并，真实华为部署验收未完成。

## 两位协作者直接使用

[预发布下载页](https://github.com/zemeng5208/PersonalAgent/releases/tag/agentarts-preview-157d5769) 提供 ARM64 与 AMD64 两个 `.tar`。普通 x86 Windows/Linux 电脑选择 AMD64；ARM 电脑选择 ARM64。下载后 `docker load --input personal-agent-owned-amd64.tar`，再按 [服务 README](../../apps/agentarts-runtime/README.md) 配置自己的模型凭据。Docker 需使用 Linux 容器；镜像没有内置账号、私人数据或本地工具宿主。

也可直接匿名拉取多架构镜像，Docker 按电脑架构选择：

```powershell
docker pull ghcr.io/zemeng5208/personal-agent-owned@sha256:63743fbd69f6d86b301909f1874f6e1d71fcc78a900594cf2938b28902273353
```

已使用全新、无登录凭据的 Docker 配置成功拉取并检查 AMD64 镜像。GHCR OCI index 已匿名读回 ARM64/AMD64 两项，摘要与发布日志一致；两位协作者无需共享令牌。

## 来源与摘要

- 源码 commit：`157d5769af952d36d938b3eac71dddf4a846aa1a`。
- 固定标签：`ghcr.io/zemeng5208/personal-agent-owned:sha-157d5769af952d36d938b3eac71dddf4a846aa1a`。
- 多架构 index digest：`sha256:63743fbd69f6d86b301909f1874f6e1d71fcc78a900594cf2938b28902273353`。
- [发布 Actions](https://github.com/zemeng5208/PersonalAgent/actions/runs/37941616458) 已成功；ARM64 [Actions 工件](https://github.com/zemeng5208/PersonalAgent/actions/runs/37941616458/artifacts/11620894254) 另保留至 2027-01-07，长期入口为上述 GitHub 预发布附件。
- AMD64 `.tar` SHA256：`b6a385dbf7d2f78c670672a12897aed0eed62746791ce42c56deb8daed7aa275`；来自匿名拉取后的 GHCR 镜像导出。
- ARM64 `.tar` SHA256：`573cef862e440af2e73419d39321078133b916ba4861cd906f84254a909915d4`；来自发布 Actions 的实际导出。
- 机器记录与各平台 manifest digest：[JSON](OWNED_IMAGE_RELEASE_20261009.json)。后续仅文档提交不重新标记此镜像源码；PR 文档 head 与镜像 source commit 可不同。

## 验证与边界

完整本地 `npm run check` 通过；Runtime 集成 24/24、ARM64 实际容器 16/16、匿名拉取的 GHCR AMD64 容器 16/16、阅读门槛 6/6 通过。生产入口经合成 TLS 的 9 次回环模型请求通过，未访问真实付费模型。39 模块、四 SVG、离线阅读页及 Wiki 交接已检查，设计估算仍是原工程快照。

首次远端 CI 发现全仓导航横幅误改固定摘要 Skill 资源；后续本地完整检查在前序全部阶段通过后，又发现公开演示源行号被横幅移动。当前 PR 已恢复 9 个功能性 Skill/演示夹具原件并在生成器排除；Skills 12/12、受影响 Runtime 9/9、完整集成 24/24 复测通过，没有更改固定摘要、引用行号断言或放宽校验。这些资源不在镜像 allowlist 中，此文档修复不改变已发布镜像代码。最终远端 CI 状态以 PR 当前检查为准。

此旧产物接口为 HTTP `/ping` 和 `/invocations`。当时 WSS 主通道/HTTPS 备用尚未交付；后续 `97aa51a6` 已实现并独立发布，见新版记录及 [当前接口](OWNED_IMAGE_INTERFACES.md)。Wiki 自动接入与完整常驻自主能力仍待交付，Wiki 具体实施交 goo122。华为新 deployment、真实模型/trace/usage/费用、评估和正式工具闭环仍待验收。

## PR 与合并

[PR #317](https://github.com/zemeng5208/PersonalAgent/pull/317) 已请求 goo122 和 Potatos498 评审，两人必须在各自电脑打开当前 PR 版本全部设计并提交本人阅读声明与审批，步骤见 [阅读门槛](../reviews/DESIGN_READING_GATE.md)。远端校验身份、当前 head 与内容摘要，不独立证明物理阅读。

main 保护要求两次审批、最新推送后的批准、过期审批作废、CODEOWNERS、`check` 和 `design-read-confirmations`。管理员也受约束，禁止强推/删分支；禁止强制合并、`--admin`、跳过检查或直接推 main。尚未收到两人的确认，因此保持未合并。

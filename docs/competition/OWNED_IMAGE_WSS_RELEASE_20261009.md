# AgentArts WSS 镜像预览发布记录

2026-10-09，Competition Profile `huawei_ict_agentarts`。本次 WSS 镜像、两架构离线包和完整离线设计已实际发布；[PR #317](https://github.com/zemeng5208/PersonalAgent/pull/317) 保持未合并，真实华为运行时及公网 WSS 尚未验收。旧 [157d5769 HTTP 发布记录](OWNED_IMAGE_RELEASE_20261009.md) 保留历史事实。

## 协作者获取

[新版 GitHub 下载页](https://github.com/zemeng5208/PersonalAgent/releases/tag/agentarts-preview-97aa51a6) 包含 AMD64/ARM64 `.tar`、完整离线设计 ZIP、SHA256SUMS 和机器验证 JSON。普通 x86 Windows/Linux 使用 AMD64；ARM 电脑与本次华为运行环境使用 ARM64。Docker 需使用 Linux 容器。两位协作者可匿名拉取 GHCR，无需共享发布或模型令牌：

```powershell
docker pull ghcr.io/zemeng5208/personal-agent-owned@sha256:71fae973fa5925aa3ced6a465fe4573e2b9453d4acb1fef67d91076b14399f70
```

下载 AMD64 离线包后：

```powershell
Get-FileHash personal-agent-owned-amd64.tar -Algorithm SHA256
docker load --input personal-agent-owned-amd64.tar
docker run --rm --name personal-agent-preview -p 127.0.0.1:8080:8080 --env-file .\agent.env personal-agent-owned:preview-97aa51a6-amd64
```

`agent.env` 是各自未提交的秘密配置：明确 `PA_AGENT_HOST_MODE=agentarts`、自己的 HTTPS 兼容模型入口/模型名/密钥，并设置 HTTP 入站 token 和 WSS token。配置说明见 [Runtime README](../../apps/agentarts-runtime/README.md)。容器内部监听 0.0.0.0、宿主仅绑定 127.0.0.1；本机映射不作为公开服务。ARM64 包保留固定 GHCR `sha-97aa51a6f32e0dffcca6436fba0d3b51d1851d8f` 标签。镜像不包含 Desktop、任务数据库、本地工具宿主、账号或私人云导出。

## 固定来源与校验

- 源码：`97aa51a6f32e0dffcca6436fba0d3b51d1851d8f`；[发布 Actions](https://github.com/zemeng5208/PersonalAgent/actions/runs/37953071877) success。
- 固定 GHCR tag：`ghcr.io/zemeng5208/personal-agent-owned:sha-97aa51a6f32e0dffcca6436fba0d3b51d1851d8f`。
- 多架构 index：`sha256:71fae973fa5925aa3ced6a465fe4573e2b9453d4acb1fef67d91076b14399f70`。
- AMD64 manifest：`sha256:3bd4bfa216322ad3c864d669b820b3d6acffcd2dad6a97bf36fc49f1bc3a16ec`。
- ARM64 manifest：`sha256:bcd38d221369ab3afb8fba76c457f6d15051372e015e1d63370d662cf8a853fb`。

| 附件 | 字节数 | SHA256 |
| --- | ---: | --- |
| personal-agent-owned-amd64.tar | 93430272 | `db0649cf1ea9e46be893263e9ec28e3efcd48b0e6480c67da4df9313fb55115e` |
| personal-agent-owned-arm64.tar | 298103808 | `0352ce812231f8fc1d0a52b3be2b5150223b394dd70355730b93d10902155aae` |
| resident-developer-agent-design-97aa51a6.zip | 121139 | `6f1e6242e7138d15900e5139b5a8404ec824967cc6203634d1a1adc35ee87a49` |

AMD64 包来自匿名拉取的实际发布 manifest，以架构独立 alias 导出；ARM64 包来自 [发布 Actions 工件](https://github.com/zemeng5208/PersonalAgent/actions/runs/37953071877/artifacts/11626522428)。两个包内部原始 config 摘要均与发布 manifest 一致。GitHub 附件读回 `uploaded`、大小和摘要与本机匹配。[机器发布记录](OWNED_IMAGE_WSS_RELEASE_20261009.json) 保存精确 config/manifest/附件信息。后续仅文档提交不改变镜像 source commit。

## 实际验证

匿名 Docker 配置没有登录凭据；AMD64 与 ARM64 各运行 21/21 容器测试，通过真实生产入口的 9 次合成 TLS 回环模型请求，TLS 校验开启，容器 `--network none`。实际 `process.arch` 分别为 x64/arm64，运行用户 node，OCI revision 均与源码一致。工作区敏感扩展文件、配置凭据变量及 7 份验证日志扫描无命中；这是有限检查，不宣称完整安全审计。

本地完整 `npm run check` 退出 0；最终恢复修复后 Coordination/受影响 Runtime 215/215、根集成 24/24 通过。真实子进程在首轮或确认工具后第二轮终帧立即退出，恢复后新增云调用和工具执行均为 0。真实 TLS/WSS/Runtime 离线集成验证审批、文件读回、Evidence、SQLite 重启和未知恢复拒绝，模型均为显式 Fake/合成回环。

22 章节、39 模块、四 SVG、Wiki 交接和离线搜索/缩放已更新；估算仍保留 2026-10-08 基线。设计内容摘要为 `84b2c9d7b4729c6d1cab5ec52ce31fc4f0fad061a624e8d4332f8a3d4cfba1b8`，不把整体模块完成率提高为本轮测试结果。

## 华为导入与剩余验收

同区域 SWR 私有组织 `zemeng5208-personal-agent` 已成功导入上述 ARM64 原包。控制台读回镜像 `personal-agent-owned`、唯一 `sha-97aa51a6f32e0dffcca6436fba0d3b51d1851d8f` 版本、私有类型及下载地址：

`swr.cn-southwest-2.myhuaweicloud.com/zemeng5208-personal-agent/personal-agent-owned:sha-97aa51a6f32e0dffcca6436fba0d3b51d1851d8f`

SWR 读回摘要为 `sha256:34e25482033afb6b8157d4ec2f46de31d8d576f57a39e8775bb8b95cfc80518e`，与 GHCR OCI manifest 摘要不同；本记录分别保留导入前后摘要，不声称 registry manifest 字节一致，也未独立确认产生差异的封装步骤。SWR 侧 config/layers 尚未通过独立 pull 验证。原三个云运行时保持不变，未新增委托权限。

新 `pa-owned-wss-97aa51a6` 托管表单准备 8080、前缀路由、原 defaultgw/委托与公开配置。用户须在控制台本人填写模型入口、模型名、模型 API Key、独立 WSS token 并提交新托管；秘密不进入 Git/聊天。本轮尚未创建新运行时，不能记录 deployment、真实模型、trace、usage/费用、评估或公开 Upgrade 通过。

容器 `/ws` 已实现；官方前缀映射支持普通 `/invocations/{custom_path}`，未证明网关透传 WebSocket Upgrade。部署后只验收明确配置的可信公网路径；认证/协议拒绝和已发送未知结果不得自动试路径或重发。自动 status 协调、云端持久恢复、Wiki 自动同步和完整无人监管自主闭环尚未交付。

## 两人阅读与合并

goo122、Potatos498 都须在自己电脑打开 **当前 PR head** 的阅读页、完整方案和四 SVG，并各自提交版本绑定阅读 receipt 和 APPROVE；固定 ZIP 仅用于离线分享，不能冒充后续 head 的确认。[操作步骤](../reviews/DESIGN_READING_GATE.md)。远端验证账号/摘要/版本，无法独立证明物理阅读。

原生两次审批、最新推送后批准、过期审批作废、CODEOWNERS、`check` 和 `design-read-confirmations` 继续生效。管理员也受保护；禁止强制合并、`--admin`、跳过检查、强推或直接推 main。发布镜像不代表批准或合并 PR。

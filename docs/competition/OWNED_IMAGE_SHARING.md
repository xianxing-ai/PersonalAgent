# 协作者使用 GHCR 预览镜像

2026-10-09。代码、接口和设计已提交 [PR #317](https://github.com/zemeng5208/PersonalAgent/pull/317)；最新 WSS 预览源码为 `97aa51a6f32e0dffcca6436fba0d3b51d1851d8f`，AMD64/ARM64 镜像已发布 GHCR，见 [精确标签/摘要/下载/验证记录](OWNED_IMAGE_WSS_RELEASE_20261009.md)。匿名拉取已验证，两架构镜像分别通过容器测试 21/21 与生产入口合成 TLS 9 次请求；预览发布不合并 main，也不表示公网 WSS 或华为云已验收。两位协作者使用自己的运行配置，不共享凭据。

## 获取与本地运行

镜像关联 `zemeng5208/PersonalAgent` 仓库；按 GitHub Packages 实际访问设置提供协作者读取。受信发布流程只使用 Actions 的 `packages: write` 权限，不将用户令牌、云导出或私人数据库放入镜像。

本轮固定多架构索引 digest 为 `sha256:71fae973fa5925aa3ced6a465fe4573e2b9453d4acb1fef67d91076b14399f70`，发布 Actions 为 [37953071877](https://github.com/zemeng5208/PersonalAgent/actions/runs/37953071877)。按此摘要拉取：

```powershell
docker pull ghcr.io/zemeng5208/personal-agent-owned@sha256:71fae973fa5925aa3ced6a465fe4573e2b9453d4acb1fef67d91076b14399f70
```

平台列表需从实际 manifest 读回。本轮发布流程生成 linux/arm64 与 linux/amd64，分别服务华为运行环境与常见开发电脑。私有包若要求登录，使用自己的 GitHub 凭据和 `read:packages` 权限，不共享他人 token；有仓库读权限仍应以包的实际访问设置为准。

镜像依赖真实模型配置。创建本机未提交的秘密配置文件，按 [Runtime README](../../apps/agentarts-runtime/README.md) 填写宿主配置，再绑定仅本机端口：

```powershell
docker run --rm --name personal-agent-preview -p 127.0.0.1:8080:8080 --env-file <本机秘密配置文件> ghcr.io/zemeng5208/personal-agent-owned@sha256:71fae973fa5925aa3ced6a465fe4573e2b9453d4acb1fef67d91076b14399f70
```

在容器中使用 `agentarts` 监听模式，宿主端口仅绑定 127.0.0.1；不要把 `standalone-validation` 的容器内 127.0.0.1 误当可映射入站地址。直接裸容器不作为公网安全服务。密钥不写 Dockerfile、命令历史或聊天；缺配置启动失败是预期行为，不默认替换成 Fake。

## 仓库可下载的离线副本

新版下载入口为 [GitHub WSS 预发布页](https://github.com/zemeng5208/PersonalAgent/releases/tag/agentarts-preview-97aa51a6)，按 [新版发布记录](OWNED_IMAGE_WSS_RELEASE_20261009.md) 核对源码、架构和附件校验和后加载对应 `.tar`。普通 x86 电脑使用 AMD64 包，ARM 电脑使用 ARM64 包；例如加载 AMD64 包：

```powershell
docker load --input personal-agent-owned-amd64.tar
```

下载与加载不需要共享模型密钥；镜像仍需自己的运行配置。

历史 HTTP 预览 `157d5769` 的附件仍见 [旧预发布页](https://github.com/zemeng5208/PersonalAgent/releases/tag/agentarts-preview-157d5769) 与 [旧发布记录](OWNED_IMAGE_RELEASE_20261009.md)。其 Actions 曾保留 ARM64 工件至 2027-01-07；旧附件、旧摘要与 16/16 验证不证明新版 WSS 镜像能力。

## 边界与协作

当前镜像包含 `/ws` WebSocket Upgrade、HTTP `/ping`、`/invocations` 和受保护 `/invocation-status`。WSS 客户端与显式 HTTPS 备用已接线；备用仅用于能证明 invoke 尚未发送的连接失败，已发送但结果未知的请求进入 `waiting_reconciliation` 并阻止盲目重发。容器接口及本地 TLS 验证不证明华为公网网关支持 Upgrade；公开路径和真实云验收仍待确认。云回执只有界内存缓存，`restartRecovery:false`；自动 status 协调、持久云端恢复、Wiki 自动同步和完整监管未交付。所有接口及配置详见 [镜像接口](OWNED_IMAGE_INTERFACES.md)。镜像不包含本地工具宿主，控制电脑仍经过本地 Runtime/Policy/ToolGateway 与读回。

协作者修改通过公开契约和独立分支提交；Wiki 由 goo122 实施，业务连接器和 DEV-WORKFLOWS 仍按既有所有权。合并前两人各自在自己电脑打开当前设计并提交阅读声明/审批，禁止强制合并、--admin、跳过检查或直接推 main。

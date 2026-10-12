# 自有 AgentArts 镜像 AMD64 撤销记录

日期：2026-10-12。目标 profile：`huawei_ict_agentarts`。继续 PR #317，未合并。

用户已明确取消 AMD64 路线并要求删除 GitHub 上的 AMD64 交付。当前镜像构建、容器验收、
导出与发布只以 `linux/arm64` 为目标；共享源码、本地 Windows 工具宿主和已完成的历史验证不删除。

## 发布配置

[`owned-image-preview.yml`](../../.github/workflows/owned-image-preview.yml) 的 build platforms
从 `linux/arm64,linux/amd64` 改为 `linux/arm64`，原导出步骤继续只导出 ARM64。
同一修改同步到报告校验修复工作树，未暂存或提交该工作树的生产修复。

工作流新增默认关闭的 `workflow_dispatch.retire_legacy_amd64`，清理 job 与普通发布 job 分离。
它只允许 `zemeng5208` 在 `codex/agentarts-owned-image` 上执行已核对的五个固定历史标签迁移：
先校验 ARM64 manifest 的平台、源码 revision 并实际拉取，再把标签指向同一个 ARM64 manifest。
它不删除包版本，不删除旧共享索引、attestation 或 ARM64，也不创建新凭据或扩大既有
`contents: read` / `packages: write` 权限。迁移前后 digest 和拉取记录保存在 Actions 产物中。

## 已删除的 GitHub Release 附件

以下三个 `personal-agent-owned-amd64.tar` 已通过 Release API 删除，并读回各自发布的剩余资产：

| Release | 已删除 AMD64 asset | 保留 ARM64 asset | 保留 ARM64 大小 |
| --- | --- | --- | --- |
| [0dae0ff5](https://github.com/zemeng5208/PersonalAgent/releases/tag/agentarts-preview-0dae0ff5) | `633749075` | `633749051` | 93,326,848 bytes |
| [97aa51a6](https://github.com/zemeng5208/PersonalAgent/releases/tag/agentarts-preview-97aa51a6) | `625416310` | `625416329` | 298,103,808 bytes |
| [157d5769](https://github.com/zemeng5208/PersonalAgent/releases/tag/agentarts-preview-157d5769) | `625168338` | `625168339` | 298,015,744 bytes |

完整 Release 盘点没有发现第四个 AMD64 附件。设计 ZIP、`SHA256SUMS.txt` 与
`VERIFICATION.json` 保留；其中原双架构记录是历史事实，不改写为 ARM64 证据。

## Actions 产物清点

清点仓库全部当前 Actions artifacts：五个 image tar artifact 均明确名为
`owned-agentarts-arm64-<source-sha>`，其余五个 `.dockerbuild` 是共享构建记录。
没有 AMD64 专属 Actions artifact 可删除；共享历史记录与 ARM64 artifacts 保留。
当时六条镜像发布 run 均已完成，没有正在运行的双架构任务需要取消。

## GHCR 迁移与删除边界

当前固定标签的原索引与两个可执行子 manifest 已通过 registry 只读检查核对：

- 原多架构索引：`sha256:82b7d1b0ac808ad89d2197b98871fd334084c88de9f56c016ffe29a75bd632dc`。
- 保留 ARM64：`sha256:8dc95c5b1bdfa1165f22b019daa0d3b17ae99320bda173046f2d001cc7ad437d`。
- 待撤销 AMD64：`sha256:d1dd285be6246f0628eeabdc73964847d2302363be88ad8ac0e0cf3cfb9a8bdc`。

另外四个历史标签和各自 ARM64/AMD64 对应关系固定登记在清理 job 的 allowlist 中。
删除包版本前必须先验证标签已指向 ARM64，避免删除整个共享索引或 package 使 ARM64 一并丢失。

当前状态：Release AMD64 附件已删除；仅 ARM64 发布配置已修改；五个 GHCR 标签迁移及
AMD64 专属包版本删除待执行与读回，不能把准备完成称为删除完成。
现有 gh 登录读取 Packages API 被 `403 / missing read:packages scope` 拒绝；没有扩大 OAuth
scope 或新建凭据。标签迁移使用原有 Actions 临时令牌，包版本清理使用已登录的 owner UI。

## 验证与限制

本次仅修改发布配置与撤销记录，不修改产品协议、运行时编排、数据库或协作者验收材料。
必要验证是 YAML 解析、清理脚本语法、`git diff --check` 和远端资产读回。
历史 AMD64/Fake 模型容器验证继续只代表原架构/原产物；本次清理不证明真实华为部署、
公网 WSS、模型或本地工具闭环通过。

# 自有 AgentArts 镜像 AMD64 撤销记录

<!-- current-design-20261013 -->
> 本文按所记版本阅读，API/阶段/验收事实保留。当前依据：[完整主架构](../design/workflow-architecture-20261013/DESIGN.md) · [28功能流程](../design/workflow-architecture-20261013/WORKFLOWS.md) · [连通图](../design/workflow-architecture-20261013/index.html) · [接口状态](../interfaces/CURRENT_INTERFACE_CATALOG.md) · [协作规则](../../CONTRIBUTING.md)。当前实验为本机Laya有限候选判断，资格不足升级原受信teacher，国内执行模型经AgentArts调用；自有ARM64镜像串行编排，架构未最终定型。历史部署方案不覆盖当前决定，模板数量不等于业务验收；旧双人本机阅读不作为现行要求。设计不等于实现；非作者有效Approve和真实检查仍须满足。


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

三个 Release 的当前下载说明已改成 ARM64 固定 manifest；原说明放在折叠的历史记录中，
不再作为当前 AMD64 下载入口。完整 Release 盘点没有发现第四个 AMD64 附件。设计 ZIP、`SHA256SUMS.txt` 与
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

五个历史标签已迁移成功：[Actions 38259144373](https://github.com/zemeng5208/PersonalAgent/actions/runs/38259144373)
逐个实际拉取 ARM64、核对平台及源码 revision，再把当前标签重指向原 ARM64 manifest。
证据 artifact `11751817094`（43,683 bytes）保留迁移前后 digest；原多架构索引没有删除。

| 原源码标签短名 | 原多架构索引 digest | 当前标签的 ARM64 manifest digest |
| --- | --- | --- |
| `0dae0ff5` | `sha256:82b7d1b0ac808ad89d2197b98871fd334084c88de9f56c016ffe29a75bd632dc` | `sha256:8dc95c5b1bdfa1165f22b019daa0d3b17ae99320bda173046f2d001cc7ad437d` |
| `0f2629ce` | `sha256:3f50d853c676425cc2ffdef8b8e2fa39271353dcac75c82bb8e97b5890393c76` | `sha256:4dc10ceb2b3c3e7a07c81a88b208740cc23d15c896e011752dcf5c3003ed119b` |
| `f22ee14d` | `sha256:e6728f16ea72b35f8e819dacd429692fd3fc21119a7edad0844f58a74c4812db` | `sha256:7b0e6e84a16d2fa95fbbca5a2f1e8261ee2159c1d2848e6a081287eb82578c6f` |
| `97aa51a6` | `sha256:71fae973fa5925aa3ced6a465fe4573e2b9453d4acb1fef67d91076b14399f70` | `sha256:bcd38d221369ab3afb8fba76c457f6d15051372e015e1d63370d662cf8a853fb` |
| `157d5769` | `sha256:63743fbd69f6d86b301909f1874f6e1d71fcc78a900594cf2938b28902273353` | `sha256:0e9b3971eb25c9356ae6bfe5a6698bd7cdfa4308cfcb03786dab43facfa6643b` |

在用户动作级确认“确认永久删除这五个 AMD64 版本”后，正常提交以下五项 GitHub 包版本删除：

| 原源码短名 | 已删除 package version ID | 已删除 AMD64 manifest digest |
| --- | --- | --- |
| `0dae0ff5` | `1373286850` | `sha256:d1dd285be6246f0628eeabdc73964847d2302363be88ad8ac0e0cf3cfb9a8bdc` |
| `0f2629ce` | `1367581982` | `sha256:5483decdb567a8da191ede978d09b3689d7b3c8e10184e42e020a90b7c7c9536` |
| `f22ee14d` | `1367533508` | `sha256:2ab9c16bf58ef50c804c7ed48e52ee83b938c48ba2a0682989ea119e9bf31773` |
| `97aa51a6` | `1362413497` | `sha256:3bd4bfa216322ad3c864d669b820b3d6acffcd2dad6a97bf36fc49f1bc3a16ec` |
| `157d5769` | `1361964753` | `sha256:8e4937958038f21a3c8fbafce23fa6bdca383622a948c75cafe617e4da13fbb2` |

GitHub Deleted 列表逐项显示上述五个 digest/ID，Active 列表不再含它们；独立 registry 检查
五个 AMD64 digest 全部返回 `not found`。全部五个 ARM64 当前标签均读回上述精确 digest，
前四个还独立核对配置中的 `linux/arm64` 与原源码 revision，第五个配置 blob 下载受本机网络超时影响，
其平台/revision 以此前成功的 Actions 拉取与检查为证。ARM64 镜像、ARM64 标签、旧共享索引和 attestation 保留。
旧多架构索引中的 AMD64 descriptor 只保留历史含义，不再是可用的 AMD64 下载入口。

本次配置提交 `4f351cccd3367c4236f821996fd3dcab326d994a` 触发的新预览也已仅以 ARM64 发布：
[Actions 38259123185](https://github.com/zemeng5208/PersonalAgent/actions/runs/38259123185) 成功；
当前源码标签 `sha-4f351cccd3367c4236f821996fd3dcab326d994a` 的索引 digest 为
`sha256:548f270ee25d3210984f588d52c9fc8760922aee371dc77f65ecc8a9df4546d2`，
ARM64 child 为 `sha256:4e2fe9eb654698b057b9bb5fa9d495904ec4b138870cad62dfc5309e674e7364`。
这不是报告校验/模型兼容后续修复的新镜像，不能替代后续修复构建与真实验收。

当前状态：Release AMD64 附件、五个 GHCR AMD64 专属包版本和所有当前 AMD64 下载入口已撤销；
后续构建、导出、容器验收与交付只保留 ARM64。没有删除共享源码、协作者文件、历史验证记录或华为资源。
现有 gh 登录读取 Packages API 被 `403 / missing read:packages scope` 拒绝；没有扩大 OAuth
scope 或新建凭据。标签迁移使用原有 Actions 临时令牌，包版本清理使用已登录的 owner UI。

## 验证与限制

本次仅修改发布配置与撤销记录，不修改产品协议、运行时编排、数据库或协作者验收材料。
必要验证是 YAML 解析、清理脚本语法、`git diff --check` 和远端资产读回。
YAML 解析、ARM64-only/default-off/原权限静态核对、成功的远端清理 job 与差异检查均已通过。
未执行单独的本地 `bash -n`，未宣称本地 Bash 语法检查；清理脚本在 Actions 实际执行成功。
本机 Docker 在清理后再次拉取当前 ARM64 标签时，因 Docker Desktop 直连 GHCR 的网络连接超时失败，
不是 registry 返回镜像不存在；不把该失败称为本机拉取通过。迁移证据 artifact 的本机下载一次超时、
一次 EOF，停止重复下载；远端成功 job 与产物 id/大小已读回，记录没有丢失。
历史 AMD64/Fake 模型容器验证继续只代表原架构/原产物；本次清理不证明真实华为部署、
公网 WSS、模型或本地工具闭环通过。

# #459 既有 ARM64 镜像本地核验（2026-10-21）

本记录对应 [#459 主控交接](https://github.com/xianxing-ai/PersonalAgent/issues/459#issuecomment-6311479732) 与 [PR #467](https://github.com/xianxing-ai/PersonalAgent/pull/467)，Profile 为 `huawei_ict_agentarts`。本轮只修原目录 smoke 的 synthetic proxy URL/header，并读取既有固定镜像；没有新建、构建、改 tag、推送或向镜像挂载源码/overlay。

## 结论与边界

| 表面 | 本轮实际结果 |
| --- | --- |
| SWR 固定制品 | 已读取 index、ARM64 member、config 和本机 RepoDigests，并成功 pull 该固定引用。历史匿名 401 不作为当前登录环境的阻塞结论。 |
| 本机 ARM64 进程 | 实际 exit 0，Linux / arm64 / Node v24.15.0 / UID 1000 / GID 1000。历史 exec format error 未在当前环境重现。 |
| 原目录 smoke | 实际 exit 0，10,826 ms；`/ping` 200、28 workflows、185 nodes、152 adapters，原 templateDigest / designCoverage / 逐图投影断言全部保留并通过。 |
| 整幅镜像精确源码 | **unknown**。没有 OCI revision label；SLSA 的 revision 候选与文件读回并不完全一致，构建工作区 dirty 状态未知。 |
| 当前主线云侧增量 | 已观察到下列 5 个 harness 入口/Schema 不在固定镜像；其他改动后的编译产物是否等价仍未知。目录通过不证明这些增量已经部署。 |
| 全部业务、模型、账号、设备、平台评测 | 未运行。目录/设计覆盖不等于 28 项真实业务验收，亦不证明 AgentArts 托管部署、API/trace 或原生评测通过。 |

轻量脚本修复的本轮目录实测已完成；#459 的完整源码追溯与缺失云侧产物处置仍保留，不据此关闭 Issue。

## 固定制品与环境

实际引用：

```text
swr.cn-southwest-2.myhuaweicloud.com/zemeng5208-personal-agent/personal-agent-owned@sha256:e99a48652f0dc58c6235775ef2577ead81362857e8b722c9eb18a0b4f9b1c004
```

| 身份 | 实际读回 |
| --- | --- |
| OCI index digest | `sha256:e99a48652f0dc58c6235775ef2577ead81362857e8b722c9eb18a0b4f9b1c004` |
| linux/arm64 manifest digest | `sha256:119e0cb2cbaa940e91c578d0e8030cf0c10ffff76bef3ffff07aaee917c15f8f` |
| 该 member 的 config digest | `sha256:6095b00793ecc08a46d4973e260b929d37a4cf6d8d63d65d8d03e1ddd01d6a49` |
| 本机 image inspect / RepoDigests | ImageId 读回为上述 index digest，RepoDigests 含上述完整固定引用；不把此 ImageId 误称 config digest。 |
| config | `linux/arm64`、User `node`、WorkingDir `/opt/personal-agent`、`docker-entrypoint.sh` → `node apps/agentarts-runtime/src/main.mjs`；11 层，labels 为空。 |
| 主机 Docker | Docker Desktop 4.94.0 (241994)，CLI / Engine 29.8.2，buildx v0.37.2，context `desktop-linux`。 |
| 主机/daemon 架构 | Windows CLI amd64；Linux daemon amd64，WSL2 kernel `6.18.40.1-microsoft-standard-WSL2`。ARM64 能力以实际容器进程输出证明，不冒充物理 ARM 主机。 |

实际命令使用已有合法 registry 配置；没有记录或提交 credential 值、Docker auth/config、完整环境变量或私有宿主绝对路径。公开字段及输出见 [安全回执](ARM64_EXISTING_IMAGE_459_20261021.receipt.json)。该 JSON 是实际回执的白名单投影，保留原安全输出 SHA-256；不是以叙述代替原始运行结果。

## 实际读取与进程命令

以下固定引用与参数来自实际执行；`<...>` 只表示已明确脱敏的宿主可执行文件/临时目录，不是新的镜像或源码挂载。

```powershell
$paImage = 'swr.cn-southwest-2.myhuaweicloud.com/zemeng5208-personal-agent/personal-agent-owned@sha256:e99a48652f0dc58c6235775ef2577ead81362857e8b722c9eb18a0b4f9b1c004'
docker version --format '{{json .}}'
docker info --format 'os={{.OSType}} arch={{.Architecture}} server={{.ServerVersion}}'
docker manifest inspect --verbose $paImage
docker buildx imagetools inspect --raw $paImage
docker buildx imagetools inspect --format '{{json .Image}}' $paImage
docker buildx imagetools inspect --format '{{json .Provenance.SLSA}}' $paImage
docker pull --platform linux/arm64 $paImage
docker image inspect $paImage --format '{{json .}}'
```

完整 config / provenance / inspect 在内存中投影后才保存，没有发布其 Env、构建本地目录或全部参数。最小 ARM 进程另行读取了实际安全配置，完成后删除的是本次临时容器：

```powershell
$paContainer = docker create --platform linux/arm64 --network none --read-only --cap-drop ALL --security-opt no-new-privileges --pids-limit 32 --memory 256m $paImage node -e 'process.stdout.write(JSON.stringify({node:process.version,arch:process.arch,platform:process.platform,uid:process.getuid(),gid:process.getgid()})+"\n")'
docker start -a $paContainer
docker inspect $paContainer --format '{{json .}}'
docker rm $paContainer
```

该容器实际 inspect 为 network `none`、readOnlyRootfs `true`、privileged `false`、0 mounts、capDrop `ALL`、`no-new-privileges`、pidsLimit 32、memory 268435456 bytes，原 entrypoint 未替换。进程和容器 exit code 均为 0。

## 原目录 smoke 回执

- 原脚本提交：`4d31497c9b59664f477e80672c1212d89f8f718a`，路径 `tests/manual/agentarts/local-image-catalog-smoke.mjs`；Git blob `b990e953f336bc4af487d9cf9d79aba21d5142ab`；实际脚本 SHA-256 `2aaf79989d2ed87bcfb105cb28bde41581fe23cbb9bae4a5e5bd22843621e31b`。
- 运行 UTC：`2026-10-21T08:39:01.3731276Z` 至 `2026-10-21T08:39:12.2054363Z`；记录耗时 10,826 ms；exit 0。原 catalog receipt SHA-256：`694651af661c2e0e6c2bca9923a1ac68b6bad9880ff688dd5060581c8b649758`。
- 读回 `/ping` 200；28 图 / 185 节点 / 152 adapters / 44 model assignments / 12 selected joins；UID 1000、arm64、无 `/opt/laya`。projection SHA-256：`b9603488d7d8db8dba98619de15c3627bc5dc6f49355d332de4cfea7a7f8cc65`。
- 所有 28 个实际 workflow/templateDigest/nodeCount 保留在安全回执。重复的 `designCoverage.workflows` 在白名单投影中省略；原脚本已实际断言它与 observed 全部相等。

本机只读提取固定镜像的四个云包及现有依赖到忽略目录，85 个云构件与独立镜像读取 hash 逐字节一致；没有 npm install/build，也没有把宿主文件 mount/overlay 到容器。原脚本在这个同镜像 host layout 中执行，其 host 侧 `getOwnedWorkflowDesignCoverage()` 因而来自同镜像产物，**不是当前 main 重新构建的期望值**。原脚本的生产入口仍在固定 ARM64 容器内运行。

```powershell
$paConfig = @{
  docker = '<existing docker.exe>'
  image = $paImage
  output = '<ignored issue459 directory>/catalog-receipt.safe.json'
} | ConvertTo-Json -Compress
$paConfig | & '<existing Node 24.15.0 executable>' '<isolated same-image host layout>/tests/manual/agentarts/local-image-catalog-smoke.mjs'
```

原脚本实际使用的容器路由如下，未改其参数：

```text
docker image inspect <fixed image>
docker run --rm --platform linux/arm64 --network none --entrypoint node <fixed image> --input-type=module -e <original embedded catalog script>
```

不要将独立最小进程的 `--read-only` / capDrop 参数归到本次 catalog 命令。两条路由均无 host mounts、源码 overlay 或 `--privileged`；catalog 使用原 synthetic 配置和容器内 loopback catalog 读取。回执的 `maasCalls:0` / `realInferenceTested:false` 是此测试范围声明，network none 也不允许外部模型网络；没有据此作整个平台或所有工作流调用计量结论。

## 源码追溯与实际差异

OCI config 没有 revision label。与 ARM member 关联的 SLSA 公布 `db936167e1f6d5cf546d3558a2b3a98cb135a529` 作为 `vcs:revision` / metadata revision；configSource 无可独立绑定的 URI/digest，工作区 dirty 状态未给出。该候选不能单独证明整幅镜像来自此提交。

实际镜像读取范围是 `apps/agentarts-runtime/src/` 与 `packages/contracts/schema/` 的 25 文件。比较直接使用 Git 已提交文件，另明确只做 CRLF → LF 归一化：

| 比较提交 | 结果 |
| --- | --- |
| SLSA 候选 `db936167e1f6d5cf546d3558a2b3a98cb135a529` | 22 文件仅换行不同；另 3 文件有实质差异。 |
| `a93734c195ceaff56d3e7a5654e320f3007b35f3` | 25/25 在 LF 归一化后相同；0 个原始字节完全相同。 |
| 本轮固定 main `071864ed45e68b776a7e40008fc16340a756338a` | 同一 25 文件 LF 相同；提交范围共 26 文件，新增 `packages/contracts/schema/harness-candidates.json` 不在镜像。 |

相对 db936、且与 a937 已提交字节在 LF 下相同的三处差异为：`main.mjs` 增加 Provider `responseFormat:'json_object'`；`model-proxy.mjs` 为该请求格式增加 telemetry 字段；`role-receipts.mjs` 为 failed receipt 增加四种白名单 failureStage。精确文件 hash / LF hash / db936 差异 hash 见安全回执。此 25 文件子集不是全仓、完整编译树、依赖或整镜像的源码证明；不将 db936、a937 或 main 任一项宣称为 whole-image exact source revision。

从 a937 到上述 main 的已提交云输入 delta 为 9 个文件，完整清单在回执。其中实际确认缺少的镜像路径只有以下 5 个；其他已修改 compiled artifact 的等价性保持 unknown，不能把“源有变化”推断成“镜像肯定缺失”：

- `packages/agentarts/dist/harness-candidates.js`
- `packages/contracts/dist/harness-candidates.generated.js`
- `packages/contracts/dist/harness-candidates.schema.js`
- `packages/contracts/dist/harness-candidates.js`
- `packages/contracts/schema/harness-candidates.json`

Desktop、Windows helper 和其他本机模块不纳入镜像缺失清单，也没有整包塞入镜像。

## 保留事项与恢复入口

1. 本轮 PR 只交付原 smoke 最小修复与这次固定制品本地证据；没有修改生产镜像。#459 后续仍须处理 whole-source 身份 unknown，以及上述实际缺少的云侧入口是否应进入既有镜像工程。未经另行授权，不新 build/tag/push 或以别的 AMD/GHCR 制品替换目标。
2. 如后续具备精确源码证明或按原镜像工程补齐云侧产物，先记录新旧固定 digest、来源与真正差异，再沿同一原 smoke 复测；不能复用本轮 28/185 目录通过为新制品或真实业务通过。
3. 真实 Huawei 托管部署/API/trace、平台评测、付费模型、账号和设备验收均未在本轮执行。当前证据不提高接口冻结状态，不改变 Runtime/Policy/ToolGateway 权威，也不提供 Competition 静默 Local 回退。
4. 本次文档/回执只校对内容、JSON 结构与差异，不重复跑 Docker、npm、构建或原脚本。实际运行由同一 Docker 工作者完成；轻量 PR 的独立审查、CI 与正常合并另行核对。

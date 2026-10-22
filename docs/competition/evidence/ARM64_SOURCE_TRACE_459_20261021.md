# #459 既有 ARM64 镜像输入恢复与源码关联（2026-10-21）

目标 Profile：`huawei_ict_agentarts`；本工作包属于原镜像工程 / MOD-32。源码比对基线为 `main@19ee32e1b76a824d09bede8bb8844a6a31c0e70d`，独立分支 `codex/arm64-source-trace-459`。提交前分支正常快进到远端 `e7d4e0c6f0830f7078a49438ea7d31fe39293394`；这次仅 CI 路由/文档变化，云侧比对范围无变化。本记录补充已合并 [#467](https://github.com/xianxing-ai/PersonalAgent/pull/467)，不覆盖其真实 ARM64、UID 1000、28 图 / 185 节点回执，也不重复目录测试。

## 已完成的来源闭合

已从**原固定镜像的原始 OCI 层**恢复全部 111 个保留的第一方构建输入，并找到可恢复、可复现的 Git 源候选。不是只记录一个 unknown，也没有创建替代镜像。

| 表面 | 实际结果 |
| --- | --- |
| 固定制品 | index `e99a4865…b1c004` → ARM64 manifest `119e0cb2…c15f8f` → config `6095b007…1d6a49`，所有归档 blob 的 SHA-256 与 OCI 名称一致 |
| 原输入恢复 | 全部 11 层流式检查 diff ID，包含后续 RUN 层；恢复 111 个最终文件、116 次写入版本。5 个 workspace manifest 在两次 COPY 中重复出现，不把 116 称为文件数 |
| 与旧回执一致性 | #467 既有 108 文件读回全部逐字节匹配。另恢复根 `package.json`、`package-lock.json`、`npm-registry.json` |
| 8 项生成配置 | 3 个根配置和 5 个裁剪后的 workspace manifest，与 `fe60cce4…26fef` 的原导出规则派生值**逐字节一致** |
| 29 项直拷源码 | 22 个 Runtime 文件、3 个 Schema、4 个 observability 文件，与同一候选 Git blob **LF 归一化一致**；原字节有 CRLF/LF 差异，未偷偷改写恢复文件 |
| 74 项编译产物 | 37 个精确 Git TS 源，使用锁定 TypeScript 5.9.3 和原 tsconfig 顺序编译四个云包，**74/74 原始字节一致**，0 个仅 LF 相同、0 个不同；四个程序均无 error，未跳过 emit |
| 原历史唯一 Git HEAD | 不能由以上等价性推出。旧 provenance 声明的 `db936167…a529` 与 3 个 Runtime 文件存在真实冲突；后提交的候选不是构建时 HEAD 的证明 |

完整逐文件映射见 [111 文件 manifest](ARM64_SOURCE_TRACE_459_20261021.manifest.jsonl)，包括原层 digest、原始/LF hash、对应 Git blob、来源方法和编译结果。实际编译器、37 个 TS blob、配置和类型依赖 hash 见 [emit 回执](ARM64_SOURCE_TRACE_459_20261021.emit.json)；OCI 链、层级、时间、替代候选和限定追溯范围见 [来源回执](ARM64_SOURCE_TRACE_459_20261021.receipt.json)。

恢复树 SHA-256 为 `1f798029c64a14633b69fb025bf8bb9dd7a15fb6c2bbb569c86b0c0f5c263b50`。本地原 OCI 归档为 96,164,864 bytes，SHA-256 `826170625dff104dac047fed2804b7fa346e353a43030c3a6b1a5c2d074eca0b`。原归档、依赖目录和恢复字节保留在忽略缓存，不将 96 MB 镜像、node_modules 或重复 dist 提交 Git。

## 为什么候选充分可复现，却不能代替原构建身份

镜像内与 ARM64 member 绑定的 SLSA attestation 给出：

- invocation `ybprz5ffee6d8sn0dwndf4v0x`，原 context 叶名 `context-xyzC6Y`；
- 构建 UTC `2026-10-20T09:54:21.704603206Z` 至 `09:54:25.283936147Z`；
- 声明的 revision `db936167e1f6d5cf546d3558a2b3a98cb135a529`，没有 dirty 字段；没有独立绑定完整本地 context 的 digest。

可恢复候选 [fe60cce45de113e58df5ede35a98058b1b726fef](https://github.com/xianxing-ai/PersonalAgent/commit/fe60cce45de113e58df5ede35a98058b1b726fef) 的 tree 为 `77b086593d8334ef69df0a5a9d7a2cd7ea6c3ada`，单父正是上述 db936。其提交时间 `2026-10-20T10:10:32Z` 晚于镜像约 16 分 7 秒。3 个 Runtime 改动及 7 个 TS 云侧输入已在该提交中保留，并非用后来 main 覆盖原来源记录。

将声明的 revision 解释为纯净 db936 checkout 时，`main.mjs`、`model-proxy.mjs`、`role-receipts.mjs` 与旧制品有实质差异。因此可排除“111 个输入原样来自纯净 db936”的解释，但 provenance 本身没有声明 clean。这个冲突与完整候选匹配共同支持**混合/未提交输入或 revision 元数据未准确绑定实际 context**的解释；没有原工作区快照时，不能断言究竟是哪一种，也不能仅凭缺失的 dirty 字段宣称 clean。

TypeScript 编译不是单射，原注释、格式或其他不影响 emit 的差异不能从 `.js` / `.d.ts` 唯一反推。原 Dockerfile 的 COPY 清单不包含原 context 的 `.dockerignore`、context manifest 或 Dockerfile 注释字节，不能从本回执声称恢复了它们。111 是**保留的最终 Docker 输入内容**，不是声称恢复了原仓库的全部未提交文件。候选 Git 原文、逐文件映射和重编译回执足以恢复并审查本制品对应的可复现来源包；不能把这个恢复包冒称为新找到的历史原始 context。

## 原始材料的定点追溯范围

- 当前两个既有 Docker context 各读取 29 条 BuildKit 历史，时间范围为 10 月 8–17 日；均没有上述精确 invocation。没有清理 builder 或假称所有主机都无记录。
- 文档明确的原 `27bb/Personal Agent` 工作树标准/迁移路径不在本机；精确 context 与 `.cache/verification-20261019/context-release/release.json` 未在这些入口恢复。额外只查 10 月 19、20 日 243 个 session_meta 首行，0 个对应 cwd/context，未读取消息正文。这不是全盘或所有会话不存在的证明。
- 远端构建窗口 08:30–11:00 UTC 共 66 次 Actions run，没有目标发布/preview；fe60 无 Actions run，db936 的 26 次 run 为 auto-merge/feedback。7 个 release 最晚为 10 月 16 日。
- GitHub 固定 subject attestation GET 返回 **404**，不等于 OCI 或其他外部 attestation 不存在。Artifacts metadata GET 为 200，4 页共 386 项；窗口中仅两项属于无关 calendar 分支，另 29 个命名匹配项是 10 月 9–13 日旧 preview，未命中目标 digest/invocation/context。没有下载无关大工件。
- 原 [release 脚本](https://github.com/xianxing-ai/PersonalAgent/blob/fe60cce45de113e58df5ede35a98058b1b726fef/scripts/agentarts/release-owned-image.ps1) 在发布末尾才读取 `sourceRevision/sourceDirty`。`built:false` 复用旧镜像时，这两个字段不能绑定此前构建身份；不能用发布时 HEAD 补造构建来源。

若要进一步证明唯一历史输入，需要原 invocation 的完整 BuildKit 记录或构建时 context/materials 清单，并将每文件 hash 绑定回当前 immutable 层；原构建主机上的精确 `context-xyzC6Y`、相应 context 归档或含该绑定的构建材料是具体恢复入口。后来重新生成相同输出的归档不能补造这种历史绑定。目前已完成所有实际保留字节的恢复和候选关联，不将无法从制品唯一反演的历史信息伪造为确定值。

## 离线复现与最少验证

四个手工工具只处理本地文件/Git 对象或既有编译器，不新建镜像、安装依赖、调用模型、登录账号或部署。恢复输出必须位于当前项目 `.cache/issue459/` 的新目录；拒绝 blob/diff ID 不符、路径穿越、Windows 绝对路径/设备名、来源链接、影响输入的 whiteout、链接输出祖先和覆盖既有输出。

在已配置的 Node **24.15.0** 下，先保有本轮原 OCI 归档，运行：

```powershell
$paImage = 'swr.cn-southwest-2.myhuaweicloud.com/zemeng5208-personal-agent/personal-agent-owned@sha256:e99a48652f0dc58c6235775ef2577ead81362857e8b722c9eb18a0b4f9b1c004'
$paRecovery = '.cache/issue459/source-trace/recovery-repro'
@{ archive='.cache/issue459/source-trace/owned-1.7-existing.oci.tar'; image=$paImage; output=$paRecovery } |
  ConvertTo-Json -Compress | node tests/manual/agentarts/recover-existing-image-inputs.mjs
@{ receipt="$paRecovery/receipt.json"; inputs="$paRecovery/inputs";
   candidates=@('db936167e1f6d5cf546d3558a2b3a98cb135a529','fe60cce45de113e58df5ede35a98058b1b726fef','19ee32e1b76a824d09bede8bb8844a6a31c0e70d');
   output='.cache/issue459/source-trace/recomparison.json' } |
  ConvertTo-Json -Compress | node tests/manual/agentarts/compare-recovered-image-source.mjs
```

`verify-image-source-emit.mjs` 的 JSON 输入还需要 `dependencyRoot`（从固定镜像提取的既有 node_modules）、`devDependencies`（`location/source` 对）、`recoveryReceipt`、`revision` 和新的 `output`。本轮使用的现有类型版本是 root `@types/node@24.10.1`、`@types/ws@8.18.1`、`undici-types@7.16.0` 与 coordination 嵌套 `@types/ws@8.18.2`，逐项和原 lock 校验。运行参数为 `node --max-old-space-size=512`；四包按 contracts → models → coordination → agentarts 串行，后包消费本次刚生成的前包公开 dist，不借用无关 checkout 的旧产物。

编译器本体也来自此前固定镜像的实际提取：`packages/agentarts` 将 `typescript@5.9.3` 列为**生产依赖**，故 `--omit=dev` 不会省略它。既有提取清单中的 `node_modules/typescript/lib/typescript.js` SHA-256 为 `3ae902c92cc44dace175c0e69e13a4b0899f6983c6121d76b9ab8dd5795e7675`，与实际加载的 compiler 一致；该绑定与原 lock integrity 已写入 emit 回执。额外类型包才来自原本已安装且锁版匹配的本机目录，没有从本机静默换入另一份编译器。

本次最终 emit UTC 为 `2026-10-21T10:38:23.448Z` 至 `10:38:49.838Z`，Node exit 0。首次取证工具 setup 曾漏物化 Schema、漏传 Compiler API 的 config 路径，出现 2688/2307/2591；补齐原 Git 文件和工作目录后通过，未修改候选源码、tsconfig、`noEmitOnError`，没有用 noCheck 或放宽断言消除失败。

恢复工具已有 14 项关键行为覆盖通过；受沙盒限制的 junction 夹具单项在最小权限下通过。独立审查发现祖先 whiteout 遗漏后，最小修复并单独验证一组四个祖先/根 opaque 负例。没有为证据整理重复全仓构建、产品测试、模型或目录 smoke。新增实际回执按白名单生成；111 文件敏感字段检查未发现凭据模式、私有宿主路径或 registry 认证字段，lock tarball 仅公开 `repo.huaweicloud.com`。该静态检查范围不宣称是完整秘密扫描。

## 与当前主线和完整产品验收的边界

fe60 到本轮基线 main 的云侧生产输入差异仍是 9 项：agentarts 的 `coding-repair.ts`、`harness-candidates.ts`、`index.ts`、`prompts.ts`，contracts 的 `harness-candidates.json`、三个 harness-candidates TS 文件及 `index.ts`。旧镜像确实缺 4 个 harness 编译入口和 1 个 Schema，原 [#467 明细](ARM64_EXISTING_IMAGE_459_20261021.md) 保留。

本轮仅对 **fe60** 做 74 产物编译等价验证，没有把其结果移植到 main。main 的 contracts workspace manifest 已有不同；其他修改后的编译文件是否等价仍不由“源码有差异”推断。本工作包不添加这些云侧增量、不构建或发布新镜像，不把 Desktop、TaskRuntime、Windows helper 放入云镜像。

公共接口、权限、Schema、依赖锁和数据库迁移均未改变；接口仍保持原 provisional/unavailable 边界。来源恢复完成不等于 28 项真实业务、真实模型/账号/设备、华为托管部署/API/trace 或平台评测完成，也不自动关闭 #459。此次交付为独立 PR，批准、CI 与是否集成按该 PR 当前事实记录。

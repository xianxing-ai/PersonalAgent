# CW-02 / #459 AA 镜像远端版本只读校验与 ARM64 读回离线工具（2026-11-04）

Profile：`huawei_ict_agentarts`。分支：`zemeng/cw02-459-image-readonly-check`（基于 PR #543 head `codex/pr531-cloud-persistent`）。

本工具的 `verified` 仅表示所提供的离线 JSON 字段通过一致性检查；输入本身可能伪造或来自其他来源，不能证明远端读回、物理 ARM64 执行或真实服务验收。操作者须另行提供可信来源及设备证据。
任务：CW-02「AA 镜像精确远端版本只读校验」与 Issue #459「ARM64 镜像差异核对与目录 smoke 配置修复」（负责人：zemeng5208）。

---

## 1. 覆盖矩阵与事实核查

### 1.1 基线核实
- **目录 Smoke 配置修复核实**：核对 `tests/manual/agentarts/local-image-catalog-smoke.mjs` 第 16–19 行，其 synthetic 代理配置已包含 `PA_AGENT_MODEL_BASE_URL: 'https://proxy.synthetic.invalid/inference/v1'` 与 `PA_AGENT_MODEL_PROXY_KEY_HEADER: 'x-test-key'`。基线已具备此修复，未做重复改动。
- **现有 CW-02 覆盖范围**：`packages/agentarts/src/pinned-version-readonly.ts` 实现了控制面精确部署 Pin（`runtimeId`、`runtimeName`、`endpointId`、`endpointName`、`version`、`imageDigest`）的只读关联、超时与撤销信号校验、云提案对齐检查、单次本地只读工具执行、前后部署一致性防漂移，并输出 `PinnedReadonlyCorrelation`（其中 `localTaskCompleted: false`，四面为 `verified: false`）。但它**不包含**离线读取并校验操作者导出的 Docker manifest inspect / image inspect JSON，也**不包含**离线断言目录 smoke 输出中的 28 图 / 185 节点 / UID 1000 / 无内嵌 Laya。
- **离线工具缺口**：此前仓库内有源码提取与对比脚本（`compare-recovered-image-source.mjs`、`verify-image-source-emit.mjs`），但缺乏专门针对 SWR / Docker 导出的 manifest、image inspect 与 catalog smoke 输出进行纯离线、零凭据、跨平台复核的校验工具。

### 1.2 覆盖矩阵

| 检验维度 | `pinned-version-readonly.ts` (CW-02) | `local-image-catalog-smoke.mjs` (#459) | 本次新增 `verify-image-readback.mjs` (CW-02/#459) |
| --- | --- | --- | --- |
| **部署 Pin (runtimeId/endpointId/version)** | 内存/注入端口严格校验 (拒绝 latest、版本名一致) | 不涉及 | 不涉及 (依赖镜像层数据) |
| **RepoDigests 精确匹配** | 仅校验 `imageDigest` 为 sha256 格式 | 不校验 RepoDigests 列表 | **完全覆盖**：精确匹配 `${expectedRepo}@${expectedDigest}`，拒绝 tag/latest，拒绝仓库名不符或摘要不符 |
| **远端 Manifest List 架构** | 不涉及 | 依赖本地 pull 后的 image inspect | **完全覆盖**：校验 manifest list 中存在 `linux/arm64`，显式拒绝 amd64 替代 |
| **本地 Image Inspect 架构与 OS** | 不涉及 | 容器执行前校验 `Architecture === 'arm64'` | **完全覆盖**：校验 `Os === 'linux'` 与 `Architecture === 'arm64'`，显式拒绝 amd64 替代 |
| **OCI Source Revision Label** | 不涉及 | 未读取 label | **完全覆盖**：提取 `org.opencontainers.image.revision`；缺失标记为 `unknown` 不做任何推断；指定期望 revision 时不一致即判定失败 |
| **目录 Smoke 读回断言** | 不涉及 | 运行时容器内部执行并 assert | **完全覆盖**：离线断言输出 JSON 中 28 workflows、185 nodes、逐图 templateDigest (sha256 校验)、UID 1000、arm64、无内嵌 Laya (`embeddedLayaPathPresent === false`) |
| **整体判定 `verified` 条件** | 恒为平台未验证 (`realEnvironmentAcceptance: 'not_performed'`) | 断言通过即输出 report | **严格门禁**：仅在所有真实读回字段完备且一致时 `verified: true`；缺 label 或缺 smoke 即降级为 `unverified` 并列明原因；不一致直接 `failed` |
| **网络与凭据依赖** | 注入端口 Fake | 本地 Docker 守护进程与镜像 | **零网络、零凭据**：纯离线 JSON 只读解析，不调用 Docker/网络/云端 |

---

## 2. 改动内容与文件清单

1. **新增离线校验工具**：
   - 文件：`tests/manual/agentarts/verify-image-readback.mjs`
   - 职责：提供纯函数 `verifyImageReadback`、文件异步读取 `verifyImageReadbackFiles`，以及命令行 CLI 入口（支持命令行参数 `--manifest`、`--image-inspect`、`--smoke`、`--expected-repo`、`--expected-digest`、`--expected-revision`、`--output`、`--strict`，亦支持管道 stdin JSON 输入）。
   - 安全保证：无任何网络调用、无 Docker 命令执行、无环境变量凭据探测。

2. **新增离线测试与夹具**：
   - 测试文件：`tests/manual/agentarts/verify-image-readback.test.mjs`
   - 夹具目录：`tests/manual/agentarts/fixtures/image-readback/`
     - `valid-manifest-inspect.json`：包含 linux/arm64 成员的 OCI index
     - `amd64-manifest-inspect.json`：仅含 linux/amd64 的 index（负例）
     - `valid-image-inspect.json`：包含 RepoDigests、linux/arm64 及 OCI revision label 的 inspect
     - `no-label-image-inspect.json`：缺少 revision label 的 inspect（测试 unknown 降级）
     - `amd64-image-inspect.json`：Architecture 为 amd64 的 inspect（负例）
     - `digest-mismatch-image-inspect.json`：RepoDigests 摘要不一致（负例）
     - `repo-mismatch-image-inspect.json`：RepoDigests 仓库不一致（负例）
     - `valid-smoke-report.json`：28 图 / 185 节点 / UID 1000 / 无 Laya 真实规格报告
     - `invalid-count-smoke-report.json`：工作流与节点数量不符（负例）
     - `laya-present-smoke-report.json`：存在内嵌 Laya 路径（负例）

3. **架构与权限边界遵循**：
   - 未修改 `packages/agentarts/src/{owned-workflow-data,workflow-adapters,workflow-keys,proactive-host-proofs}.ts`。
   - 未修改 Renderer（`apps/desktop/src`）、MOD-10、业务连接器。
   - 未修改 Runtime/Policy。
   - 未注入 `ownedWorkflowWorker`。
   - 未执行 `git commit`、`git push`，未改动 git 配置。

---

## 3. 本地运行命令与验证结果

### 3.1 新增工具单测 (17/17 通过)
```bash
node --test tests/manual/agentarts/verify-image-readback.test.mjs
```
输出：
```text
✔ verify-image-readback: positive case with all fields verified
✔ verify-image-readback: amd64 substitute in image inspect rejected
✔ verify-image-readback: amd64-only manifest inspect rejected
✔ verify-image-readback: tag / latest reference rejected
✔ verify-image-readback: digest mismatch in RepoDigests rejected
✔ verify-image-readback: repository mismatch in RepoDigests rejected
✔ verify-image-readback: missing revision label yields unknown and unverified (no speculation)
✔ verify-image-readback: revision mismatch when expectedRevision given causes failure
✔ verify-image-readback: missing revision label when expectedRevision given causes failure
✔ verify-image-readback: smoke count mismatch (27 workflows / 180 nodes) rejected
✔ verify-image-readback: smoke embedded laya present rejected
✔ verify-image-readback: smoke output omitted records unverified
✔ verify-image-readback: outputPath writes JSON file cleanly
✔ verify-image-readback: CLI invocation with flags
✔ verify-image-readback: CLI invocation exit code 1 on failure
✔ verify-image-readback: CLI invocation with stdin config
✔ verify-image-readback: matches historical #459 evidence receipt (unverified due to missing OCI label)
ℹ tests 17, pass 17, fail 0
```

### 3.2 脚本语法静态校验
```bash
node --check tests/manual/agentarts/verify-image-readback.mjs tests/manual/agentarts/local-image-catalog-smoke.mjs
```
返回码：0，无语法错误。

### 3.3 既有 CW-02 只读关联单测 (5/5 通过)
```bash
node --test packages/agentarts/test/pinned-version-readonly.test.mjs
```
输出：
```text
✔ pinned readonly correlation keeps the exact version, one local read, and unverified platform surfaces
✔ authorization failure, version drift and a non-readonly proposal do not execute or retry
✔ a changed deployment after the local read is not success and is not invoked again
✔ failed, unknown and missing local states cannot become correlated execution
✔ missing ports stay unavailable and a cancelled call does not touch the cloud
ℹ tests 5, pass 5, fail 0
```

### 3.4 架构分层门禁检查 (3/3 通过)
```bash
npm run check:architecture
```
输出：
```text
✔ workspace dependencies obey the documented architecture boundaries
✔ the standard check gates root integration tests after workspace build and tests
✔ the integration runner serially discovers every root integration test without filtering failures
ℹ tests 3, pass 3, fail 0
```

### 3.5 Git Diff 校验
```bash
git diff --check
```
返回码：0，无空白字符异常或合并冲突标记。

---

## 4. 明确未真验清单（Unverified List）

按照规范与真实环境边界，在当前开发环境明确列出以下**未真验事项**，严禁以测试夹具冒充平台或硬件真实验收：

1. **SWR 匿名 401 未登录未读回**：当前主机未配置华为云 / SWR 认证凭据（访问呈现匿名 401），本任务严格遵守安全规范，未读取任何私有凭据、未执行 `docker login`、未绕过 401，未直接从华为云 SWR 远端在线拉取该制品的最新 manifest。
2. **无 ARM64 主机未执行**：当前执行机为 x86_64 Linux，未在真实的 ARM64 裸金属或受控设备上运行容器进程；严禁使用 `--platform linux/arm64` 跨架构模拟器运行冒充硬件真实验收。
3. **Source revision 与 #442/#451 差异未核对**：目标固定镜像 `swr.cn-southwest-2.myhuaweicloud.com/zemeng5208-personal-agent/personal-agent-owned@sha256:e99a48652f0dc58c6235775ef2577ead81362857e8b722c9eb18a0b4f9b1c004` 在 Docker 构建时未注入 `org.opencontainers.image.revision` label；因此镜像整体精确源码版本保持为 `unknown`，#442/#451 云侧增量文件（如 `harness-candidates` 等 5 项产物）与该固定镜像之间的源码差异未在本次离线任务中重新推断或变更。
4. **目录 Smoke 未在目标镜像上实时运行**：未在当前机器执行 `docker pull` 或 `docker run` 目标镜像，未生成新的真实容器运行时 smoke 回执。


### 4.1 与既有 2026-10-21 实测记录的关系

仓库中已有 [ARM64_EXISTING_IMAGE_459_20261021.md](ARM64_EXISTING_IMAGE_459_20261021.md) 和[安全回执](ARM64_EXISTING_IMAGE_459_20261021.receipt.json)。那一轮由当时的操作者在已有合法 registry 配置的 Windows 主机上完成（Docker Desktop，Linux daemon 为 amd64），读回内容包括：

- 固定引用的 index、linux/arm64 member、config 和 RepoDigests；
- 容器进程实际 exit 0，报告 arm64 和 UID 1000；
- 目录 smoke 实际运行：`/ping` 200、28 workflows、185 nodes。

那一轮的 arm64 结论来自容器进程自身的输出，不能当作物理 ARM 主机验收。镜像的 OCI revision label 为空，因此整幅镜像的精确源码版本仍为 **unknown**。

本 PR 新增的测试用这份历史回执做离线输入，校验结果为 `unverified`，原因是缺 revision label。本次没有重新读回、重新运行，也没有改变那一轮的结论。上面第 1、2、4 条只描述本轮执行环境。

另外：没有提供 `--expected-revision` 时，即使镜像带有 revision label，本工具也只返回 `unverified`（原因 `source_revision_not_compared`）。仅凭 label 自报不能证明源码身份。

---

## 5. 操作者在合法主机上的执行步骤（零凭据记载）

操作者在已完成合规 SWR 登录且具备真实 ARM64 执行环境的宿主机器上，可按如下步骤进行完整读回与校验：

### 第一步：导出远端 Manifest 与 本地 Image Inspect
在有 SWR 只读权限的宿主上导出元数据（严禁在命令中拼接任何密钥参数）：
```bash
export PA_IMAGE="swr.cn-southwest-2.myhuaweicloud.com/zemeng5208-personal-agent/personal-agent-owned@sha256:e99a48652f0dc58c6235775ef2577ead81362857e8b722c9eb18a0b4f9b1c004"

# 导出远端 manifest inspect 为 JSON
docker manifest inspect --verbose "$PA_IMAGE" > /path/to/manifest-inspect.json

# 拉取镜像并导出本地 image inspect 为 JSON
docker pull --platform linux/arm64 "$PA_IMAGE"
docker image inspect "$PA_IMAGE" > /path/to/image-inspect.json
```

### 第二步：运行本工具进行镜像元数据只读校验
执行本脚本核实 RepoDigests、平台与 OCI label：
```bash
node tests/manual/agentarts/verify-image-readback.mjs \
  --manifest /path/to/manifest-inspect.json \
  --image-inspect /path/to/image-inspect.json \
  --expected-repo "swr.cn-southwest-2.myhuaweicloud.com/zemeng5208-personal-agent/personal-agent-owned" \
  --expected-digest "sha256:e99a48652f0dc58c6235775ef2577ead81362857e8b722c9eb18a0b4f9b1c004" \
  --output /path/to/image-readback-result.json
```
- 若目标镜像未打 OCI revision label，结果应呈现 `status: "unverified"`，`sourceRevision: { revision: "unknown", labelPresent: false }`，且 `failureReasons: []`。

### 第三步：在真实 ARM64 环境运行目录 Smoke
将测试配置注入原脚本：
```bash
cat << 'EOF' > /tmp/catalog-smoke-config.json
{
  "docker": "docker",
  "image": "swr.cn-southwest-2.myhuaweicloud.com/zemeng5208-personal-agent/personal-agent-owned@sha256:e99a48652f0dc58c6235775ef2577ead81362857e8b722c9eb18a0b4f9b1c004",
  "output": "/path/to/catalog-smoke-output.json"
}
EOF

cat /tmp/catalog-smoke-config.json | node tests/manual/agentarts/local-image-catalog-smoke.mjs
```

### 第四步：使用本工具进行元数据与 Smoke 全量一致性核验
```bash
node tests/manual/agentarts/verify-image-readback.mjs \
  --manifest /path/to/manifest-inspect.json \
  --image-inspect /path/to/image-inspect.json \
  --smoke /path/to/catalog-smoke-output.json \
  --expected-repo "swr.cn-southwest-2.myhuaweicloud.com/zemeng5208-personal-agent/personal-agent-owned" \
  --expected-digest "sha256:e99a48652f0dc58c6235775ef2577ead81362857e8b722c9eb18a0b4f9b1c004" \
  --output /path/to/final-verification-report.json
```
- 本工具将自动检验：28 个 workflow 全部包含 templateDigest、总节点数 185、UID 1000、arm64、embeddedLayaPathPresent 为 false、pingStatus 为 200。
- 只有全部要素齐备（含 OCI revision 确认）时，`verified` 才会判定为 `true`。

# DEV-WORKFLOWS 真实验收记录（2026-10-05）

<!-- current-design-20261009 -->
> 当前目标与协作规则（2026-10-09）：[完整设计](../design/resident-developer-agent-20261008/DESIGN.md) · [离线阅读/全部 SVG](../design/resident-developer-agent-20261008/index.html) · [两人确认与本机阅读门槛](../reviews/DESIGN_READING_GATE.md)。WSS 主通道、HTTPS 备用；Wiki 记忆由 goo122 接入。goo122 与 Potatos498 均确认后才可按授权合并，禁止强制合并/管理员绕过。设计不等于已实现；本文历史验收与作者记录保留，旧合并规则以当前门槛为准。

负责人：Potatos498（集中验证与真实环境执行）。关联 PR #277（MOD-33/34/36/38 实现）。环境：本机 Windows、Node 24.18、仓库锁定凭据（gh CLI 已登录账号、`~/.pa-secrets/model.env` 的 GLM OpenAI 兼容端点）。验收脚本不入仓（`.cache/dev-workflows/acceptance/`），本文件登记证据与结论。

## MOD-36 Code Review 预审——✅ 闭环

真实对象：本仓库 PR #278（当时 head d004849）。链路：真实 gh CLI 拉取 PR 与分页 diff → 真实 GLM 依 4 条可信规则预审 → 变更行锚定校验。**未调用 publish，零写入**。

- 两次完整跑通：46.8s / 48.0s，head d004849c，`evidenceRefs=3` 条真实工具调用证据；
- 第二轮产出 8 条 finding **全部精确锚定真实变更行**（含 drain 循环逐处、calendar 消息行、文档缺口）——`changedLines` 白名单提示生效；
- 数据点：第一轮无白名单时 7 条 finding 因行号漂移被丢弃（防线正确拦截），加白名单后降为 0；
- 真实模型兼容三修随此验收进入 #277（commit 7999446）：markdown 围栏剥离、越界 finding 降级丢弃、changed-lines 白名单提示。code-review 测试 10/10。

## MOD-34 CI 修复链——✅ 闭环（2026-10-06 更新）

真实对象：分支 `mod34-acceptance/failing` 注入真实类型错误（`const brokenAcceptanceAnchor: number = window.fromUtc;`）触发的真实失败 Foundation run（37293044269 / 37294953665 / 37297169038，均为 GitHub Actions 真实执行）。

### 已打通的链路（每次运行均产出完整 evidence 链）

1. `github.actions.run.list` / `job.list` / `log.read`：真实 gh 读回失败 run、job 与 12,226 字节失败日志（confirmed）；
2. `workspace.git.head`：HEAD 与 run SHA 对齐校验（confirmed）；
3. `workspace.read_text`：源文件 8,828 字节 + sha256（confirmed）；
4. **真实 GLM 归因**：输出结构化修复提案（diagnosis + 精确 oldText/newText，指向注入行）；
5. 提案校验通过后进入 `workspace.apply_text_patch`（patch-0-0）。

审批链真实生效：每轮 4–6 次 `allow_once` 逐项授权，未授权步骤全部拦截。

### 随验收修复并进入 #277 的真实缺陷

| 缺陷 | 实证 | 修复 |
| --- | --- | --- |
| ci-fix 提案解析缺 markdown 围栏剥离（GLM 必带 \`\`\`json 包裹） | 提案解析即失败 `Invalid CI repair proposal` | stripModelJsonFence（与 code-review 同源），ci-fix 15/15 |
| `perPage:100` 超 gh runner 1MB 读上限 | 真实仓库 runs 列表稳定 `EXTERNAL_FAILURE: GitHub response exceeded byte limit` | 收敛 perPage 30，保持有界页设计 |
| 模型编造 64 位 sha256（复制长哈希不可靠） | GLM 输出 `566033be…` 与实际不符，被 path+sha 校验拒绝 | 以刚读取的源快照 sha 修正提案；持久锚不变（oldText 精确匹配 + apply 自身 before-sha 核对） |
| locked-apply.ps1 的 FILETIME 在 Windows PowerShell 5.1 Add-Type 编译失败 | helper 直接冒烟编译错误，写工具恒 RESULT_UNKNOWN | 全限定 `System.Runtime.InteropServices.ComTypes.FILETIME`，5.1/7 双兼容（两版 smoke 均过） |

### 卡点的修复与最终闭环（2026-10-06）

05 日报告的 patch 层 RESULT_UNKNOWN 与恢复入口缺失，由 #290 的 `DevWorkflowPatchRecovery`（preview 校验+持久 intent 绑定+readback 仅喂本绑定 receipt）修复并合入 main（#288/#289/#290 一并集成）。

**最终闭环**（真实失败 run [37400194940](https://github.com/zemeng5208/PersonalAgent/actions/runs/37400194940)，注入 `const x: string = 12345`）：

runs→jobs→log→head→source→GLM 归因→patch（confirmed）→**真实 tsc 验证通过**→precommit HEAD 核对→**commit 创建（confirmed，d911e56，1 行字面量修正）**→push unknown→按 ADR-0003 fail-closed 等待核实→宿主核实远端未推送（not_performed，无重试歧义）→人工 fast-forward 推送+draft PR #291（验收产物，明确不合并）。

**模型对比结论**：glm-4-flash 两轮均未修到出错行（对无关行幻觉修复）；**glm-4.7 一轮精确修复**。"现场跑挂构建再修复"演示需 glm-4.7 级别模型（同端点同 Key 可用）。

### 运行环境要点（复现须知）

### 环境要点（复现须知）

- helper 副本须位于 workspace root 与 recoveryRoot 之外（本机 `$TEMP/pa-mod34-helper/`）；
- recipe `executable` 必须绝对路径；`ciFix` 必须显式传 `headBranch`/`baseBranch`；
- 模型 provider 必须显式传 `timeoutMs`（默认 30s 对长 prompt 必超时）；
- **行尾陷阱**：以 LF 写入工作区文件会让 git-tools（禁用 autocrlf 的极简 env 子进程）判定工作区不干净。复现请使用一次性隔离工作树；只在确认目标仅含本轮注入改动后恢复对应文件，避免使用宽泛的 `git restore .` 覆盖其他 tracked 修改。

## 结论

- MOD-36 真实验收闭环：#277 的 code-review 链在真实 GitHub + 真实模型上可用，评审意见可精确锚定；
- MOD-34 原现场已取得 gh→GLM→审批→补丁→真实 tsc→commit 的回执；push 返回 unknown 后由宿主核实未发生，再人工推送并创建 #291。该历史记录覆盖旧“patch 层待定位”结论；自动 push/PR 全链和最新代码在原场景的复验仍未据此完成。
- MOD-35 定位器另见其真实验收（MOD-35-TEST-LOCATE-01：注入测试定位 4:10 精确行列；真实 2639 行 CI 日志一次解析定位全部 16 项失败并命中根因行）。

本记录保留原现场验收与人工收尾边界，不改变模块为 done。#277 与 #297 续作已合并，#291 为明确不合并的验收产物；本轮未运行旧脚本或使用原账号。后续验收由 zemeng 接手，并先恢复受信宿主配置及备份证据。

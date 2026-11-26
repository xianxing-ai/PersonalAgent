# Context & Memory V2 分支审计

审计日期为 2026-11-26。工作范围覆盖 `huawei_ict_agentarts`、Desktop 受信宿主及其本地存储。所有比较都锚定该日通过远端只读查询确认的 `main` 提交。

| 引用 | 审计时提交 | 工作树或证据 |
| --- | --- | --- |
| `codex/context-memory-v2-05` | `d7fdfccf` | `隔离的 V2-05 工作树` |
| `codex/context-memory-v2-production` | `24b3fb45` | `隔离的生产接线工作树` |
| 远端 `refs/heads/main` | `802cfe913f3c16745617c7ca5044a210795dacab` | `git ls-remote --exit-code origin refs/heads/main` |
| 共享本地 `main` | `f33ef383` | 保留原引用 |
| 共同祖先、当时本地 `origin/main` | `e5a39755e0d1a5dbdaadcda76c5cd82d4a9706cd` | `git merge-base <远端提交> 24b3fb45` |

两个工作树审计开始时均为干净状态。当前工作树新增本轮报告与离线回放文件。审计仅获取远端提交对象，未更新分支引用、切换工作树或改写提交。

`24b3fb45` 的唯一父提交是 `d7fdfccf879ba242c8fc6be2d6f7ff0ca83478ec`。两个分支比较结果为 `0 1`，五个本地提交原样进入生产接线分支。以远端基线比较，V2-05 分叉计数为 `63 5`，生产接线分叉计数为 `63 6`。`git cherry -v <远端提交> 24b3fb45` 六笔均为 `+`。这确认了提交和补丁关系，同功能交叠仍需逐文件审查。

[#700](https://github.com/xianxing-ai/PersonalAgent/pull/700) 的 `a1251e0a` 和 [#704](https://github.com/xianxing-ai/PersonalAgent/pull/704) 的 `11a5b08b` 均为远端 `main` 的祖先。两个 PR 已提供长上下文配额、压缩及绑定基础。V2 在既有入口叠加分段预算、结构化摘要、回放校验和最终发送核对。提取 PR 时应保留已合并的传输上限、现有 `/compact` 行为、配置迁移与审批语义。

## 提交及拆分依据

| 提交 | 文件数 | 内容与边界 |
| --- | ---: | --- |
| `429507b4` | 13 | Context 包、预算/排序/组装、根 workspace 与接口目录，主体归 V2-01 |
| `8b28b9c0` | 11 | Conversation Memory 包、SQLite 迁移和密文端口，主体归 V2-02 |
| `7240ecac` | 13 | Runtime 结构化摘要、持久化与恢复测试，加上 SQLite 摘要写入的并发检查，后者随 V2-03 或在 V2-02 提前公开依赖 |
| `6657e0de` | 27 | Runtime 绑定与发送核对、Desktop 摘要宿主、配置与探针所依赖的 Coordination 请求测量，主体归 V2-04 |
| `d7fdfccf` | 14 | 检索与基准主体归 V2-05。固定 Desktop 摘要模型、续跑窗口测量和 Runtime 来源适配改动按实际调用方归 V2-03/04 |
| `24b3fb45` | 14 | Desktop 历史检索和 Wiki 引用校验归 V2-04。AgentArts 手工探针与诊断归 V2-07 |

两条实际检索路径共享来源原则，但仍各自持有入口。Desktop 历史读原始会话并调用本地词法索引。Runtime resolver 有会话与 Wiki 适配器，生产目前只装配明确同意的公开事实路径。接线分支遗漏了全历史后台索引、持久化片段在生产搜索的消费、本地向量生产装配和实际模型预算验收。具体等级见[模块审计](V2_IMPLEMENTATION_AUDIT.md)。

## 完整差异与合并预演

四份完整补丁保存在本工作树忽略目录 `.cache/context-memory-v2-audit/`。正文中三点比较是各分支待审净改动，两点比较含 63 笔主线演进。补丁不进入 PR。

| 比较 | 文件与增删行 | 补丁 |
| --- | --- | --- |
| 共同祖先…V2-05 | 53，+2415 / -57 | `v2-05-merge-base.patch` |
| 共同祖先…生产接线 | 63，+2888 / -65 | `production-merge-base.patch` |
| 远端 main → V2-05 | 179，+2986 / -4794 | `v2-05-main-tip.patch` |
| 远端 main → 生产接线 | 189，+3459 / -4802 | `production-main-tip.patch` |

`git diff --check <远端提交>...24b3fb45` 通过。三方合并预演在 `apps/desktop/electron/conversations.js` 有文本冲突。Desktop `main.js`、`model-api-config.js`、`package.json`、README，Runtime `agentarts.ts`、`runtime-application.ts`，以及 Coordination `agentarts.ts` 参与自动合并，仍需按生产入口验证语义。解决 `conversations.js` 时应组合上游构造与持久化行为，保留消息实际提交后才失效索引的语义，并回测载入、编辑、删除、归档和恢复。审计未应用预演结果。

```powershell
$auditMain = '802cfe913f3c16745617c7ca5044a210795dacab'
git rev-list --left-right --count d7fdfccf...24b3fb45
git show -s --format=%P 24b3fb45
git merge-base $auditMain 24b3fb45
git merge-base --is-ancestor a1251e0a $auditMain
git merge-base --is-ancestor 11a5b08b $auditMain
git log --reverse --name-status "$auditMain..24b3fb45"
git diff "$auditMain...d7fdfccf"
git diff "$auditMain...24b3fb45"
git diff $auditMain d7fdfccf
git diff $auditMain 24b3fb45
git merge-tree --write-tree --name-only $auditMain 24b3fb45
```

`merge-tree --write-tree` 只写合并预演所需的 Git 对象。保留原有两个分支和提交，后续从确认过的最新 `main` 创建新的审查分支，按[交付报告](V2_PHASE3_EXECUTION_REPORT.md)逐份提取和验证。

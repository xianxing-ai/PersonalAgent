# 旧分支与未提交草稿逐项取舍

基线：main `14049ca15bdda6e4ce6b52c836687dc5b4d98350`。以下为静态源码/Git历史审计，非本轮运行验收。patch-id独有不等于功能缺失；不恢复旧Competition/Laya架构。本清单仅使用仓库相对路径，供PR索引引用。

## 16个历史分支

| 分支 | 审计提交 | 结论与当前证据 |
| --- | --- | --- |
| `codex/dep05-tool-catalog` | `7b53d1d0`, `d026fda9` | 已替代：Runtime `tool-catalog.ts`仍有RuntimeCompetitionToolCatalog/assertProposal/assertSelectionCurrent；#302 `cc64ebdf`扩展投影与worker能力，#350 `2009d4c1`更新消费测试。不补旧目录实现。 |
| `codex/mcp-capacity-repair` | `72566e79` | 已集成：main remote.ts在发送/建run前容量拒绝；`tests/integration/remote-mcp-capacity.test.mjs`与旧blob完全相同，#369 `5c5b90c3`。 |
| `codex/mcp-capacity-runtime` | `63111540`, `97df9df3` | 已集成：remote.ts readRunReceipt/终态retire、Runtime isToolExecutionActive，#371 `e9545ec3`。remote-mcp-host.js、tool-execution-handoff/remote-receipts/remote-mcp-capacity-runtime测试与旧blob相同。 |
| `codex/mvp-twin-b-interest-rechecks` | `e8e2409b` | 纯函数/测试仍独有；以本目录patch归档。没有现行宿主接线，不直接合入现行包。 |
| `codex/pr352-doc-fix` | `dbd5bb6a` | 已被#349 `14049ca1`收录：offline index.html与currentNotes.ts两个blob完全相同；不重复恢复。 |
| `codex/zemeng/agentarts-evidence-docs` | `edba78b8`, `24b73203`, `cd5d198e` | 历史synthetic repair、发布/trace和后续unknown均已保留在manual README/REPAIR-CANDIDATE-ADAPTER/TOOL-INVOCATIONS-MVP；后者200-213行仍明确第二请求unknown、不能精确join/盲补发。后续#392改横幅不等于证据丢失。 |
| `codex/zemeng/desktop-workflow-input` | `e9222378` | main.js:1677已条件原值传PA_AGENTARTS_WORKFLOW_GOAL_INPUT，#104 `a89caa9d`。旧单独review阶段记录无需复活。 |
| `codex/zemeng/mod11-coding-utf8-acceptance` | `81ef55cf` | locked-apply.ps1:152已有Console InputEncoding UTF8；#277 `53e62748`后续保留。 |
| `codex/zemeng/mod11-voice-sis-desktop` | `34efc0f7` | mail-controls.js:12-13、style.css:65-66已有同一consent class/样式；#236 `5790696e`。 |
| `codex/zemeng/mod11-windows-desktop` | `7c9bb000`, `1883aefb`, `ce73d8e4`, `8cc56c75`, `3f2edafd` | Runtime prepareHostToolTask与现notepad-host.js替代旧windows-notepad-host；保留Host expiry最小边界及审批前ready。系统观察经main的createPublicConnectorHost/systemObservationFactory与product-tools-composition接线，不恢复第二宿主。 |
| `codex/zemeng/mod13-management-provider` | `7c9bb000`, `1883aefb` | 与上一分支重复的两提交，现prepareHostToolTask/Notepad链已覆盖，去重。 |
| `codex/zemeng/mod14-voice-session` | `bda65168` | main voice/huawei-sis.ts和index已有recognition/output ports，Desktop消费并由 `b4f97df6`增强请求签名隔离；不恢复旧实现。 |
| `codex/zemeng/mod16-pipe-bridge` | `693a56e1` | HostService.cs:204/222已有CheckTargetReady，HostWire保留ready-result与boolean校验；`f7e0c4ce`后续修复ready。 |
| `codex/zemeng/mod17-windows-state-host` | `e70e04f7` | 与8cc56c75的旧WindowsStateHost重复；现public-connector-host.js已通过systemObservationFactory装配受限工具，不恢复旧cloudExport结构。 |
| `codex/zemeng/voice-recognition-adapter` | `a9d83a6d` | PowerShell host与旧blob完全相同；TS保留白名单env:environment，#330 `c4909b0b`继续强化deadline/释放。 |
| `desktop/orb-motion-settings` | `38837759` | 语义repair预览仍独有，以本目录patch归档；旧DTO提取器不合格，现#313异步/状态保护不得回退。后续适配不得覆盖两个活跃对话。 |

## 隔离编码旧树10项草稿

| 相对路径 | 取舍 |
| --- | --- |
| `apps/agentarts-runtime/src/binding-dispatch.mjs` | 不恢复旧competitionCoding catalog字段；#382 `acf51a06`已有原F15公开链。 |
| `packages/agentarts/src/index.ts` | 不恢复getCompetitionCodingCapability/独立fast coding分支；已有coding-repair/owned-workflows。 |
| `packages/coding-tools/src/index.ts` | 不恢复第二套exports；已有createIsolatedCodingRepairHost/Tools及快照/验证导出。 |
| `scripts/checks/architecture.mjs` | 不恢复readProductionWorkspaceGraph重复入口；main已有repair-verification manifest图。草稿的validationDependencies含dev/test边，而当前图仅dependencies：保留为待反例核验线索，无本轮测试，不宣称bug成立。 |
| `apps/agentarts-runtime/src/laya-decision-policy.mjs` | 不复制源码：0.05 margin/0.01 entropy工程阈值未校准，无现行接线证据，Competition路线已撤销。详见README。 |
| `docs/adr/0024-competition-isolated-coding-verification.md` | 不恢复旧provisional ADR/编号/Competition Laya决定；现ADR0033及F15 V6覆盖隔离、修复、CAS与STALE。 |
| `packages/agentarts/src/competition-coding.ts` | 不恢复独立prefix/DTO/运行入口；当前contracts/coding-repair及Runtime coding-repair-application提供公开链。 |
| `packages/coding-tools/src/isolated-workspace.ts` | 不恢复第二会话/回写体系；isolated-repair.ts已实现snapshot/隔离/check/publish/reconcile。 |
| `packages/coding-tools/src/workspace-files.ts` | 路径、秘密/生成物排除、canonical/链接拒绝与读前后版本核验由repair-verification.ts覆盖。 |
| `packages/coding-tools/src/workspace-verification.ts` | 快照/图digest/STALE/反向闭包由repair-verification.ts覆盖；dev/test声明依赖差异仅列待核验线索，不恢复整套旧协议。 |

仅归档两份原始完整文本patch；不将“有独有源码”表述为“应恢复上线”。旧测试源码保留是可审查证据，不是本轮通过记录。

# 未适配实现候选源码归档（2026-10-18）

这是可审查的历史源码归档，不是现行实现。两个patch完整保留原提交的文本差异、原文件路径和测试源码；没有应用到 `packages/` 或 `apps/`，没有接线、新协议或本轮测试执行。原patch内的状态、授权、测试通过等文字只代表当时记录，不能当作当前验收。

审计基线为 main `14049ca15bdda6e4ce6b52c836687dc5b4d98350`。当前产品方案为 **Local-only：Competition 不调用 Laya**。此归档不修改运行时，也不证明方案已经在部署中生效。完整逐项取舍见 [recovery-inventory.md](recovery-inventory.md)。

## 归档格式与校验

导出使用 `git show --unified=0 --full-index --no-ext-diff --no-renames`，元数据格式为 `commit %H`、`parent %P`、`Subject: %s`，有意省略姓名/邮箱。采用zero-context（无上下文）完整差异，省略未变化的上下文行，不删除任何原提交增删代码；避免空白上下文行在归档文件中被识别为尾随空格。文本以UTF-8无BOM、LF写入；完整diff不作语义编辑。两个提交都只有文本文件，没有二进制payload。扫描未发现邮箱、个人Windows绝对路径或二进制patch。

本目录 `.gitattributes` 对 `*.patch` 设置 `-text`，避免Windows换行自动转换改变所记录的字节与SHA-256。

只执行了文件读回、SHA-256计算、`git apply --numstat` 的纯解析、差异/敏感信息检查；没有 `git apply` 实施、测试、构建、commit或push。重新导出的解析结果仍为兴趣候选5文件312行新增，Goal候选3文件619行新增/3行删除，与下方原文件清单一致。patch是供审查的源码证据，不保证适用于当前树；zero-context格式也不构成可直接应用当前树的依据。

| 文件 | 原commit / parent | patch SHA-256 |
| --- | --- | --- |
| [interest-reevaluation-e8e2409b.patch](interest-reevaluation-e8e2409b.patch) | `e8e2409ba6ce7fc27a5bea9795990de3551ae1d1` / `02dcbca30801d550dbf60983c08a3052e8d5d4b6` | `5473aae609db62a36fb64c05fde47f6d83e57861b5a717af9db9670be7a9cd61` |
| [goal-repair-preview-38837759.patch](goal-repair-preview-38837759.patch) | `388377595940db4ac2045614fb170a056ffaa1dd` / `e6e0fc558ed8a4337fa99f23a658b8c3998b5068` | `e799c1c6e6842f83736a64e14426c2ca83bdaeb7f947459ba2c2a02fe7c4be49` |

## 兴趣复评去重候选

原文件清单：

- `docs/modules/MVP-TWIN-B-INTEREST-RECHECK-01.md`（43行新增）
- `packages/cognition/README.md`（7行新增）
- `packages/cognition/src/index.ts`（2行新增）
- `packages/cognition/src/interest-reevaluation.ts`（140行新增）
- `packages/cognition/test/interest-reevaluation.test.mjs`（120行新增）

仍独有的是 `planInterestReevaluation`：严格规范化来源证据、拒绝冲突同ID、稳定fingerprint/workKey、基于证据/权限时效边界复评、重复轮询保留原policyExpiresAt；测试包含这组纯函数行为。基线main不存在该函数、源码或测试文件。现有 `knowledge-reevaluation.ts` 与 Desktop `knowledge-watch-host.js` 的来源复检submissions/workKey去重服务不同输入，不证明兴趣入口已实现同一planner。

已由main承担的部分包括 `buildInterestOptions`、interest-policy，以及已有知识复检和持久Runtime任务。不得把候选包装成第二调度器/任务库。原提交本身只有纯函数、exports、文档和测试，没有可信宿主消费接线；未来需在Runtime持久受理后保存checkpoint，并验证当前deadline、权限和去重语义。原文涉及Laya的旧说明不适用于Competition；任何Local实验也需另行确定范围。

## Goal修复计划预览候选：尚未满足消费契约

原文件清单：

- `apps/desktop/src/features/conversation/goal-view.css`（28行新增）
- `apps/desktop/src/features/conversation/goal-view.js`（342行新增、2行删除）
- `apps/desktop/test/goal-view.test.mjs`（249行新增、1行删除）

仍独有的是 `extractRepairCandidate`、`projectRepairPreview`、`renderRepairPreview`、预览样式及5组新增测试，涉及受影响/保留计划、理由/依赖版本及pending/conflict/insufficient展示。main已有 #313 `93da52ef` 的任务状态、审批/取消锁、异步上下文和waiting_reconciliation反馈；这些部分不能由旧patch回退。

**旧DTO猜测未合格**：提取器尝试 `task.repairCandidate`、`task.repair`、`task.result.repairCandidate`、`task.approval.repairCandidate` 等多种形态，不能作为当前公开协议的依据。不得直接cherry-pick或应用到当前UI。将来需从公开合法读回重新适配、保留现有异步保护并验证实际渲染；不能以旧fixture通过代替现行消费验收。

用户正在工作的 `native-reasoning-slider` 和 `live-task-visibility-fix` 两个对话/工作区完全不动。后续适配必须先确认文件所有权，不得覆盖它们的修改，也不得把本归档作为许可来源。

## 未归档的Laya阈值草稿

旧未提交 `laya-decision-policy.mjs` 有独有源码，但目前只有工程预设 `minimumMargin=0.05`、`minimumEntropyConcentration=0.01`、`calibrated:false`，以及来源集合校验/严格扩来源辅助函数。未发现校准标签、评估或当前接线证据；其Competition路线已撤销。故本次**不恢复、不复制该源码**，也不将其混入上述两个候选。来源集合工具的潜在通用用途不足以证明需要新增产品代码。原文件保留在原草稿树；其余10项旧隔离草稿也不整套带回。

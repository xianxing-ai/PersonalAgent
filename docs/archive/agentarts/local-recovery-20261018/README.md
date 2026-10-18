# 自有镜像历史资料归档（2026-10-18）

范围：两份旧验收/合成评估说明及24例合成夹具。**historical_claim / not_reverified**：原文通过、漏洞、baseline/fixed与分数均是旧固定版本作者的历史记录，本次仅做公开副本整理和静态校验，没有重跑测试或旧 cache runner。

当前 Competition 不调用 Laya；本归档不恢复旧路线、不改运行时/模板身份、不证明平台部署、真实账号工具、设备、150ms或全部业务验收。当前入口：[Competition Profile](../../../competition/HUAWEI_ICT_AGENTARTS_PROFILE.md)、[绑定规范](../../../competition/OWNED_IMAGE_BINDINGS.md)、[F15编码修复](../../../competition/CODING_MINIMAL_REPAIR_V6.md)。历史“最小计划修复”24例与后续F15“编码修复”不同，不相互充当验收。

## 文件和来源

- [旧绑定验收矩阵](OWNED-IMAGE-BINDING-ACCEPTANCE-MATRIX.md)：来源逻辑路径 `docs/modules/OWNED-IMAGE-BINDING-ACCEPTANCE-MATRIX.md`，源码基线0dae0ff5。保留当时源码/镜像/平台/真实闭环四层状态与示例，不把当时 pending 覆盖后来证据。
- [旧计划修复评估](OWNED-IMAGE-MINIMAL-REPAIR-EVALUATION.md)：来源逻辑路径 `docs/modules/OWNED-IMAGE-MINIMAL-REPAIR-EVALUATION.md`。原文的24例结果及7/8项变异计数自述未在本次复核，不替作者重写旧计分。
- [24例合成JSON](minimal-repair-cases.json)：version2.2.0，全部synthetic；baseline0dae0ff5、fixed c5e9222为旧身份。只替换私人 fixedTargetWorktree 元数据路径，未修改case输入/期望或计分内容。
- [来源与公开散列](provenance.json)：记录原文件SHA256及公开副本SHA256、字节数和转换；这些是**脱敏公开副本，不是原字节备份**。原件留在原工作树，本次未修改。

个人绝对路径改为 `historical-worktrees/...` 逻辑标签；源码file链接转换为固定旧commit的GitHub链接。公开Markdown统一LF并移除行末硬换行空格，旧评分正文不变。外链只是历史源码定位，本次未验证所有旧URL可用。文档引用的旧 `.cache/minimal-repair-eval.mjs` 未审计、未归档、未执行；不要把原命令直接当当前可运行说明，也不承诺24例当前可运行。

公开副本保留环境变量名、公开资源示例与代码字段，不包含凭据值；静态检查排除了个人绝对路径、file URI及明显密钥字面值。此检查不是对外部旧runner或账户安全的全面审计。

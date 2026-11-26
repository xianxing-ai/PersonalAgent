# F10_N05 引用和主张审查边界（2026-10-29）

- 实现：`apps/runtime/src/application/workflow-f10-supported-claims-host.ts`。可选工厂需要原图 frontier 和授权复核、仅从已确认 N02/N03/N04 回执解析的主张、带版本的来源读回、对准确主张与原文发给指定模型的独立出机授权、经现有 ModelGateway 的独立审查，以及最终输出授权。缺任一可信口时不注册。当前此工厂**未在 Desktop/Runtime 组合注入**；注册与真实链路仍待完成。
- 图 HostBridge 输入固定为空，由可信宿主解析原回执而非允许模型自选来源。每条来源必须版本一致且包含原文引述；审查前后重新读回并比较。导出仅接受原 HostTask 成功、confirmed run 与 Evidence 绑定的完整结果，并在授权前后检查主张摘要、来源和版本；不重复调用审查模型。审查结果为 supported / contradicted / unknown，unknown 不提升为事实；原文和主张正文不包含在回执中。
- `resolveBoundFindings`、`readCitation`、`reviewClaim` 和 `assertCurrent` 是受信注入义务，本代码不证明传入实现真实履约，也不会创建另一个模型入口或验证系统；连接前须证明来源授权、原图 lineage、独立模型配置、真实读回和隐私导出规则。模型审查依然可能出错，不能将审查标签当人工事实核验或来源真实性的证明。
- 验证：Node 24.15 执行 `node node_modules/typescript/bin/tsc -p apps/runtime/tsconfig.json` 通过；`node --test apps/runtime/test/workflow-f10-supported-claims-host.test.mjs` 5/5 通过，均为 Synthetic 端口。覆盖缺口不注册、模型出机授权拒绝时不调用、回执与导出授权、引用/版本漂移、unknown、撤权及错误脱敏。尚无真实来源、真实模型、Competition Desktop 或整图回执测试。
- 归属：knowledge/Runtime 宿主由本轮 Owner 授权代 goo122 完成可选工厂；research 接入仍需与 Potatos498 对齐。152 项清单不因 Synthetic 工厂存在而勾选。

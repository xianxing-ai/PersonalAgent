# 本地遗漏交付逐项核对与补交（2026-10-18）

Owner要求逐项核对后，只补交未被后续实现替代的代码、文档和历史测试证据；保留原始本地文件，不接管另两个正在实施的对话。本轮固定审计基线为 `main@14049ca15bdda6e4ce6b52c836687dc5b4d98350`。登记的70个工作树、309个本地分支与当时393个实时远端分支均已检查；已下载缺少的10个远端对象后重新比对，未把过时remote-tracking refs当成远端事实。

当前产品决定保持 **Laya仅独立Local实验、Competition不调用Laya**；本补交没有修改生产模型、Runtime、镜像、工作流身份、公开契约或运行配置。文档确认也不证明线上已完成Profile隔离。没有手动测试、构建、CI重跑、模型/设备调用或镜像发布；正常提交自动触发的CI另行查看。

## 实际补交

| 补交内容 | 位置与边界 |
| --- | --- |
| 三份同输入诊断程序 | `tests/manual/agentarts/laya-controlled-ablation.mjs`、`laya-controlled-worker.py`、`summarize-laya-ablation.mjs`。仅手动Local诊断，不被生产入口或CI自动调用 |
| Laya三轮完整旧记录 | [原始证据与恢复说明](../competition/evidence/laya-ablation-20261015/RECOVERY-20261018.md)：14份原始文件逐字保存；其中manifest绑定的13项文件SHA/字节数一致，452+56+84条原SDK观测记录与计划摘要相符。较早两轮启动器版本不同如实保留，不补造缺少的源码快照 |
| 两份独有实现候选及测试 | [源码patch归档](../archive/implementation-candidates/20261018/README.md)：兴趣复评去重、Goal修复预览。旧提交和父提交可追溯；未应用到当前源码、未接线。尤其Goal旧DTO猜测尚未合格，不能直接cherry-pick |
| 前端交接与MOD-32历史任务 | [前端整理稿](../design/frontend-collaborator-20261017/README.md)、[MOD-32 CLI记录](20261017-mod32-cli.md)，只恢复遗漏的职责/边界信息，保留当前四人治理、CW表和后续代码事实 |
| 旧绑定矩阵、计划修复评估与24例合成夹具 | [历史归档及来源清单](../archive/agentarts/local-recovery-20261018/README.md)。与F15编码修复分开；历史自报结果没有重新验证，公开副本的本机路径脱敏不冒称原字节 |

## 未重复提交的项目

完整的生产候选比对见[16个历史分支与10项草稿清单](../archive/implementation-candidates/20261018/recovery-inventory.md)。判断采用符号、当前调用方、Git内容与后续提交，不以“旧文件名不存在”或“patch-id不同”当作缺功能。

| 本地来源/项目 | 处置与后继 |
| --- | --- |
| 旧 `competition-coding-isolation` 的10项草稿 | 固定F15、公开coding-repair协议、`isolated-repair.ts`与`repair-verification.ts`已承担隔离/验证/写回，不恢复第二套工作区、DTO或循环。未校准的Laya阈值草稿随撤销路线排除，原文件保留 |
| MCP容量两分支 | 当前`remote.ts`终态回执回收与Runtime标记已交付，部分测试逐blob相同，不重复补交 |
| UTF8补丁、SIS、语音进程环境、Workflow输入、邮件许可、原生target-ready、Notepad与系统观察 | 当前生产链已覆盖或增强；逐符号/提交依据见清单，不恢复旧版本 |
| 旧`#349/#352/#393`本地集成候选 | 当前远端已有更完整集成，查看器源/产物已由#349收录，不补旧主线同步提交 |
| `docs/design/cloud-laya-workflows-20261013/{README,V1,V2,V3,ASTRA-REVIEW,FINAL-SPEC}.md` | 旧云内唯一Laya路线已撤销；当前详细设计、工作流查看器与ADR已有后继，不再增加平行“最终稿”或将旧模型评审冒充GitHub批准 |
| 原Node设计工程README及两个未消费图标 | 当前仓库查看器覆盖主要源码和运行说明；旧README快照过期，图标无消费，不补脚手架冗余 |
| 独立设计目录中的旧HTML/固定本机路径Python服务器 | 已被当前Node查看器/导出入口替代，不恢复旧服务器或覆盖旧副本 |
| 旧`output/`参赛材料、截图/ZIP及两个孙悟空创意HTML | 保留独立历史/创意原件，不作为当前产品实现或F15平台验收补丁；不把整个输出目录带入产品PR |
| 临时`adr-renumber.patch`/`merge-queue.sh`、`.codex`环境文件 | 开发辅助及本机状态，不是产品源文件，不公开补交 |
| 旧共享Laya树的102项暂存状态 | 58份存在的文件已有远端相同内容，44项为删除；未清理、提交或覆盖该旧索引，不能将102项都声称为新漏交 |

32个当前远端不可达的历史本地分支头中，16个未发现相对main独有的非合并补丁；其余已按语义逐项核对。Squash、分支退役及后续改写不等于代码丢失。没有把内部Codex snapshot/turn-diff引用算成用户已提交的项目成果。

## 保留的未完成项

- 兴趣去重候选尚未选择/接通当前合法消费者；原测试源码归档不等于今天执行通过。
- Goal预览候选需要明确公开修复读回契约，不能消费猜测字段；不触碰进行中的Live/子会话与原生思考滑块工作树。
- 旧验证图含dev/test依赖、当前修复图采用生产依赖，是待构造反例的工程线索，不在本次当成已证实缺陷或直接扩展验证规则。
- 历史计划修复夹具未重新绑定当前runner；不声明24例当前通过。Laya旧实验不能证明150ms、生产资格或AgentArts端到端。

本PR的完成对象是可审查的遗漏资料补交及去重记录，不是以上候选功能的集成完成。原工作树、未提交内容和两个活动对话全部保留。

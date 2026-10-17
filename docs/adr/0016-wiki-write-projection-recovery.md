# ADR-0016：Wiki 写回与记忆投影恢复

<!-- current-design-alignment-20261015 -->
> 2026-10-15适用性：本页保留原日期、作者与accepted/proposed决定；仍适用的Runtime/权限/依赖边界不被撤销。
> 冲突的部署、默认模型、发布、完成事实及旧协作门槛已由[当前设计](../design/CURRENT_DESIGN_20261015.md)更新（superseded），
> 不把历史未验状态套到当前，也不把ADR存在当当前验收。[全部设计导航](../design/README.md)；当前接口另见[目录](../interfaces/CURRENT_INTERFACE_CATALOG.md)。

- 状态：proposed；`huawei_ict_agentarts` 离线增量
- 日期：2026-10-10；负责人：goo122
- 关联：ADR-0009、ADR-0015、MOD-08I

## 决定

复用 `knowledge.apply_note_patch`、ToolGateway/Policy、原操作持久备份及读回记录。
精确 edits、expectedSha256、源配置及选中文件仍由既有工具校验；不新增正文写入入口。
正文文件与 Memory SQLite 没有跨存储原子事务，正文写入成功与投影完成分别记录。

受信 `createTrustedKnowledgeTools` 可注入只做来源重校验的 projection port。在原
TaskRuntime 内、正文派发前持久记录 sourceId/configRevision/path、原 runId/参数摘要及
配置绑定；每个 run 独立记录，不覆盖同任务此前的待恢复操作。记录不含正文或记忆摘要。

工具返回已验证回执后将投影标记 pending；精确匹配的无变更/冲突回执直接 complete。
来源重校验只撤回已有确认事实的失效引用，新正文不自动生成确认事实。失败保留 pending，
不将已知写入成功改成未知或重做正文；并发恢复共享一次检查，重复检查不追加相同撤回。
恢复仍检查当前来源配置、期限和取消信号，切库/撤销后保留待恢复记录，不借旧记录读取新库。

写入中断、无已知回执时保留 unknown。投影恢复不触发工具、Policy 授权或正文写入；
只有既有 Runtime 原操作核实器读取原 intent、execution、真实来源并成功 finalize 后，
才接受该已知结果并恢复投影。历史无投影记录的任务继续兼容既有核实器。

2026-10-12 原写入恢复修正：原核实器检查 intent/execution/摘要/Evidence 并成功 finalize 后，
工厂按检查点保存的原 sourceId/configRevision/path 与摘要确认已知回执，将投影由 unknown
转为 pending；该步骤不读取来源，也不更新原投影绑定。普通工具回执仍需当前完整绑定。
finalize 不执行投影读取，调用方先让 Runtime 提交原终态，再通过既有 recoverProjection
独立恢复。recover 仍核对当前完整配置与来源租约；配置已变或撤销时保留 pending，不能
借原操作的完成结果获取新投影许可。无新增重新绑定或隐式重新授权入口。

Desktop 重启遍历 Runtime 分页任务检查点，恢复已知 pending；管理页“核实原整理任务”
显示原任务状态和投影是否待恢复。恢复不能改变 TaskRuntime 的终态，也不恢复已撤销权限。

## 兼容性与限制

新增 host-only 可选端口与 Runtime 检查点键，无新 wire capability、数据库迁移、依赖、
调度器或跨库事务。旧调用方不注入端口时保留原行为。接口仍 provisional，需非作者评审。
不引入 watcher/全库索引、自动私人 Feed/Goal 绑定、云发送、Obsidian 插件或备份清理权限。
原文件写入备份仍由原工具保存，私人备份与下游跨库删除需单独纳入管理副本清单后验收；
本包只对公开合成笔记执行真实写入，不扩大私人 Vault 的授权范围。

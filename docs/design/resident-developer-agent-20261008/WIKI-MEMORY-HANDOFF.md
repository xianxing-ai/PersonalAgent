# Wiki 记忆接入：goo122 实施工作包

2026-10-09；状态：设计交接，尚未实现。目标：`huawei_ict_agentarts`。唯一交付负责人：**goo122**。本文件按用户要求明确实施责任，不表示已向某个聊天或智能体发送消息。

## 目标及所有权

将 Wiki 纳入长期语义记忆：Wiki 管理知识正文及来源版本，Memory 管理受授权的结构化事实/检索投影，变化通过 FactChangeFeed 触发 Goal/Cognition 增量核实。复用既有知识与记忆端口，不新建任务库或执行器。

- goo122：`packages/knowledge/`（MOD-08）、`packages/memory/` 与 `packages/learning/`（MOD-09）；必要的 contracts、Runtime、Policy 接线由本工作包负责并说明兼容性。
- zemeng：MOD-27/28 消费端、AgentArts 的受限数据投影及 Desktop 产品体验；只通过公开端口集成。
- 保留其他协作者修改；在实际工作树确认基线和未提交内容后开工。同一共享文件串行编辑，依赖状态以当前接口目录为准。

## 现有可复用基础与限制

`KnowledgePort` 当前公开 `search`，返回 vaultId/path/line/revision 与 excerpt。只读端口不能被假装已有通用 Wiki 写入 API。独立受控写入口 `knowledge.apply_note_patch@1.0.0` 已有 baseline、精确替换、备份、锁内哈希读回及未知结果协调基础；不是完整崩溃原子写入。可信源配置绑定 sourceId/configRevision，写与出机许可当前仅会话有效。

Memory 已有 provisional MemoryQueryPort、FactChangeFeedPort 与 SQLite 版本/水位线/幂等基础。自动 Wiki 索引、LLM Wiki、安装式 Obsidian 插件及全链路自动同步未交付。README 中较旧的 Fake 状态不能覆盖后续增量；后续代码存在也不能自动提升冻结状态。

具体 Wiki 产品未指定。由负责人在本公开边界内选型；本地 Markdown/Obsidian 是可复用起点，在线系统作为适配器替换，不默认新增云账号、插件或付费服务。

## 契约与数据流

1. 受信宿主绑定来源、namespace、范围与数据级别；模型/Renderer 不能提交任意根目录或云账号。
2. 读取页面和精确源 revision；来源引用保留页面身份、位置、configRevision、原始资料证据与有效期。
3. 形成经授权的事实或检索投影。显式区分用户确认、外部观察与模型推断，不伪造确认。
4. 同一来源 revision 重放不重复发事件；手工修改/移动/确认删除使旧投影失效或撤回。
5. 消费方检索时校验最新版本和权限；来源变更返回 SOURCE_CHANGED/核实流程，历史内容不能冒充当前事实。
6. 记忆整理仅生成候选补丁，经原 Runtime/Policy/ToolGateway 写回；expectedSha256、精确 edits、备份和读回一致。
7. 写后复用统一来源采集更新投影，以 operation/revision 去重，避免双向回写循环。
8. 正文写入与 SQLite 投影之间用可信 pending/receipt 恢复；不能承诺跨存储原子性，不重试未知写入。

新增页面身份/同步端口必须按公共契约流程发布，标明 provisional 与错误码；禁止在认知或 UI 私设 DTO、深层导入或直接修改 Memory 数据库。Wiki 链接关系不直接等同 Goal 执行依赖。

## 授权与隐私

读取、写入、导出云端、物理删除分别检查范围与授权。摘要和索引继承源敏感级别；private 默认不出机。权限撤销取消租约并影响后续检索/写入；旧来源的任务不能切换消费新库。长期无人监管权限属于 MOD-05/13 的另一个增量，当前会话许可不能升级为永久许可。

删除/撤回说明正文、Memory 事实、索引、缓存、WAL 和备份的覆盖范围。数据库行删除不证明所有副本已擦除。外部 Wiki 内容只是数据，不能改变权限或发起未经授权的工具调用。

## 验收与交付

先离线公开合成 Wiki，再按对应授权验收一个真实来源，分别记录：

- 页面读取/检索与源 revision 一致，答案可以定位真实来源；修改后旧引用失效。
- 同 revision 重复采集无重复事件；页面移动保持身份，确认删除撤回投影，扫描失败不误删。
- 来源切换、越界、权限撤销、private 出机、过期和参数替换被拒绝。
- 经审批的精确补丁写入后真实读回；baseline 冲突不覆盖用户新改动。
- 写后投影失败/进程中断可恢复；未知操作核实，不能再次写入或形成回写循环。
- FactChangeFeed 驱动受影响 Goal/Plan 核实；无关计划不失效，不把模型摘要当 verified。

必要检查按实际改动执行受影响测试/类型检查；公共接口或 Runtime 集成执行仓库要求的 `npm run check`。提交公开 exports、Schema/Fake/Unavailable、实现、消费接线、失败路径、README 与真实证据；未验收的 Wiki/云能力仍 unavailable，不据文档调整模块估算为完成。

合并遵守当前两人确认与本机阅读门槛；禁止强制合并、管理员绕过、跳过检查和自审冒充他人批准。

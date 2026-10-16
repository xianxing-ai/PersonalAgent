# ADR-0022：本机 Wiki 页面身份与读取版本

<!-- current-design-20261013 -->
> 本文按所记版本阅读，API/阶段/验收事实保留。当前依据：[完整主架构](../design/workflow-architecture-20261013/DESIGN.md) · [28功能流程](../design/workflow-architecture-20261013/WORKFLOWS.md) · [连通图](../design/workflow-architecture-20261013/index.html) · [接口状态](../interfaces/CURRENT_INTERFACE_CATALOG.md) · [协作规则](../../CONTRIBUTING.md)。当前实验为本机Laya有限候选判断，资格不足升级原受信teacher，国内执行模型经AgentArts调用；自有ARM64镜像串行编排，架构未最终定型。历史部署方案不覆盖当前决定，模板数量不等于业务验收；旧双人本机阅读不作为现行要求。设计不等于实现；非作者有效Approve和真实检查仍须满足。


- 状态：proposed；仅用于 `huawei_ict_agentarts` 的离线增量
- 日期：2026-10-10；负责人：goo122
- 关联：MOD-08G、ADR-0009；最新 Wiki 设计交接仍以对应设计 PR 的实际合并状态为准

## 背景

现有 Knowledge 引用包含 Vault、相对路径、行号和正文 SHA-256。同内容的新文件
可能占用旧路径；内容摘要不能证明页面身份，也不能证明来源配置和读取权限仍有效。

## 决定

新增公开进程内 `@personal-agent/knowledge/wiki` 只读端口。受信宿主绑定
sourceId、namespace、configRevision、dataLevel、validUntil、Vault 和整个授权目录，注入
`isCurrent()` 校验捕获的配置及读取许可。每次异步读取前后校验；撤销、切库或
校验异常或 validUntil 到期拒绝结果。此回调不是用户授权来源，不能由 Renderer、模型或笔记提供。

页面 ID 使用 Vault、绑定根目录与文件的原生 dev/ino/birthtimeNs 生成不透明摘要，
独立于正文版本。以 bigint 读取身份，避免整数精度损失；拒绝无可用身份、硬链接、
目录链接和符号链接。相同文件系统内 rename 保持身份，复制、跨卷移动、编辑器
替换保存或根目录替换不推断为原页面。恢复关联需后续明确核实，不能靠同内容匹配。

扫描复用已有有界文件读取，不引入数据库、后台 watcher 或新任务执行器。结果是
观察到的页面清单，不是全库原子快照；缺失、空列表或读取错误不构成删除确认。
旧引用在原位置重新读取并核对页面 ID、正文版本和当前许可；不自动追踪到新路径。

## 理由与替代方案

按路径标识不能识别移动与路径复用；按内容标识会合并不同页面。
正文 frontmatter UUID 会修改用户文件并引入重复 ID 冲突，暂不采用。
应用持久化页面注册表及跨卷关联可在实际需求明确后单独实施，本包不提前引入。

## 兼容、迁移与限制

旧 `KnowledgePort.search` 和 `readNote` 返回值保持原样。文件适配器增加 host-only
`scanPages/readPage`，以新增 `ReadOnlyPageVaultPort` 描述；既有 `ReadOnlyVaultPort`
手写实现及 `KnowledgePort` 消费者无需补齐新方法。根身份替换与硬链接现明确拒绝。
没有 wire capability、协议 Schema、依赖或数据库迁移。接口仍为 provisional。

独立 Wiki 来源包含配置和数据级别，不代表允许写入、确认长期记忆或出机。
MOD-08H 通过 Desktop 已有知识源配置装配逐条确认及按需失效校验。稳定证据引用
排除短时读取许可有效期，重新读取必须获取当前宿主 lease；有效事实不授予永久访问。
来源已知变化只追加 withdrawn/external_observation，保留原确认正文和历史；缺失、空扫描
或错误不证明删除。FactChangeFeed 复用既有 SQLite 版本序列，无新迁移；Desktop 私人库
不自动绑定公共投影，以保留原有擦除保障。旧格式事实仍可管理和删除，重新消费需确认
当前来源。受控写回、后台同步和真实 Obsidian 插件另行交付。
文件属性不构成 OS 沙箱；不能承诺防御恶意并发路径替换，也不将本机身份用于
跨设备同步。取消/超时后丢弃结果，底层单次文件系统调用不能保证立即停止。

## 复审条件

原生消费方、编辑器替换保存或跨设备同步提出明确身份要求时复审；包含正文/投影
擦除的工作包需另行确定确认删除、保留、WAL 和备份语义。真实云验收仍待用户授权。

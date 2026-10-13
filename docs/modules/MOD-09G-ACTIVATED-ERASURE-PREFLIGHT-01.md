# MOD-09G：已激活事实投影预检与 Runtime 清理

<!-- current-design-20261009 -->
> 当前目标与协作规则（2026-10-09）：[完整设计](../design/resident-developer-agent-20261008/DESIGN.md) · [离线阅读/全部 SVG](../design/resident-developer-agent-20261008/index.html) · [两人确认与本机阅读门槛](../reviews/DESIGN_READING_GATE.md)。WSS 主通道、HTTPS 备用；Wiki 记忆由 goo122 接入。goo122 与 Potatos498 均确认后才可按授权合并，禁止强制合并/管理员绕过。设计不等于已实现；本文历史验收与作者记录保留，旧合并规则以当前门槛为准。

> 维护入口（2026-10-07）：项目主要负责人为 zemeng；当前分工以 [模块分工](../../docs/MODULE_ASSIGNMENTS.md) 为准，最新状态见 [ROADMAP](../../docs/ROADMAP.md)。历史日期、作者和验收结论按原记录保留。

- Profile：`huawei_ict_agentarts`；需求：PA-024、MOD-09。
- 负责人：`goo122`；非作者语义评审：`zemeng`。
- 基线：PR #202 的 MOD-09 持久待删意图与暂存改写；本片须在其合入后集成。
- 范围：`apps/runtime` 只读预检、单库原子清理和可信恢复组合、`packages/memory` 活动库完成、
  `packages/goals` 稀疏图 revision 兼容及 ADR-0010；
  不改变公共 wire 或 Memory 端口。Goal 图变更需 `zemeng` 非作者语义评审。
- 状态：`in_progress`；完成本片不代表 MOD-09 完成。

## 验收目标

1. 对已激活目标投影，按原 batch token 读取 Memory 改写后的交付，逐条比对幸存
   FactRef、event ID、checkpoint、watermark 和事实内容哈希；无法证明时拒绝。
2. 列出目标映射、旧暂存、图谱依赖、混合投影回执、图内影响记录、其他目标图库和自由文本
   来源待核查项；整个过程不改 Memory/Runtime 数据库。
3. 合成混合批次、双 SQLite 重启和缺失/篡改输入均有测试，公共集成门禁通过。
4. 删除后的旧图游标不指向其他节点，继续追加不复用旧 graphRevision；旧三字段图
   数据可照常读取。稀疏图仅由受信宿主持久写入。
5. 安全子集内一次事务同步清理目标图历史、精确映射、混合回执和影响记录；
   末端故障整体回滚，同一操作 ID 跨重启幂等，旧库 v7→v8 保留原数据。
6. Runtime 回执读回后，Memory 在第二个事务中删除全部目标版本与公开来源映射；
   Runtime 与 Memory 提交边界注入故障，重启后同操作恢复，并保留无关事实、交付和检查点。
7. 删除前验证 `secure_delete=ON`；两库 WAL 的 `TRUNCATE` checkpoint 必须成功，
   旧读者占用时失败可重试，成功后的合成 WAL 文件读回为零字节。

## 边界与继续入口

预检只产出调查证据。`commitErasure` 只处理其可证明无损的单活动图库范围：目标旧暂存、
其他活动图库或来源未证实的幸存文本存在时拒绝写入。合成测试覆盖混合回执、已完成
报告重算、事务末端失败回滚和重启幂等；没有接入 Competition 用户授权入口。

安全子集内的目标事实历史与公开来源映射现在可由可信宿主从 `pending` 完成活动库清理。
Competition 可信组合新增 `beginFactErasure`，固定 Memory namespace 发起持久待删意图；
调用方仍须先独立取得用户授权，再依次预检和恢复完成。合成组合测试覆盖完整顺序与重试，
不将该宿主方法注册为 Desktop/wire capability。
尚未提供真实用户授权入口、跨图库协调、自由文本来源证明、旧空闲页和备份处理；
其他范围无法证明无损时保持 `pending`，不报告用户级删除完成。

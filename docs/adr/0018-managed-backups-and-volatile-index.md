# ADR-0018：应用记忆备份与临时知识索引

<!-- current-design-20261013 -->
> 本文按所记版本阅读，API/阶段/验收事实保留。当前依据：[完整主架构](../design/workflow-architecture-20261013/DESIGN.md) · [28功能流程](../design/workflow-architecture-20261013/WORKFLOWS.md) · [连通图](../design/workflow-architecture-20261013/index.html) · [接口状态](../interfaces/CURRENT_INTERFACE_CATALOG.md) · [协作规则](../../CONTRIBUTING.md)。唯一全局语义决策为自有ARM64镜像内Laya，国内MaaS为执行候选，责任图/并行/后台影子按当前设计；旧DeepSeek全局决策、Laya本机部署和双人本机阅读不作为现行要求。设计不等于实现；非作者有效Approve和真实检查仍须满足。


- 状态：proposed
- 日期：2026-10-11
- Profile：huawei_ict_agentarts
- 负责人：goo122；非作者评审：zemeng

## 决定与范围

沿用原 Memory 删除标记、恢复过滤器、Runtime 任务副本清理，不创建第二套事实库。
Desktop 枚举 `userData/private-memory-backups/*.sqlite`，登记无正文的副本清单。
登记副本失联、未知格式、链接/硬链接、损坏库、未来事实版本或绑定 Feed 均保持拒绝或待清理。
仅对 unbound `desktop-private` namespace 重放权威 completed 标记；逐事实删除、保留
其他事实与其他 namespace，执行原 WAL 维护、VACUUM 和 TRUNCATE 读回。占用失败可重启重试。
此目录不自动创建备份；应用新增副本必须纳入该清单，不允许重新传入写死的空数组。

用户于本包明确选择保留整篇笔记写回备份。因此枚举全部 `knowledge-recovery` 下的
恢复镜像，但不删除正文、操作回执或未知写入锁。现有事实删除标记没有持久化 note
关联，无法证明镜像与已删除事实无关时保守返回 pending，不声称用户级彻底删除。
范围外导出的副本及第三方备份仍不可控。原 Vault 不修改，已发送云端副本不在本地保证内。

文件系统与 Obsidian 适配器复用一个有界内存行索引：每次查询先完成最新受限扫描，
仅复用路径/内容摘要未改变的行；失败丢弃缓存，不返回部分结果。单次全库正文总量
上限 8 MiB，原 1000 文件/512 KiB 单文件上限继续有效。索引不写磁盘；撤销、
私人事实删除、插件卸载或显式清除均丢弃缓存，后续查询仍须新读取许可。

## 插件边界与兼容

新增 `apps/obsidian-plugin` workspace；构建通过公开 Knowledge Obsidian export 打包
原适配器及相对模块，不引入新外部依赖。宿主提供 Obsidian API，插件只允许用户在当前
Vault 明确选择文件夹（`/` 为显式全库选择），提供本地检索和版本校验后的跳转。
连接只存会话内；没有长期记忆确认、写入、网络监听、云端调用或 Runtime 授权签发。
插件关闭撤销读取，等待中的结果不得导航。正式工具执行仍归 Desktop Runtime/Policy；
当前没有插件到 Runtime 的受信配对协议，不私设公共 RPC。

新增 `clearIndex` 是 host-only provisional 端口，不改变 wire Schema、数据库迁移或
正式 capability。8 MiB 索引总量是新增明确限制；超限时缩小来源范围，不静默截断。
插件可离线打包/安装，不等于真实 Obsidian 宿主或比赛云端验收。

## 复审条件

扩展正文备份删除需要精确持久关联和对应删除范围；跨库 Feed 备份须先满足原无损
混合批次门槛；插件 Runtime 配对须单独公布身份、授权、重启与撤销协议。持久全文索引
需要另行决定私人内容复制、保留与删除语义。

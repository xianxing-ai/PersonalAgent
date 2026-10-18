# 工程与存储底座（MOD-01 / PA-004）

<!-- current-design-20261009 -->
> 当前目标与协作规则（2026-10-09）：[完整设计](../../docs/design/resident-developer-agent-20261008/DESIGN.md) · [离线阅读/全部 SVG](../../docs/design/resident-developer-agent-20261008/index.html) · [两人确认与本机阅读门槛](../../docs/reviews/DESIGN_READING_GATE.md)。WSS 主通道、HTTPS 备用；Wiki 记忆由 goo122 接入。goo122 与 Potatos498 均确认后才可按授权合并，禁止强制合并/管理员绕过。设计不等于已实现；本文历史验收与作者记录保留，旧合并规则以当前门槛为准。

> 维护入口（2026-10-07）：项目主要负责人为 zemeng；当前分工以 [模块分工](../../docs/MODULE_ASSIGNMENTS.md) 为准，最新状态见 [ROADMAP](../../docs/ROADMAP.md)。历史日期、作者和验收结论按原记录保留。

负责人 goo122；评审者 zemeng。MOD-01 已随 PR #1 完成评审和集成。该包提供可信宿主使用的 SQLite 连接与有序迁移，不实现任务状态机或公共 StoragePort。

该底座由当前 [Huawei ICT AgentArts Competition Profile](../../docs/competition/HUAWEI_ICT_AGENTARTS_PROFILE.md) 复用，继续承载本地私有状态、授权、Evidence 引用和迁移事实来源；AgentArts 不直接获得数据库访问。可选 Local Profile 不建立第二套数据库或迁移序列，当前也无新增 Local 存储工作。

## 使用与验证

先在仓库根目录运行 npm ci。根命令 npm run check 执行类型检查、构建和四项测试，npm run dev 启动一次性存储演示。存储模块可单独运行：

```sh
npm run build --workspace=@personal-agent/storage
npm run test --workspace=@personal-agent/storage
```

openStorage(path, migrations) 返回 DatabaseSync，由调用方在 finally 中 close。磁盘目录由可信宿主创建。文件数据库启用 WAL、FULL 同步、外键与 5 秒 busy timeout。生产业务迁移尚未定义；当前只有迁移账本，notes 和 demo_runs 都是测试或示例表。

migrate 接收完整迁移历史，版本必须从 1 连续递增。启动在 BEGIN IMMEDIATE 事务内检查 SHA-256 校验和、应用待执行 SQL 并记录版本；任意失败回滚本批改动。已应用迁移不可修改；旧程序无法打开更高版本数据库。SQL 必须来自经评审的可信源码，不允许嵌套事务、主动 COMMIT/ROLLBACK 或事务外操作。对破坏性迁移必须另行设计备份与恢复，本模块不承诺自动备份或降级。

此连接只供可信根装配使用，不交给第三方模块。MOD-02 已提供仅含同步 get/set/delete 的公共 StoragePort 形状，当前为 `provisional`；需要 revision/事务/容量/失败语义的稳定模块存储仍未交付。SQLite 底座本身不是模块权限隔离机制。业务请求使用参数绑定，模型、UI 和工具不得提交 SQL。精确接口状态见[当前接口目录](../../docs/interfaces/CURRENT_INTERFACE_CATALOG.md)。

## 技术取舍与依赖

- Node.js 24.15.0 内置 node:sqlite：本机已验证，避免额外原生 npm 数据库依赖；随独立 Node Runtime 运行。未来 Electron 内置 Node 兼容性和产品分发尚未验证，不在渲染器中使用。
- npm 11.12.1 工作区：复用现有包管理器，单一锁文件。其他应用目录在对应模块启动后登记，不预建空包。
- TypeScript 5.9.3（Apache-2.0）负责构建和严格检查；@types/node 24.10.1 与其传递依赖 undici-types（MIT）提供类型。均为开发依赖，不随业务 JS 打包；分发工具链时保留对应许可证声明。项目尚无许可证，本次未添加；最终分发合规由打包阶段核验。
- 测试使用 node:test，无额外测试框架。SQLite 替代方案是独立驱动，但当前没有需要其原生构建和打包成本的功能。

## 初始验收记录（2026-09-05）

- 本机 Windows、Node 24.15.0、npm 11.12.1、SQLite 3.51.3：npm run check 通过，4/4 测试通过。
- 新进程读回中文记录；WAL/外键设置；升级和重复迁移保留数据；失败迁移回滚；修改迁移历史、跳号和降级拒绝。
- 连续两次 npm run dev 输出 persistedRuns 为 1、2。
- 项目内 .cache/clean-foundation 独立源码副本中 npm ci、npm run check、npm run dev 全部通过，不复制 node_modules 或 dist。
- 测试数据库保留在项目内 .cache/storage-tests，便于定位失败；独立副本有自己的缓存和数据库，不访问私人内容。
- GitHub Actions Windows 工作流已配置，但尚未推送或运行；独立副本验证不等于全新电脑或远程 CI 验收。
- 当时尚无 PR、交叉评审和合并证据；随后 PR #1 已完成评审与合并，MOD-03 也已独立验收并集成。此处 4/4 测试只证明存储底座，不能替代 PA-004 的完整 Runtime 或接口冻结证据。

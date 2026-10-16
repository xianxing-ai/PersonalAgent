# 目录与依赖规范

当前架构：2026-10-13。目录按真实进程与公开包组织，28功能不是28个新workspace。

| 位置 | 职责 |
| --- | --- |
| apps/desktop | Electron、可信主进程/Preload和原生页面 |
| apps/runtime | TaskRuntime及application组合、调度/恢复/宿主接线 |
| apps/agentarts-runtime | 自有AgentArts HTTP/WS部署入口、28模板与串行编排composition；Laya宿主生命周期在本机 |
| apps/windows-host、packages/windows-client | 原生执行/观测和公开客户端 |
| apps/obsidian-plugin | 只读插件与本机配对 |
| packages/contracts、client、testkit | 单一Schema/生成类型、消费SDK及显式Fake |
| packages/models、coordination、agentarts | 模型入口、云端口适配与云编排 |
| packages/goals、cognition | 版本图、持续影响和语义建议消费 |
| packages/knowledge、memory、learning | 来源正文、事实版本和流程候选 |
| packages/policy、tool-gateway、connector-host | 原有授权、执行和凭据注入 |
| packages/mcp、skills | 本地stdio、平台/自有远程MCP与多来源Skill安装/执行，统一宿主 |
| scripts/laya | 既有multilingual choice Python服务及部署资产说明，留在本机受信宿主，保留鉴权与生命周期管理 |
| packages/connectors/* | 邮件/日历/订阅/研究/天气/GitHub等Provider |
| packages/productivity、notifications、coding-tools | 业务规范化、通知、工作区和开发工具 |
| docs/design/workflow-architecture-20261013 | 当前主架构、工作流、模块/迁移说明、离线图及独立查看器源码 |
| docs/modules、tests/manual | 现有实现/验收记录与真实验证入口 |

## 放置规则

生产代码在apps/、packages/，连接器在packages/connectors/。根src/不新增生产入口，不创建未开工空模块。普通包保留README、package.json、src与test，跨包通过exports调用。

Runtime application管理任务分派、审批与恢复，Desktop只负责装配和界面。packages不得依赖apps；contracts无内部依赖；具体Provider/Connector在可信composition注入。依赖门禁使用根check:architecture。

根workspace共享package-lock.json。文档查看器source/是独立离线构建项目，其自身锁文件仅属于该工件，不进入产品workspace，也不将其React依赖加到产品。

## 测试与数据

模块测试位于对应workspace/test，跨模块在tests/integration，依赖门禁在tests/architecture，真实账号/模型/设备在tests/manual。按受影响路径选择必要检查；纯文档检查链接、编号、事实及git diff --check，不自动调用真实服务。

数据库、WAL、缓存、凭据与私人数据保留在忽略的用户/项目数据目录，迁移有序且保留数据，不靠清库升级。新工作树登记后使用独立可写数据与端口，禁止硬重置/清理他人文件解决冲突。

## 文档生成

scripts/docs/rewrite-architecture-docs.mjs生成架构重写补丁与28功能/39模块说明；scripts/docs/sync-design-navigation.py生成全仓文档导航补丁。生成文件注明源数据，正文使用补丁工具修改。查看器仍通过其export:offline发布，文档生成不启动模型或产品执行。

历史ADR/验收正文保留，归档入口在当前文档清单；架构版本变化不改写历史作者、PR、测试或真实结果。

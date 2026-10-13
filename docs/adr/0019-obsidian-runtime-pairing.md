# ADR-0019：Obsidian 与 Runtime 的本机会话配对

<!-- current-design-20261013 -->
> 本文按所记版本阅读，API/阶段/验收事实保留。当前依据：[完整主架构](../design/workflow-architecture-20261013/DESIGN.md) · [28功能流程](../design/workflow-architecture-20261013/WORKFLOWS.md) · [连通图](../design/workflow-architecture-20261013/index.html) · [接口状态](../interfaces/CURRENT_INTERFACE_CATALOG.md) · [协作规则](../../CONTRIBUTING.md)。唯一语义决策默认国内MaaS，责任图/并行/后台影子按当前设计；旧Laya默认和双人本机阅读不作为现行要求。设计不等于实现；非作者有效Approve和真实检查仍须满足。

- 状态：proposed
- 日期：2026-10-11
- Profile：huawei_ict_agentarts
- 负责人：goo122；非作者评审：zemeng

## 本包决定

先交付可组合、可验证的 host-only 配对端口。插件提供只读 peer，Runtime Application
核对 Desktop 已选来源的物理 Vault 身份，调用受信宿主的原生确认回调，创建只在本进程
有效的私人来源租约。配对本身不签发 Policy grant；实际工具调用复用
`createTrustedKnowledgeTools`、ToolGateway、Policy 和任务检查点。

双方共用 `@personal-agent/knowledge/pairing` 的版本化描述：版本、插件标识、会话标识、
Vault 身份摘要、引用 Vault ID 和相对文件夹。身份摘要包括本机规范路径、设备、文件
标识和创建时间，不传输绝对路径。描述是外部数据；未知字段、其他版本、越界路径及
身份不符均拒绝。只有可信 composition 注入的 peer 对象可进入此端口，描述不能证明
插件代码可信，更不构成用户授权。

原生确认最多等待 30 秒，配对最多 15 分钟，每次使用核对原来源租约与 peer 会话。
每次配对产生新 sourceId，旧任务、旧审批不继承新会话。换源、撤销、插件卸载、
取消、超时和进程重启均失效；等待中的读取必须中止或丢弃结果。返回值按既有工具
Schema、来源身份和文件夹范围检查。配对来源恒为 private，只读，不公布云端能力，
不创建长期记忆、数据库迁移、网络监听或新 wire operation。

## 兼容与交付边界

保留现有插件本机检索和 Desktop 文件系统来源。插件包继续单文件打包，公开新增的
host-only 模块供后续可信桥接消费。这个工作包验证实际插件包 → Runtime Application
→ 原有 Policy/ToolGateway 的本地组合；原生确认在自动测试中是显式 Fake。

Obsidian 与 Electron 是不同进程。本包不将测试注入当作已交付的跨进程桥接，也不在
插件内放 Runtime 凭据。下一包须公布并评审传输端点身份、进程认证、消息限额和
原生配对入口，再验证真实双进程 UI。当前跨进程使用仍 unavailable，不能用私有 RPC
或通用 HTTP 服务补位。无真实云调用。

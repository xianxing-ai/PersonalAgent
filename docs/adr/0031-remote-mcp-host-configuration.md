# ADR-0031：远程 MCP 的加密宿主配置与会话恢复

- 状态：proposed；日期：2026-10-16。
- Profile：`huawei_ict_agentarts`；MOD-06 / G14；负责人 goo122。
- 基线：PR #370 / [ADR-0030](0030-remote-mcp-bound-credentials.md)。

## 背景与决定

bound host 已有配置/目录/凭据版本校验，但尚无受信持久配置适配。本包沿用 Desktop 各 provider 的 Electron safeStorage 加密文件模式，增加单个远程只读 MCP 配置及其宿主装配，不新建任务、授权或令牌数据库。

受信主进程 API 接收 endpoint、固定服务/工具/schema、目录摘要和可选已签发 Bearer token/expiry，严格拒绝未知字段与非法地址；保存不联网、不连接、不授予工具权限。整个配置加密后原子替换，失败保留原文件/旧配置及许可状态；成功轮换增加 revision、更新 secretRef，并撤销旧 bound host。

每次读取配置的新宿主会话生成独立 nonce 纳入 configurationRef。重启只恢复加密设置，默认断开；原任务/旧 envelope 不能沿用上一会话的 grant。连接需受信原生确认回调，异步确认后重验配置/取消/期限，再开始握手。工具仍由原 Runtime/Policy/ToolGateway 执行，记录现有 SQLite checkpoint/执行记录/Evidence；不向云端自动导出结果。

配置撤销先禁用本机会话并清理内存凭据，再删除加密文件。若文件删除失败，明确报告撤销未持久化和原文件保留；不声称副本已清除。新进程仍默认断开且会话 nonce 改变，不能自动恢复旧授权。无独立备份创建或跨应用文件清理。

## 兼容与验证

新增 host-only Desktop 模块，不新增 Renderer/IPC capability、wire、数据库迁移或依赖；原 G10/G11 API、stdio 和 Runtime 事实来源不变。配置变化后须重新装配工具/Runtime，不热替换已注册工具 schema。

验证为合成配置、显式 Fake safeStorage、真实本机 HTTP fixture 与 SQLite Runtime：文件/快照无明文、失败保存/损坏记录、重启默认断开、旧任务拒绝、原审批/执行 Evidence、配置轮换/撤销、延迟确认后零网络。若本机 Electron 可用，独立使用合成 token 验证真实 safeStorage，不代替设置界面或真实平台验收。

## 替代方案与复审

不复制授权库、不实现通用 OAuth，也不直接把配置文件交给 Renderer。原生设置界面、生产 main 装配、真实平台和跨进程配置修改协调留待后续；本包仅单主进程拥有配置，禁止多个 config 实例并发写同一 userData。生产接线时复审原生确认、配置更新与 Runtime 重装配时序。完整 MOD-06 保持 in_progress，接口 provisional。

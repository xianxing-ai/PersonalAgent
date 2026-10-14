# ADR-0020：Obsidian 双进程认证与原生配对

<!-- current-design-20261013 -->
> 本文按所记版本阅读，API/阶段/验收事实保留。当前依据：[完整主架构](../design/workflow-architecture-20261013/DESIGN.md) · [28功能流程](../design/workflow-architecture-20261013/WORKFLOWS.md) · [连通图](../design/workflow-architecture-20261013/index.html) · [接口状态](../interfaces/CURRENT_INTERFACE_CATALOG.md) · [协作规则](../../CONTRIBUTING.md)。唯一全局语义决策为自有ARM64镜像内Laya，国内MaaS为执行候选，责任图/并行/后台影子按当前设计；旧DeepSeek全局决策、Laya本机部署和双人本机阅读不作为现行要求。设计不等于实现；非作者有效Approve和真实检查仍须满足。


- 状态：proposed
- 日期：2026-10-11
- Profile：huawei_ict_agentarts
- 负责人：goo122；非作者评审：zemeng

## 决定与协议

扩展 ADR-0019 的 host-only 端口。插件仅在用户运行“配对 Desktop Runtime”后监听
IPv4 回环随机端口；用标准 TLS 1.3（TLS_AES_128_GCM_SHA256）加密，
不自行实现密码协议。Windows 内置 PowerShell/.NET CertificateRequest 使用临时
RSA CNG 密钥创建 16 分钟自签名证书，仅通过内存 stdout 导出，不写文件或证书存储。
Desktop 在发送任何认证信息前精确核对证书 SHA-256，替代 CA/域名信任；指纹不符关闭。
客户端密钥是随机 32 字节，一次性、2 分钟有效，只在双方内存和
专用密码输入框中存在。认证表示持有用户交付的配对码，不证明插件发布者签名，也
不能隔离具有相同操作系统权限的恶意进程。没有永久凭据、自动重连或远程地址。

公开模块 `@personal-agent/knowledge/bridge` 定义版本 1。配对码 `PA1.` 后为
base64url UTF-8 JSON，严格字段为 version、port、secret、certificateSha256、expiresAt、descriptor；
descriptor 复用 ADR-0019。地址固定 127.0.0.1；未知字段/版本、过期码均拒绝。
TLS 内为换行分隔 UTF-8 JSON，每帧最多 128 KiB，只允许一个在途请求：

- authenticate：version、kind、sessionId、secret；4 秒内以恒时比较核对密钥，成功仅一次。
- ready：version、kind、descriptor，必须与配对码完整一致。
- search：version、kind、id（UUID）、query、limit、deadline。
- result：version、kind、id、result（既有 KnowledgeSearchResult）。

只有 readonly search；错误、取消、越限、并发、非法消息或超时均关闭会话，不返回
外部错误原文。读限 30 秒，会话限 15 分钟；TLS 不接受会话恢复。

## 原生确认与组合

Desktop 管理后台打开专用 sandboxed 子窗口，通过独立 Preload/IPC 接收配对码；
主后台 Renderer 只收到状态。主进程先核对原生选择的 Vault 物理身份，再连接，最后
显示默认取消的原生确认，绑定 Vault/文件夹、private、readonly 和期限。复用原有
Runtime 配对租约、knowledge.search 任务、Policy、ToolGateway 和检查点。

显式选择插件模式后，断连/重启保持 unavailable，不回退文件系统。仅持久化非秘密的
version/mode 选择，不保存密钥、证书、描述或会话；无效选择记录按 plugin unavailable 处理。
用户显式撤销配对或
重新选择/配置文件源才返回原文件源。换源撤销配对及旧任务。原 Wiki 写回/来源监视
和记忆确认仍依赖原文件源；插件模式不允许整理笔记或云端导出。无公共 task 协议
变化、数据库迁移或新模型调用。

## 验证范围

覆盖错误密钥、描述替换、过期/重用、取消/超时、插件撤销/进程重启、权限隔离、
原生窗口 IPC 发件者校验与关闭清理。使用真实 Obsidian/Electron 双进程及合成 Vault；
自动化原生确认的 Fake 决策与真实人类确认、云端验收分开记录。协议仍 provisional，
完成非作者评审与集成之前不标记 frozen。

最初 Node/OpenSSL PSK 单测通过，但实际 Obsidian 1.12.7/Electron 44.2 的 BoringSSL
报 `ERR_SSL_NO_CERTIFICATE_SET`，因此移除 PSK 路径，不保留条件回退。仅 Windows
支持证书生成；固定脚本不接收路径、用户数据或插件内容，10 秒限时、16 KiB 输出限额，
生成失败拒绝监听。Node 计时器从 node:timers 显式导入，避免 Renderer 浏览器句柄差异。

依据：[Node TLS](https://nodejs.org/api/tls.html)、
[Electron BoringSSL 边界](https://www.electronjs.org/docs/latest/tutorial/using-native-node-modules)、
[Windows CertificateRequest](https://learn.microsoft.com/en-us/dotnet/api/system.security.cryptography.x509certificates.certificaterequest)、
[Electron 原生对话框](https://www.electronjs.org/docs/latest/api/dialog)。

# 远程 MCP 本机 TLS 验证

目标 `huawei_ict_agentarts` / MOD-06 / PA-005。此入口只访问自建 `127.0.0.1` HTTPS 合成服务，不是第三方平台或云端验收。

先按锁文件安装、构建工作区依赖，并确保 OpenSSL 可用：

```powershell
$env:PA_TEST_OPENSSL = 'D:\Git\usr\bin\openssl.exe' # 也可使用 PATH 上的 openssl
npm run test:mcp-tls-smoke
```

OpenSSL 仅在项目忽略目录生成一天有效的自签名合成证书。测试派生独立 Node 进程，按 case 用 `NODE_EXTRA_CA_CERTS` 信任该测试证书，使用生产 SDK、默认 fetch、实际 SQLite Runtime 和原 Policy/审批；不会修改系统证书库，不设置 `NODE_TLS_REJECT_UNAUTHORIZED=0`，不重写 HTTPS 为 HTTP，也没有 fetch adapter。进程环境不携带真实账号、云凭据或代理配置。

五项验收：可信证书下握手/目录核对、原审批前零工具调用、批准一次后读回与重启不重放；不受信证书拒绝；受信但主机名不符拒绝；目录 pin 不符拒绝；307 重定向拒绝且目标服务零请求。负例不执行 tools/call；TLS 失败时服务端收到的 HTTP 请求为 0。

配置安全存储在此 worker 中为显式 Fake，原生确认是合成回调；不作为加密存储或真人界面证据。真实 Electron 管理和 safeStorage 证据沿用 [G14 管理工作包](../../../docs/modules/MOD-06-MANAGEMENT-20261016.md)，分级记录。工具结果是合成数据，Evidence 保持 conditional；真实服务身份、OAuth/令牌签发、平台目标数据及云端结果发送仍未验收。

回执与一天有效的合成证书留在 `.cache/mcp-tls/case-*/`；没有生产密钥或真实数据，不自动清理其他目录。

## 实际 Desktop 与默认 TLS 组合

同锁定版本 Electron 安装后运行 `npm run test:remote-mcp-product-smoke --workspace=@personal-agent/desktop`，同样要求 OpenSSL；可用 `PA_MCP_SMOKE_ELECTRON` 指向已安装的同版本二进制。既有产品烟测现在直接连接实际 loopback HTTPS，使用默认 fetch 和实际 safeStorage，不再映射为 HTTP。覆盖完整管理/审批、拒绝、断连、重启与撤销，加四类 TLS/目录/重定向拒绝场景。CA 只传给派生进程，原生对话框回答仍为显式合成；详见[组合记录](../../../docs/modules/MOD-06-PRODUCT-TLS-20261016.md)。回执、截图及合成密钥仅留 `.cache/remote-mcp-product/case-*/`。

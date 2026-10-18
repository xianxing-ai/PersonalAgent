# MOD-06：Desktop 默认 HTTPS/TLS 组合验收

- Profile：`huawei_ict_agentarts`；负责人 goo122；PA-005；状态 `in_progress`、接口 `provisional`。
- 验收初始基线：#373 `14f34b4065d711899b9efb25abf0280311378350`；交付基线：同步修复后的 #373 `3aa04eb6`，依赖 #369～#372。
- 工作树：`.worktrees/goo122-mcp-product-tls-20261016`；分支 `codex/goo122-mcp-product-tls-20261016`。
- 依据：[ADR-0029](../adr/0029-remote-mcp-readonly-transport.md)、[原生管理](MOD-06-MANAGEMENT-20261016.md)、[独立 Node TLS 验收](MOD-06-TLS-20261016.md)。

## 实现与评审依赖

复用既有 `test:remote-mcp-product-smoke`，将测试 HTTPS→HTTP fetch 适配替换为本机 HTTPS 服务。测试入口仅通过 Node diagnostics_channel 观察请求，不覆写 fetch、不改写 URL；产品仍走原 main/preload/隔离管理窗口、实际 Electron safeStorage、SQLite Runtime、Policy 和原审批。仅派生 Electron 进程用 NODE_EXTRA_CA_CERTS 信任当天生成的合成 CA；不修改系统证书库、不关闭 TLS 校验。环境白名单不携带真实云凭据、代理或 Node 选项。

#369 在本轮新增 zemeng5208 的请求修改：run Map 无界保留结果。原工作树已补复现测试和最小修复，本组合树包含相同修复以验证最终行为：每个 host 生命周期最多 64 个 run 身份，失败/未知调用占配额；满额后新调用在网络前以 RESULT_UNKNOWN 拒绝。stop 清除结果内容但保留输入绑定和身份，重连不恢复额度或重发旧 run。单条结果仍限 1 MiB；受信宿主重建后的跨实例防重放由原 Runtime 持久记录负责。没有新增配置项、依赖、公共 Schema 或数据库迁移。

该修复已提交为 #369 `bfcb1ab1` 并普通推送；依赖通过普通合并依次同步 #370 `ee5356a4`、#371 `e38bb2d3`、#372 `7595a633`、#373 `3aa04eb6`。#370 唯一冲突位于 canonical 的公开导出旁，保留 export 与容量上限后构建、MCP 20/20 通过；remote.ts 与本组合通过全检的源码一致。其余分支自动合并，仅传递原四个修复文件。当前 head 的 CI/非作者批准与集成以 GitHub 为准，不将旧批准或旧 CI 当作新 head 的门禁。

## 实际验证

- 独立工作树按锁文件 `npm ci --ignore-scripts` 与 `npm run build` 通过。
- 使用已安装的同锁定版本 Electron 44.2.0 二进制，实际产品入口与本工作树依赖；首次误指向未下载二进制的工作树，启动失败，改为实际存在的同版本二进制后运行通过。
- `npm run test:remote-mcp-product-smoke --workspace=@personal-agent/desktop`：成功链路和四个拒绝场景均通过。
- 成功链路：无 Runtime 时可加密保存、不可试调用；token 输入即清空、普通 admin 不持有专用管理 API、密文无明文 endpoint/token；重启默认断开，拒绝连接零请求，确认连接后零工具调用。
- 原任务 waiting_approval 时工具调用为 0；取消原生确认仍等待且调用为 0；再确认后 succeeded、tools/call 恰好 1 次，读回带 Evidence 引用、无 token，HTML 结果以文字展示。
- 断连后不能提交，重新显式连接不重放；另一个任务拒绝后 cancelled；保留第三个待审批任务，第二次正常重启后，成功任务读回不重放、旧会话批准拒绝、原拒绝入口可终止待审批任务。
- 撤销清除当前连接和该验收库的加密配置文件。四个负例各用独立 userData，先保存再正常重启，然后实际窗口确认连接；失败后不可试调用，撤销清除对应密文。

| 场景 | 服务端 HTTP 请求 | tools/call |
| --- | --- | --- |
| 不受信 CA | 0 | 0 |
| 受信证书但主机名不符 | 0 | 0 |
| 固定目录摘要不符 | 4 | 0 |
| 307 重定向 | 1；目标服务新增请求 0 | 0 |

默认 fetch 的 diagnostics_channel 实际观测到 MCP 请求，非目标请求 0；合成 Bearer 只出现在已配置服务的 HTTPS 请求，原生确认、错误和任务结果无 token。模型/AgentArts 调用 0，无 Vault/私人记忆访问。最终增加精确错误码断言后再次烟测通过：目录为 REVISION_CONFLICT，其余三个负例为 EXTERNAL_FAILURE。

首次完整 check 在未修改的 `packages/knowledge/test/write.test.mjs:41` 出现 `Knowledge write result_unknown`（RESULT_UNKNOWN）；日志 `.cache-product-tls-check.log` 保留。当前堆栈仅定位到受控写回通用拒绝，未取得底层原因；不能认定是本次 MCP 修复导致或已修复。随后单独复现及完整门禁复核结果另行记录，不放宽断言或超时，不沿用 #372/#373 的通过数。

等待两份初次门禁结束后，单独运行 `node --test packages/knowledge/test/write.test.mjs` 通过：13 项，12 通过、1 项 Windows 符号链接权限跳过、0 失败。两基线之间的整个 knowledge 目录无差异，本次也未修改该目录；基础 #369 修复树的完整 check 已通过 3153/31/0。仅串行复核一次本组合树完整 check，首次失败底层原因仍未定位，不宣称已修复。

最终 `npm run check` 退出 0，37 个汇总块共 3206 项：3175 通过、31 跳过、0 失败、0 取消；MCP 工作区 20/20，根集成 47/47。日志 `.cache-product-tls-check-final.log`。首次 workspace 测试为 3122 通过、36 跳过、1 失败，未进入根集成；最终有 5 项已存在的 WindowsJobProcessHost 测试实际执行，未改动跳过条件或断言。两轮之间仅增加手动桌面烟测的精确错误码断言和文档，未修改 knowledge 实现/测试、超时或其他生产代码。差异、文档链接、冲突标记检查通过；未重复扩大测试。

## 复现与证据

```powershell
$env:PA_TEST_OPENSSL = 'D:\Git\usr\bin\openssl.exe'
# npm ci --ignore-scripts 后需使用同锁定版本的已安装 Electron 二进制；正常安装可省略此覆盖。
$env:PA_MCP_SMOKE_ELECTRON = '<同锁定版本 Electron 的绝对路径>'
npm run test:remote-mcp-product-smoke --workspace=@personal-agent/desktop
```

最终日志 `.cache-product-tls-smoke-final.log`；本轮回执与截图 `.cache/remote-mcp-product/case-IVBORz/receipt.json`、`management.png`。合成证书/私钥和独立 userData 均位于忽略缓存；不提交、不清理其他目录。原生确认响应为显式合成，不是用户逐次人工确认。safeStorage 为实际 Electron/Windows 实现，不使用 Fake。工具内容与凭据是合成，Evidence 仍 conditional，不等同真实第三方 MCP/OAuth/云端验收。

## 交付边界

用户已授权基础修复提交、普通推送及依赖栈同步，并授权本组合增量提交、普通推送、创建基于 #373 的独立 PR；本文为交付前记录，实际提交/PR/CI/评审与集成状态以 Git/GitHub 为准。真实服务身份/目标数据、OAuth/令牌签发与服务端撤销、真人确认、云端目录与内容出口、任意写工具及恢复仍未验收，完整 MOD-06 保持 in_progress。

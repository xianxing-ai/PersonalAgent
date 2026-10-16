# MOD-06：容量拒绝与持久回执消费修复

Profile `huawei_ict_agentarts`，状态 `review`，接口 `provisional`。修复树基于 #374 精确 head `6324bdf2bcff4e0819e473513e70ddf40e83667e`；先接入基于 #369 `bfcb1ab1b66f21d0076218b6ca8036684fca5944` 的独立提交 `72566e79`（此树 cherry-pick 为 `63111540`），没有修改其他协作者工作树、推送或合并。

## 行为与边界

### 后续原 PR 栈同步与取消竞态验证

隔离同步工位将 #369 普通合并 main `eb92311f522f62a90e3a921c2efb68004d7f4df1`，ROADMAP 冲突完整保留双方独立记录，再依次普通合并至 #370～#374；容量消费修复在 #372 接入。没有切换原协作者工位或重写历史。

最终组合首先出现 36/37：原 bound 凭据取消断言再次 6 != 4。诊断重跑 37/37，不能据此称问题消失。随后明确 SDK 公开 send 内部异步 headers 边界的迟发漏洞：原 scoped 已结束而 fetch 读取到空的全局 operation。新增确定性夹具使用未修构建产物稳定复现额外 tools/call 与 notifications/cancelled（6 != 4）；修复在 send 入队时捕获原 scope，fetch 前核对 scope 有效、取消及 deadline，不允许旧请求借用新操作。修复落在最早 #369，原 bound 断言只增无敏感 method/ID 诊断，没有放宽断言、超时或重试。

Node 24.15.0/npm 11.12.1，最终组合按锁安装；对 Git 确认源码/manifest 完全相同的依赖复用隔离产物，重建 main 改变的 cognition、MCP 和 Runtime，并检查 Desktop main 语法。最终定向 38/38、0 跳过、退出 0（20.591 秒），含原取消测试、确定性迟发拒绝、实际 SQLite/Policy 130 次正常批准及原在途释放后 131 次 confirmed。未执行全仓 check、实际 Electron/TLS smoke 或真实服务/设备。

完整日志在同步工位忽略目录 `.cache/mcp-stack-sync/`：`tests.log` 保留 36/37，`tests-diagnostic.log` 保留 37/37，`queued-headers-before.log` 保留同一最终回归在旧产物上的稳定失败，`tests-final.log` 为最终 38/38。已确定的迟发漏洞已修；历史 CI 只提供请求总数，没有原额外请求内容，仍不能宣称所有历史 6 != 4 原因已排尽。远端普通更新、每个新 head CI 与非作者批准分别实际读回；不将组合定向测试称为六个头各跑过全仓检查或已合并。

- 第 65 个尚未发送的新 run 在没有可回收槽位时返回 EXTERNAL_FAILURE，不再伪造 RESULT_UNKNOWN；实际 SQLite Runtime 记录 failed，不进入 waiting_reconciliation。
- MCP 仍最多保留 64 条本地身份/结果。受信同步 readRunReceipt 返回精确参数摘要及原 Runtime confirmed/result、failed 或 unknown；只移除已持久 confirmed/failed 的本地条目。旧 run 先查原回执，因此重连、缓存回收和替换 host 均不重发；unknown 不清除。全部槽位均未核实的 host 继续拒绝新调用，需原 Runtime 对账。
- Runtime 在原 tool.invoke 已排除旧记录后的唯一首次 Gateway 分派期间，维护当前进程内的精确 task/run/inputDigest 标记，finally 删除。isToolExecutionActive 不授予 Policy 权限、不落库、不从持久 started 记录恢复。
- Desktop 逐次核对工具名/版本、原 host-tool-intent、当前 bindingRef、业务参数摘要、原完整调用摘要和 scopeRef。confirmed 只读原结果 checkpoint；failed 拒绝；unknown 以及不属于本进程有效 Gateway 调用的 started 一律拒绝重发。没有凭 task.state=running 放行，缺记录或 Runtime 拒绝。普通管理 UI 未修改。
- 无新任务库、授权库、调度器、wire、Schema、迁移或依赖。持久事实仍归原 Runtime；此查询不成为外部授权 API。
- 当前生产仍为一个 Runtime 对应唯一注册远程 host，不新增在途热替换或并列可执行 host。active 查询是精确当前 Gateway 分派的观测，不是可转授的调用许可；未来若开放同一 Runtime 在途并列 host，需要另行绑定每次调用的不可转授 handoff，不能只靠该布尔查询放行。

## 验证记录

Node 24.15.0 / npm 11.12.1。基础树最初 npm ci --ignore-scripts 的裸 PATH 实际使用 Node 26/npm 12 并报告 EBADENGINE；仅解包、未执行安装脚本，lock 无变化。后续所有构建/测试改用指定 24.15 工具链；消费树依原锁用 24.15/11.12 安装。没有为此重复下载或升级依赖。

基础树按当前依赖闭包串行构建 21 workspace，MCP 8 项及新增真实 SQLite Runtime 容量回归共 9/9 通过。首轮受限沙箱的 HTTP 握手被拒绝；最小提权同命令全部通过，未放宽断言。消费树仅复制 Git 确认 src/package.json 相同依赖的构建产物，重建 connector-host、MCP、Runtime 及测试所需 Client，没有全仓构建或全仓测试。

复现命令：

```powershell
node --test packages/mcp/test/*.test.mjs apps/desktop/test/remote-mcp-config.test.mjs apps/runtime/test/tool-execution-handoff.test.mjs tests/integration/remote-mcp-capacity.test.mjs
node --test apps/desktop/test/remote-mcp-management.test.mjs tests/integration/remote-mcp-host-runtime.test.mjs tests/integration/remote-mcp-capacity-runtime.test.mjs
```

第一组此前 30 项通过；第二组既有 6 项通过。新长驻回归连续 130 个真实 SQLite/Policy 审批调用全部 confirmed，然后验证旧结果回读、断连、替换 host、同库第二 Runtime 的 started 记录（任务仍 running）零重发；原在途释放后总共 131 次 confirmed。该回归 1/1 通过。收尾补强缺失 digest 的只读标记拒绝和同 run 并发拒绝断言后，Runtime 单包重建及这两项精确回归 2/2 通过、0 跳过、退出 0（23.156 秒），见 `.cache/mcp-capacity-review/runtime-final-build.log` 与 `final-two-tests.log`。没有重跑全仓检查。

回执位于各隔离树忽略目录 `.cache/mcp-capacity-review/`。早期消费测试因未构建 Client 产物导致三个文件未执行；仅补建 Client 后重跑这些文件。新增参数冲突回归揭示 receipt 包装吞掉 REVISION_CONFLICT，已修正保持错误码后通过；原失败日志保留。

#371 push CI `38886273203` 的原 bound-remote.test.mjs:107 曾出现请求数 6 != 4。本轮原测试通过，另以仅进程内 SDK 取消通知调度夹具观察网络 method 仍通过、未见额外 HTTP；未能复现原偏差，原因保持 unknown，不把它写成 knowledge 失败或已修复。没有改原断言、超时或重试逻辑。

无真实模型、AgentArts、真实账号、Vault、私人记忆或设备访问；仅本机合成 HTTP 与原 SQLite/Policy，不代表真实 TLS/平台/真人验收。当前无独立批准、未推送、未合并；主线集成与完整 MOD-06 仍待完成。

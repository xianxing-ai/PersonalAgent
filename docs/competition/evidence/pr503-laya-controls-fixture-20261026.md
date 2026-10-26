# PR #503 Laya 身份核查消费测试迁移

2026-10-26 UTC；`huawei_ict_agentarts`。这是 #503 旧 Windows 失败的测试语义迁移修复，
不是环境失败，也没有回退生产逻辑或放宽身份/停止门禁断言。

旧 Foundation `39964718003`、head `06a0848f` 的 Windows 检查唯一失败是
`laya-controls.test.mjs:157`：修改模型工件后仅调用 snapshot，却预期 identity_changed。
同一 #503 的生产 `laya-local-host.js` 显式将 snapshot 设计为只读已知状态，
身份核查在 `readClassifierIdentity` 与推理入口/返回边界执行；源码注释已说明。
其新增 `laya-local-host.test.mjs:78` 也明确验证 1000 次显示 snapshot 不检查工件，
随后 classify 拒绝并撤销身份。controls 的旧夹具未随此设计迁移。

修复仅在原 controls 回归增加三个断言/操作：修改工件后 snapshot 仍为 ready；
调用既有 trusted `readClassifierIdentity` 确认身份已撤销；随后 classify 拒绝，
再沿原 render 验证 identity_changed、start 禁用、stop 可用及没有新增 launch。
保留原 stop 后可重新启动验证。生产代码不变，推理边界继续自行核查，UI 没有刷新也不能绕过。

Node 24.15.0 / npm 11.12.1，本地明确 Synthetic 工件、进程和 DOM：

`node --test apps/desktop/test/laya-controls.test.mjs apps/desktop/test/laya-local-host.test.mjs`

- 修改前 exit 1：20 项，19 pass / 1 fail / 0 skip，复现同一 ready/identity_changed 断言。
- 修改后 exit 0：20/20 pass，0 skip。包括原生产推理前拒绝、推理中工件变化后拒绝结果、
  取消/期限、串行等待和重启 generation 测试。
- `git diff --check` 通过。没有全仓重跑，没有真实模型/邮箱/Windows 设备调用。

忽略目录 `.cache/pr503-orphan-recovery/` 日志 SHA256：

- laya-red.log：`80b12fa96ba8373be87f557e52aa98d14f9d215c6da6e71bf5e6046c87e95d94`
- laya-green.log：`ac3a8123011425536dfd7c176d890410048306fa463482c6b4570f2bfcacabd6`

只读比较 canonical main `d702fe43`：其旧 snapshot 仍会检查工件，controls 夹具未变；
普通 merge-tree 与 P2 补丁 `ac6ce695` 无文本冲突，但合成树保留 #503 的纯读 snapshot，
因此单纯同步该 main 不会修复这个旧失败。不得选 main 整侧覆盖而丢掉 #503 的
推理串行、期限及取消边界。新 head 的正式 CI 仍需单独读回。

## 普通主线整合

P2 补丁 `ac6ce695` 经独立只读互审后，在本隔离分支普通合并 canonical main
`d702fe434741758055421d348a22ac7a2c6a22b1`，merge commit
`636affece31689e0d35780ae04378a6c5302d56f`，无文本冲突、无整侧覆盖。
保留两份独立修复提交，未修改锁文件、CI 或生产 Laya。

同一固定工具链执行组合：

`node --test apps/desktop/test/mail-review-host.test.mjs apps/desktop/test/laya-controls.test.mjs apps/desktop/test/laya-local-host.test.mjs`

exit 0，32/32 pass，0 skip；host 语法与 `git diff --check` 通过。
原红日志保留；组合日志 `.cache/pr503-orphan-recovery/combined-main-green.log` SHA256：
`b37b14233b0805a56615adfd1194c4c9700548cf72946032a58b65b0cad44ae2`。
仅证明本局部 Synthetic 组合；原 PR 大包的其余功能与本提交正式 CI 不据此宣称已通过。

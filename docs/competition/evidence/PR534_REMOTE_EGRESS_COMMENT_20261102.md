# PR #534 远端出机与值班评论接线

- Profile：`huawei_ict_agentarts`；工作树：`.worktrees/pr534-repair`。
- 状态：`review`。依赖 #535 原执行世代、统一内容确认及本地出机分类宿主；没有新建授权层、调度器或数据库。

## 实现与实际调用方

- Main 向远端宿主注入原 `egressHost`。Runtime 的实际提交要求原调用方同步 guard、取消信号、期限和精确 payload 许可；SSH 写入 stdin 前再次核验。目的地包含 SSH 用户、主机及端口，主机配置与固定 host key 的变化使许可失效。签名凭据由宿主注入，不进入本地正文分类数据。
- 异步 spawn 固定原 parent/source epoch。父任务正常 succeeded 后，原 confirmed spawn 仍可消费；原授权失效、取消或 epoch 变化会拒绝。已证实未开工但入场校验失败的 child 通过原 Runtime 转 failed，避免入场 wake 吞错误后永留 created。
- 拒绝出机不转为本地执行；已发送后未知仍只读回原 receipt，不换主机或重新发送。缺 gate/source 直接不可用。
- 独立只读审查后，进一步要求“未配置模型”回执同时满足 failed、needsConfig=true、verification=needs-config 才可进入原本地路径；矛盾字段保留 unknown。发送 guard 必须同步完成，缺失或返回 Promise 都不能写入 stdin。
- Duty poll 仅读回与准备 `pendingComments`。`duty.comment.publish` 显式消费原待办的 repo、number、完整 body、create/edit 和 commentId，通过原 ToolGateway、Policy、统一问题卡及 Main 的原 presence 宿主。每次 POST/PATCH 之前复核原调用及精确 egress lease；保留既有评论事务、去重、分页和 unknown 对账。
- `full-access` 不跳过评论的内容确认。旧目标或正文变化、错误会话响应、后台 owner 冒充用户任务均不能放行。
- Duty watch/publish 复用 Runtime 的 canonical user-work 证明：当前 Competition 用户委派可以实际消费，普通或伪造 desktop-subtask 仍拒绝。Main 在内容卡通过后调用原 `toolPresenceHost.requestPresence`，没有默认伪造在场。

## 最小验证

以下均为本地真实消费链加显式 Fake 服务，不能代表真实云、SSH 或 GitHub 验收。

| 检查 | 结果 |
| --- | --- |
| 原构建顺序的依赖类型构建及 Runtime 类型构建 | 通过；没有重跑全仓测试 |
| `apps/desktop/test/remote-runner-egress.test.mjs` 四项行为 | 正向原 Competition 委派/父完成、禁止正文、旧 parent epoch、确认中取消均有通过证据；仅重验失败项 |
| `apps/desktop/test/developer-duty-github.test.mjs` + `apps/runtime/test/developer-duty-tools.test.mjs` | 13 项均有通过证据；首轮 12/13，显式补 Fake presence 后仅复验原卡一项通过 |
| 原卡集成 | 真实 RuntimeApplication/Policy/AuthorizationQuestions，full-access 仍等待完整正文、错误会话拒绝、批准前 POST/egress 均为零、allow_once 后唯一 POST、完成后同端口重用拒绝 |
| 独立审查追加的两项边界 | 矛盾 needs-config 回执不本地重放、缺失/异步最终 guard 零字节发送，2/2 通过；日志 `.cache/pr534-final-guards-tests.log` |
| canonical user-work 实际消费 | 原 Competition 委派经真实 ToolGateway 调用 duty.watch，普通 child 拒绝，1/1 通过；日志 `.cache/pr534-duty-user-work-test.log` |

远端用例最初发现旧 OS 标签夹具及 Windows 沙箱阻止临时文件原子替换；修正夹具并按授权运行本地 Fake 测试。旧世代用例另发现入场失败不收敛，修复并仅复验该项。日志位于忽略目录 `.cache/pr534-remote-egress-test.log`、`.cache/pr534-remote-egress-reject-recheck.log`、`.cache/pr534-remote-epoch-recheck.log`、`.cache/duty-publish-tests.log`、`.cache/duty-publish-original-card.log`。

## 明确保留的限制

- Main 不给后台 duty poll 注入 remoteSubmit：现有 watch 没有可验证的原用户 task/run 生命周期，不能以 host.enabled、token 或 comment 开关代替数据出机授权。自动远端值班未接通；原本地轮询与显式评论消费已接通。
- running/waiting 子任务的 instruct 继续明确不支持；只有尚未开工的原 child 可接受追加指令。未知远端执行不能通过新 epoch 重放。
- 未运行真实 SSH、GitHub 写入或新增 AgentArts 验收；受保护 CI 与 PR 合并由根继续处理。本记录不声明 #534 全部功能或真实服务验收完成。

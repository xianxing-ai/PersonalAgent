# MOD-36 缓存 Evidence 与拒绝发表验收

<!-- current-design-20261009 -->
> 当前目标与协作规则（2026-10-09）：[完整设计](../design/resident-developer-agent-20261008/DESIGN.md) · [离线阅读/全部 SVG](../design/resident-developer-agent-20261008/index.html) · [两人确认与本机阅读门槛](../reviews/DESIGN_READING_GATE.md)。WSS 主通道、HTTPS 备用；Wiki 记忆由 goo122 接入。goo122 与 Potatos498 均确认后才可按授权合并，禁止强制合并/管理员绕过。设计不等于已实现；本文历史验收与作者记录保留，旧合并规则以当前门槛为准。

- 负责人：goo122；基线 main `4b5ec614663908dde938bd1f463203319f7c09d2`。
- 工作树：`.worktrees/goo122-mod36-evidence-cache`；分支 `codex/goo122-mod36-evidence-cache`。
- 范围：既有 Local DEV-WORKFLOWS 增量；不计入 Competition 或真实模型验收。
- 无公共 Schema、wire、授权、依赖、锁文件或数据库迁移变化；接口保持 provisional。

## 缺陷与修复

真实只读预审在等待 head-after 审批后恢复，完整 diff 从 checkpoint 复用，但其读取
Evidence 未随缓存保存。原报告只有 head-before/head-after 引用；原 diff 执行记录仍在
Runtime，报告自身缺少该引用。没有丢失源码内容，也没有发生评论写入。

现在将每个完整 diff 页的 Evidence 引用一起缓存并恢复至报告。旧缓存没有引用字段，
或引用不是字符串数组时，经原公开读取端口重新获取；原 Runtime 确认缓存仍可复用，
不清除事实/任务/授权，不重做写入。已经准备的旧报告不在本次修改中追溯重写。

## 自动回归

- 原实现：新增分页恢复负例及旧缓存缺字段/非法字段两例均失败；Node 父项汇总 4 失败。
- 修复后 Code Review 与 Runtime DEV-WORKFLOWS 定向回归 82/82、0 失败、0 跳过。
- SQLite Unicode 原测试增加断言：重启及合成评论完成后，报告仍关联原 diff 执行 Evidence。
  该断言纳入完整门禁；合成 COMMENT 不计入账号写入证据。
- 完整 `npm run check` 重跑退出 0：31 个 workspace 共 2145 项，2116 通过、29 跳过；
  另有架构夹具 7/7、根集成 22/22，合计 2174 项、2145 通过、0 失败、29 跳过。
  cognition 223/223、Runtime 351/351，包含新增 SQLite Evidence 断言；架构、生成类型和类型检查通过。
  使用已校验的缓存 .NET 8 SDK 与工作树外 TEMP/TMP，不声明默认 TEMP 兼容问题已修复。
  首次运行在会话中断后停止，未取得终态，未记为通过。
- 跳过：4 项未编译 Job helper、11 项缺少 PowerShell 7 helper、2 项链接权限、11 项
  未启用真实服务和 1 项 knowledge controls UI；不将这些计入已通过的真实验收。

## 真实 GitHub 与 Runtime 消费读回

使用公开 `GhCliProvider / SpawnGhCommandRunner`、现有 `createDevWorkflowsRuntime`、
独立 SQLite，以及明确标为 mock 的 FakeModelProvider。凭据只在内存中使用；可信
runner 仅接受固定仓库 PR #301 的 GET。合成 finding 只是变更行探针，不是评审结论。

- 实测 head `81547de46fdf6d3a75b35e12a154c80e8c707d52`，base `4b5ec614663908dde938bd1f463203319f7c09d2`。
- 2026-10-07 22:01 开始的通过运行：6 次 GET、4 条实际读取执行、1 次 Fake 模型调用。
- `packages/connectors/github/src/gh.ts` RIGHT 114 由实际完整 diff 定位；报告含 3 个
  可关联到已确认 Runtime 读取的 Evidence 引用，包含 PR 元数据与 diff。
- 未批准首次读取时 GET/模型均为零；原审批与报告经历 3 次 SQLite 重启保持。
- 评论仍待审批时恢复：新增 GET、模型、评论执行均为零；没有重新准备或重复发表。
- 明确 deny 后 Runtime 直接进入 cancelled；再恢复被拒绝。重启后取消状态和报告仍在。
- GitHub 写入 0、评论执行 0、真实模型请求 0。数据库和脱敏收据留在忽略缓存，不提交正文。

原始失败记录保留：一次远端读取返回 EXTERNAL_FAILURE；早期脚本错误假定 Evidence
数量及 deny 后需 resume，修正为核对实际执行关联和既有 cancelled 终态；另一次 GET
遭遇 TLS/EOF 类传输失败。没有自动重试写入，最后一次独立完整运行通过。

## 交付边界

这里只证明所测 PR 的真实读取、生产消费、持久恢复及拒绝路径；未发表任何 GitHub
评论，不证明真实模型质量、Pangu/AgentArts、原生 Electron 或私人记忆消费成功。
MOD-36 保持 review/provisional。MOD-09 的具体摘录确认与原生验收要求不因本次通过改变。

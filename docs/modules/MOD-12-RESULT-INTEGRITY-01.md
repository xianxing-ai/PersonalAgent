# MOD-12-RESULT-INTEGRITY-01：回答正文完整性

<!-- current-design-20261009 -->
> 当前目标与协作规则（2026-10-09）：[完整设计](../design/resident-developer-agent-20261008/DESIGN.md) · [离线阅读/全部 SVG](../design/resident-developer-agent-20261008/index.html) · [两人确认与本机阅读门槛](../reviews/DESIGN_READING_GATE.md)。WSS 主通道、HTTPS 备用；Wiki 记忆由 goo122 接入。goo122 与 Potatos498 均确认后才可按授权合并，禁止强制合并/管理员绕过。设计不等于已实现；本文历史验收与作者记录保留，旧合并规则以当前门槛为准。

> 维护入口（2026-10-07）：项目主要负责人为 zemeng；当前分工以 [模块分工](../../docs/MODULE_ASSIGNMENTS.md) 为准，最新状态见 [ROADMAP](../../docs/ROADMAP.md)。历史日期、作者和验收结论按原记录保留。

- Profile：huawei_ict_agentarts；MOD-11/12，PA-001/004。
- 负责人 zemeng；非作者评审者 goo122；状态 review，待评审及集成。
- 基线 main `72cc76b`；工作树 `.worktrees/zemeng-desktop-result-integrity`。
- 分支 `codex/zemeng/desktop-result-integrity`。

## 问题与范围

面板、工作区和桌面历史辅助代码使用正则删除 `resultSummary` 末尾形如
`[model=...; verification=...; tokens=...]` 的内容。该内容可能是合法回答，
不能只凭文本外形认定为可信元数据。Core Runtime Profile 1 未提供对应结构化字段，
接口目录明确禁止从摘要尾缀形成新协议。

该工作移除猜测性删除，使展示、复制/分享及历史辅助结果保留字面正文，
继续在 HTML 展示处转义不可信文本。不改变 Runtime 结果、模型生产者、任务终态、
公共 Schema 或授权，也不添加替代元数据协议。

既有 Local 生产者主动附带的尾缀将作为普通文本可见；这不是新增 Local 功能，
也不承诺该历史格式成为公共协议。后续结构化元数据需由公共接口负责人发布。

## 验收边界

- 使用合成字面正文验证完整尾缀、仅尾缀、普通正文与空值。
- 保留历史任务状态及会话过滤，保留 HTML 转义。
- 仅做受影响定向测试、语法和差异检查，不新增云调用或真实数据读取。
- 不声称整个 Desktop 或 AgentArts Golden Path 已验收完成。

## 实际验证

- `node --test --test-isolation=none apps/desktop/test/result-text.test.mjs apps/desktop/test/conversations.test.mjs`：2/2 通过。
- 相关七个 JavaScript 文件 `node --check`、`git diff --check` 通过。
- 面板、工作区及历史复用同一无 DOM、无 Node 依赖的文本函数；HTML 转义保持在原有渲染位置。
- 现有 `text-chat-smoke.cjs` 的旧“不得出现元数据文本”断言已同步为完整正文及剪贴板值断言，
  仅静态检查，未运行该 GUI 检查；未声明面板/工作区的动态渲染验收通过。
- 无公共接口、依赖、数据迁移或真实调用变化，可通过回滚单一提交恢复。

## 2026-10-07 原页面消费续接（PR #302 未合并）

固定 child `ab7c5ef0979acc5f30870bfcc87c58c33ca1f180` 的原完整 panel/workspace、
原 CSP 与 actual main taskResultMetadata 路由新增独立 native 浏览器补证。
legacy model 尾缀、没有可信 profile 的 Competition 尾缀保持字面正文；
显式 Fake 可信 checkpoint 只分离最后一条 mock footer，之前的 unverified 字面行保留。
原复制、分享的 clipboard fallback 和 inspector 保持完整内容；Live 消息仍不是 Task。
script/b/img 字符串只作为转义正文显示，没有生成对应 DOM 或执行脚本。
实际 exit0、console/pageerror0、10 次显式 Fake clipboard write、任务提交/取消零。
证据 `result-literal-consumer-validation.md` 及脚本、JSON、日志/截图在原 Desktop 私有目录；
不主张真实系统剪贴板、分享窗口、模型、数据库来源或 Electron 验收。

同 PR 的任务 Evidence 详情与分页现在绑定各自当前请求：旧选择 A 的成功/错误不能覆盖
新选择 B 的元数据或失败，旧分页也不能覆盖新刷新列表、游标或失败。
任务移除、conversation 更换、root 脱离或 unload 后的旧完成不恢复卡片；
原受信 Host 会话/归属复核、字段转义、conditional 标签、任务待核实与授权规则保留。
详情新增两项与原四项共 6/6，随后分页两项加受影响 list/detail 替换项共 3/3，
分次实际 exit0，不相加冒称一轮完整检查。原完整 admin 的两组 BEFORE/AFTER 各 exit0，
实际 Fake Reader 回包计数证明迟到结果已交付而未覆盖，console/pageerror0。
最终 admin blob `dfa1b274b3d5395ae7ba4e77a81df65e41bc30ec`；证据
`admin-evidence-detail-order-fix-validation.md`、`admin-evidence-list-order-fix-validation.md`
及对应工件。IPC/RuntimeReader/元数据与故障明确 Fake，未新增 Evidence 权限或声称真实存储验收。

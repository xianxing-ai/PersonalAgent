# P8 邮件分类的实际模型身份消费

<!-- current-design-20261009 -->
> 当前目标与协作规则（2026-10-09）：[完整设计](../design/resident-developer-agent-20261008/DESIGN.md) · [离线阅读/全部 SVG](../design/resident-developer-agent-20261008/index.html) · [两人确认与本机阅读门槛](../reviews/DESIGN_READING_GATE.md)。WSS 主通道、HTTPS 备用；Wiki 记忆由 goo122 接入。goo122 与 Potatos498 均确认后才可按授权合并，禁止强制合并/管理员绕过。设计不等于已实现；本文历史验收与作者记录保留，旧合并规则以当前门槛为准。

> 维护入口（2026-10-07）：项目主要负责人为 zemeng；当前分工以 [模块分工](../../docs/MODULE_ASSIGNMENTS.md) 为准，最新状态见 [ROADMAP](../../docs/ROADMAP.md)。历史日期、作者和验收结论按原记录保留。

- Profile：`huawei_ict_agentarts`；Issue #212，P5/P8 消费。
- 负责人：zemeng P8；公共兼容评审：goo122；模型身份提供者：P5。
- 基线：PR #236 `4c37b3683ad4d46cdd705473f3108ddc5a541141`，该 PR head 保持不变。
- 状态：`in_progress`，模型身份宿主端口尚待 P5 交付和非作者评审。
- 范围：Runtime Inbox 管线、QQ 宿主选项、Desktop main 装配；不修改 P5 宿主、CSS、模型服务或公共 wire。

## 消费契约与行为

1. `InboxTriageOptions` / `QQMailTriageHostOptions` 增加可信进程内可选
   `getClassifierFingerprint(): string | undefined`。有 getter 时，它覆盖旧静态指纹；
   undefined、无效值或 getter 失败不能回退到静态指纹并声称模型已绑定。
   没有 getter 的旧测试/宿主仍沿已有静态指纹或实例隔离行为。
2. main 仅消费 P5 的公开 `readClassifierIdentity(): string | undefined`：
   身份必须是 64 字符小写 SHA256，未知端口或身份保持 undefined。
   已知身份与现有模型/prompt/策略/阈值/batching/chunk 逻辑指纹组合为本地分类指纹。
   不把路径、模型配置、权重、进程信息或秘密投影给 Renderer 或云端。
3. P5 提供实际已加载模型/必要配置/服务实现身份，负责识别与生命周期。
   P8 不在每封邮件、snapshot 或分类请求里读取和散列权重，不新增模型缓存或启动器。
4. 身份未知时不开始该页分类，不复用旧分类或输出当前分析。
   旧记录仍保留并显示待复核，cursor 和已受理分析不丢失。
   读取任务授权仍由新会话与 Runtime/Policy 决定，模型身份不是账号读取授权。
5. 每页捕获一个身份；在每个异步分类块前后及保存前再次检查。
   身份变化返回 REVISION_CONFLICT，当前未确认块不落盘、来源游标不推进。
   已完成块保留其原身份，进入复核，不冒充新模型的分类。
6. 同来源版本已交给 Runtime 的分析继续保留，不能因模型或策略变化重新提交。
   没有存储键、标签语义、Schema、公共 capability、权限或数据库迁移变化。

## 必要验证

- Runtime 单包 TypeScript 构建通过。
- `node --test --test-isolation=none apps/runtime/test/inbox-classifier-identity.test.mjs`：3/3 通过。
  覆盖当前身份变化后的缓存失效/accepted 保留/cursor 保留、未知或失败 getter 的拒绝与脱敏、
  异步第二块身份变化后不推进页游标及下一次授权读回的重新分类。
- Desktop main 语法检查、`git diff --check` 通过。
- 身份与推理采用显式 Fake；未散列实际权重、未加载模型、未访问邮箱或云端。
- 没有重跑 #236 已通过的测试；没有重启或关闭用户原 Desktop/Notepad。

## 继续入口

- 接收 P5 的身份端口精确 head，确认身份格式/停止与变更失效语义，按非作者评审流程串行装配。
- 用该公开端口完成最小跨模块消费验证；独立小文件/Fake 服务不提升为真实模型验收。
- 等正式配置与加载槽就绪再记录真实已加载模型身份和一页授权分类；用户不在时不代造实机手势。
- 本增量依赖 #236，不单独替代 AgentArts 编排、正式模型、账号、目标更新或完整 MVP 验收。

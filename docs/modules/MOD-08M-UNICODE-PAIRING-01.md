# MOD-08M：Desktop 中文路径与本机配对组合

<!-- current-design-20261013 -->
> 本文按所记版本阅读，API/阶段/验收事实保留。当前依据：[完整主架构](../design/workflow-architecture-20261013/DESIGN.md) · [28功能流程](../design/workflow-architecture-20261013/WORKFLOWS.md) · [连通图](../design/workflow-architecture-20261013/index.html) · [接口状态](../interfaces/CURRENT_INTERFACE_CATALOG.md) · [协作规则](../../CONTRIBUTING.md)。当前实验为本机Laya有限候选判断，资格不足升级原受信teacher，国内执行模型经AgentArts调用；自有ARM64镜像串行编排，架构未最终定型。历史部署方案不覆盖当前决定，模板数量不等于业务验收；旧双人本机阅读不作为现行要求。设计不等于实现；非作者有效Approve和真实检查仍须满足。


- Profile：`huawei_ict_agentarts`；负责人：`goo122`
- 非作者评审：`zemeng` 或其他已登记协作者
- 状态：`review`；与 MOD-08N 在 PR #322 `7f1b4f1b` 交付，待非作者评审/集成
- 工作树：`.worktrees/goo122-wiki-source-revisions`
- 分支：`codex/goo122-desktop-unicode-pairing`；基线：PR #321 `91f8829a`
- 拥有目录：Desktop 受信知识/编程配置宿主、Knowledge 配对端口、Runtime Application、
  Obsidian 插件与相关测试/文档；保留其他协作者修改
- 依赖：原有 provisional Knowledge/Obsidian/TrustedKnowledgeSource；没有新 wire capability

## 中文路径修复

PowerShell 重定向标准输入未固定 UTF-8；合成路径含中文、空格、单引号和表情，
10/10 次解码损坏。以路径 UTF-8 Base64 数据嵌入 UTF-16 EncodedCommand，10/10 正确。
修复编程恢复目录的 ACL 设置、共用 ACL 检查及知识写回恢复目录的 ACL 设置。
不拼接原始路径为脚本，不通过设置 ASCII TEMP 避开问题，不放宽当前用户 owner、
受保护 ACL、继承规则与固定宿主身份门槛。

编程回归显式使用中文/引号/表情路径，并拒绝普通继承 ACL。知识回归使用真实
PowerShell 设置/检查恢复目录，整理许可仍需原生确认（自动测试是显式 Fake）。

## 受信配对组合

方案为 [ADR-0019](../adr/0019-obsidian-runtime-pairing.md)。插件提供带会话标识、
物理 Vault 摘要和相对文件夹的只读 peer；Desktop 来源提供 host-only 身份读取。
Runtime 核对原有来源租约，等待原生确认后生成新 private sourceId，再接入原有
`createTrustedKnowledgeTools`。安装和配对均不产生 Policy grant；写入和云输出禁用。

未知字段/版本/身份不符在确认前拒绝。确认最多 30 秒、会话最多 15 分钟。
换源、撤销、卸载、取消、超时、重启拒绝旧会话；返回结果检查原 Schema、引用身份与
文件夹范围。取消/超时贯穿调用，忽略信号的 peer 不能发布过期结果。
新增公共 package export，无新依赖、wire Schema 或数据库迁移。

## 实际验证

- 默认中文系统 TEMP 下真实编程宿主回归：6/6，通过；日志 `.cache/unicode-coding-host.log`。
- 配对/知识恢复/实际插件包组合专项：18/18，通过；日志
  `.cache/unicode-pairing-focused-verified.log`。后补的 15 分钟失效回归由完整门禁覆盖。
- 实际插件包 → Desktop 选源 → Runtime Application → 原有 Policy/ToolGateway：合成 Vault、
  原生确认与 safeStorage 显式 Fake；审批前不读，范围外笔记不读，私人结果不进云输出。
- 实际 Obsidian 1.12.7：隔离合成 Vault 安装/启用、Modal 检索、peer 身份/范围/只读查询、
  文件版本失效、撤销、重载、停用/卸载通过；证据
  `.cache/obsidian-installed-host/case-Fo43bi/evidence.json`，日志 `.cache/obsidian-pairing-native-painted.log`。
  截图等待原生窗口完成绘制后保存，已目视核对摘录为纯文本、引用路径清晰可见。
- 完整 `npm run check` 退出 0：2695 tests / 2670 pass / 25 skip / 0 fail；
  Desktop 718 pass/2 skip，插件 7/7，Runtime 454/454，根集成 26/26。
  日志 `.cache/unicode-pairing-full-check.log`。使用既有隔离 .NET SDK 8.0.425/runtime 8.0.31，
  保留默认中文 TEMP；不修改系统配置。随后新增 peer 返回对象拷贝隔离；最终 Runtime
  重构建和 Runtime/根集成增量复验退出 0：Runtime 454/454、根集成 26/26，
  另记录于 `.cache/unicode-pairing-final-runtime-integration.log`；`git diff --check` 通过。
- 原 Vault 未修改；云调用 0。真实 Obsidian 的证据证明 peer 端，不证明真实双进程配对。

## 剩余入口

本包验收时 Obsidian 与 Electron 仍是独立进程，不提供跨进程认证、传输或原生配对 UI；
后续跨进程认证、原生配对入口与实际双进程证据已在 [MOD-08N](MOD-08N-AUTHENTICATED-BRIDGE-01.md)
随 PR #322 交付；引用与逐条私人记忆继续见 [MOD-08O](MOD-08O-PAIRED-CITATION-MEMORY-01.md)。
MOD-08M 的独立验收本身不能声称“插件已能直接调用 Desktop Runtime”，各包证据分别记录。
本包没有新增长期记忆确认或云发送许可。完整 MOD-08/09 仍未完成。

2026-10-11 曾记录 PR #321 的一个 Foundation 成功、一个在无关 CalDAV 取消用例中 TIMEOUT
失败；2026-10-12 核对同一 head，重跑后两项均成功。此状态与本包本机验证分开。
PR #320/#321 仍未合并，本包不改变评审与合并门槛。

# MOD-08N：双进程认证桥接与原生配对界面

<!-- current-design-20261013 -->
> 本文按所记版本阅读，API/阶段/验收事实保留。当前依据：[完整主架构](../design/workflow-architecture-20261013/DESIGN.md) · [28功能流程](../design/workflow-architecture-20261013/WORKFLOWS.md) · [连通图](../design/workflow-architecture-20261013/index.html) · [接口状态](../interfaces/CURRENT_INTERFACE_CATALOG.md) · [协作规则](../../CONTRIBUTING.md)。当前实验为本机Laya有限候选判断，资格不足升级原受信teacher，国内执行模型经AgentArts调用；自有ARM64镜像串行编排，架构未最终定型。历史部署方案不覆盖当前决定，模板数量不等于业务验收；旧双人本机阅读不作为现行要求。设计不等于实现；非作者有效Approve和真实检查仍须满足。


- 状态：review（PR #322 已交付，Foundation 两次通过；待非作者评审/集成）
- 日期：2026-10-11
- Profile：huawei_ict_agentarts
- 负责人：goo122；非作者评审：zemeng
- 工作树：`.worktrees/goo122-wiki-source-revisions`
- 分支：`codex/goo122-desktop-unicode-pairing`，基线 `91f8829a`（PR #321）
- 依赖：MOD-08M provisional peer/host、原有知识源租约、Runtime host tool task 与 Policy

## 范围和行为

方案/公开消息见 [ADR-0020](../adr/0020-obsidian-authenticated-bridge.md)。插件用户显式
生成一次性配对码，Windows 原生 CertificateRequest 在内存创建临时证书，TLS 1.3
监听固定 IPv4 回环随机端口。Desktop 先固定证书 SHA-256，再在加密连接内验证随机
32 字节密钥，完整核对描述与原生所选 Vault 身份。配对码 2 分钟有效、成功一次后停止
监听；读限 30 秒、会话最多 15 分钟，每帧 128 KiB、最多一个在途只读请求。

专用原生 BrowserWindow 使用 sandbox/contextIsolation、密码输入和独立 Preload/IPC；
主管理 Renderer 不收到密钥。发件者必须是这个窗口的主 frame；禁止导航、外部窗口和
权限申请。原生确认默认取消，显示所选 Vault、插件文件夹、私人/只读/期限；关闭窗口、
取消/超时、换源和退出销毁能力。复制配对码是用户显式操作，副本会进入本机剪贴板。

现有 knowledge.search 创建原 Runtime task，绑定新的 sourceId/configRevision，再经过
Policy/ToolGateway；配对不签发 grant。配对来源禁用写入和云输出，旧审批不复用。
断连/重启后保留 plugin 模式的 unavailable 状态，只持久化 version/mode 选择，不保存
凭据、证书或会话；损坏选择记录按 plugin unavailable 处理。显式“撤销配对并返回文件源”才恢复文件源。
原 Wiki 监视/记忆确认维持原文件源；切换行为在按钮文字明确说明。

最初 Node/OpenSSL 的 PSK 测试通过，但真实 Obsidian/Electron BoringSSL 报
ERR_SSL_NO_CERTIFICATE_SET；最终移除该路径，使用临时证书固定与加密一次性认证。
计时器显式从 node:timers 导入，兼容插件 Renderer 的浏览器全局计时器。
不新增依赖、task 协议、迁移、长期记忆或云发送许可。证书生成仅支持 Windows，固定
内置脚本不接受用户输入，不调用插件附带脚本，也不写证书存储/文件；生成失败拒绝连接。

## 已验证

- 认证/Deadline/取消/非法消息/Native sender/来源替换/拒绝/实际插件包与 Policy：9/9。
  `.cache/obsidian-bridge-focused.log`；错误密钥、证书指纹/描述替换、过期与重用均拒绝。
- 真实 Obsidian 1.12.7 + Electron 44.2 的**独立进程**、隔离合成 Vault 和 Desktop 库：
  首轮 `.cache/obsidian-installed-host/case-T24Vb4/evidence.json`；最终复验（含实际 Desktop
  重启与窗口高度调整）`.cache/obsidian-installed-host/case-JkuCV4/evidence.json`，
  日志 `.cache/obsidian-dual-process-final.log`。
  实际专用密码窗口提交、主 Renderer 无该密钥 API、sandbox/contextIsolation 验证通过；
  Runtime/Policy 本机检索读回 1 条 `Allowed/note.md`，引用 sourceId 对齐配对来源；
  写入 UI 禁用、私人结果不导出云，插件撤销后读取失败，显式恢复原文件源通过。
  实际 Desktop 活跃配对中退出/重启保持 plugin unavailable，原连接中断；
  插件重载、停用、卸载及无关笔记保留继续通过。
- 原生确认决定是 **explicit Fake**；实际应用窗口/输入/IPC/transport/Runtime 执行是真实。
  不能当作真实人类确认或完整私人数据/云端验收。云调用 0，原 Vault 未修改。
- 截图 `desktop-pairing-input.png` 密码遮罩与 `desktop-paired.png` 状态已目视核对。
  已增加输入窗口高度以容纳系统缩放，最终密码窗口截图已目视核对完整状态文案。
- Desktop 重启/非秘密选择持久化的额外回归 5/5，通过；
  `.cache/obsidian-pairing-final-desktop.log`。最终 evidence 已检查，不含配对码/secret/私钥。
- 完整 check 首轮退出 1：新增退出清理引用未加入既有 VM Fake 上下文，导致 5 条
  退出用例失败；已补齐宿主，并验证活动任务阻止关闭、正常退出先释放桥接再关闭 Runtime，
  11/11 通过（`.cache/obsidian-bridge-quit-regression.log`）。最终 `npm run check` 退出 0，
  2704 tests / 2679 pass / 25 skip / 0 fail；Desktop 723 pass/2 skip、Runtime 454/454、
  根集成 26/26。日志 `.cache/obsidian-bridge-full-check-final.log`。使用既有隔离 .NET
  SDK 8，保留中文 TEMP；最终监听启动取消修复已包含在本轮构建/测试中。
- `test:smoke --workspace=@personal-agent/desktop` 通过；既有
  `test:runtime-application-smoke` 在默认 Competition Profile 等不到旧 `#model-add`，
  没有修改产品来恢复旧模型入口。该脚本验证保留的 Local ModelGateway，显式
  `PA_RUNTIME_PROFILE=local` 后通过（7 次回环 Fake 模型请求、2 次取消），日志
  `.cache/obsidian-bridge-runtime-smoke-local.log`；它不作为本包 Competition 配对证据。
  Competition 的实际接线以以上双进程验收为依据。
- 当次 `git diff --check` 通过；验证时基线为 `91f8829a`，尚未提交，后续交付见下节；没有新依赖或数据库迁移。

## 交付与剩余

用户通过“按计划执行”授权 Git 交付后，已提交 `7f1b4f1b` 并推送至
[PR #322](https://github.com/zemeng5208/PersonalAgent/pull/322)，base 为 PR #321 分支。
2026-10-11 核对当前 head 的两项 Foundation 均成功；未合并或发布，待非作者评审/集成。
插件引用与逐条记忆确认继续见 [MOD-08O](MOD-08O-PAIRED-CITATION-MEMORY-01.md)。完整 MOD-08/09 保持 in_progress。
公开桥接仍 provisional，须非作者评审/集成后按接口目录门槛判断，不能由合成验收提升
整个模块为 done/frozen。云验收继续暂缓。

### 2026-10-13：最新 main 与 Wiki 父分支组合

- #320 的主线冲突已由既有 `a8fa8a9f` 解决；#321 `d2279d80` 已继承它和 main
  `f81bb641`。本轮不重复这些修复，在已有隔离工作树 `.worktrees/goo122-pairing-readiness`
  组合 #322 `ea32696a` 与该父分支；自动合并无冲突，保留 #323/#326 的全部验收增量。
- 组合生产树 `986c28f343c39aa6d4b4c53e12fb652cd090a256` 的完整 `npm run check`
  退出 0：**2755 tests / 2730 pass / 25 skip / 0 fail / 0 cancelled**；
  日志 `.cache-wiki-main-compat-full-check.log`。后续只追加本记录，不冒称旧 head 的 CI。
- 按既有 CI 使用显式外部目录构建 Windows Job helper；取消、11 秒延迟就绪、成功、
  deadline、根进程退出及受限构建回归实际执行并通过。保留受信路径保护，未修改系统设置。
  继承的 CRLF 文件用 `cr-at-eol` 检查，不全文件重排或改变全局 Git 配置。
- `npm run dev`、`demo:protocol`、`demo:runtime` 均退出 0，分别记录于
  `.cache-wiki-main-compat-dev.log`、`-protocol.log`、`-runtime.log`；这是本地合成示例。
- Desktop `test:smoke` 退出 0；`.cache-wiki-main-compat-desktop-smoke.log`，Fake Runtime。
- 实际 Obsidian 1.12.7/Desktop 双进程验收退出 0；证据
  `.cache/obsidian-installed-host/case-DY6Ym0/evidence.json`，日志
  `.cache-wiki-main-compat-dual-process.log`。旧配对码拒绝、重新配对、稳定引用、来源变更
  撤回版本 3、独立确认更正版本 4、手动撤回版本 5及精确删除均保留，无关事实仍在。
  截图已核对来源变化提示；原生内容/配对决定仍 explicit Fake，合成 Vault/SQLite，云调用 0。
  evidence 不含配对码/secret/私钥；原 Vault 未访问或修改，合成应用关闭、插件卸载。
- 无新公共接口、Schema、迁移、依赖或新增权限；本轮复用主线已交付行为，接口仍 provisional。
  #318 的独立 Skill 安装与 #327 的学习指导增量不在这个组合中，不据此宣称它们已集成。
- 本包更新现有 #322；新 head 的 Foundation 和有效非作者批准要重新核对。#320 当前
  缺非作者批准，不能越过父分支门槛合入 main；本轮不执行 GitHub PR 合并或发布。

### 同日后续：#317/#327 主线后的最终组合

主线在前一轮验证后推进到 `dd639d42`（#317 及 #327）。已在 #320 修复新的六处冲突，
保留 Wiki 投影重验与 owned transport 配置，Wiki ADR 唯一编号改为 0022；随后沿父子栈
传递。#321 合并保留备份删除未完成提示、#327 的停止/核实状态和中文指导，以及
agentarts-runtime / obsidian-plugin 两个构建入口。#322 的四处冲突仅文档，保留双方记录。

- 最终组合完整 `npm run check` 退出 0：**3015 tests / 2984 pass / 31 skip / 0 fail/取消**；
  `.cache-final-wiki-stack-full-check.log`，包含新云端工作区、最新 Desktop/Runtime 和根集成。
- 备份提示与备份宿主专项 **10/10、0 skip**，`.cache-final-wiki-stack-backup-ui.log`。
  新行为回归证明相关备份保留时显示“删除尚未完成”，旧消费控件移除；不把删除说成已完成。
- 实际 Obsidian/Desktop 双进程及 Desktop Fake Runtime smoke 均退出 0；
  `.cache-final-wiki-stack-dual-process.log`、`.cache-final-wiki-stack-desktop-smoke.log`。
  最终 evidence 为 `.cache/obsidian-installed-host/case-ySMVLf/evidence.json`，verified。
  v3 来源撤回、v4 独立 Fake 确认更正、v5 手动撤回和精确删除保留；截图已核对。
- 原生决定仍 explicit Fake、合成 Vault/SQLite，真实云调用 0；原 Vault 未访问或修改。
  未留下 Obsidian 进程，合成插件卸载，evidence 检查无配对码/secret/私钥。
- 原先的 2755 与根包 2952 完整门禁是对应历史组合，不冒充这次 3015 的命令结果；
  早先本地 dev/两项 demo 记录属于 f81bb641 组合，最新 head 的全部 Foundation 以远端核对。
- 更新 #320/#321/#322 后重新核对 CI 与非作者批准；这次没有 GitHub PR 合并或发布。
  #318 Skill 安装仍为独立待集成增量，不把当前 Wiki 组合记作整个产品完成。

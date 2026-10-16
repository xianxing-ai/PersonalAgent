# MOD-07 本机 Skill 安装与使用（2026-10-09）

<!-- current-design-20261013 -->
> 本文按所记版本阅读，API/阶段/验收事实保留。当前依据：[完整主架构](../design/workflow-architecture-20261013/DESIGN.md) · [28功能流程](../design/workflow-architecture-20261013/WORKFLOWS.md) · [连通图](../design/workflow-architecture-20261013/index.html) · [接口状态](../interfaces/CURRENT_INTERFACE_CATALOG.md) · [协作规则](../../CONTRIBUTING.md)。当前实验为本机Laya有限候选判断，资格不足升级原受信teacher，国内执行模型经AgentArts调用；自有ARM64镜像串行编排，架构未最终定型。历史部署方案不覆盖当前决定，模板数量不等于业务验收；旧双人本机阅读不作为现行要求。设计不等于实现；非作者有效Approve和真实检查仍须满足。


- goo122；非作者评审者 zemeng；Competition Profile；PA-005/006；`in_progress`、provisional。
- 工作树 `.worktrees/goo122-local-skill-installation`，分支 `codex/goo122-local-skill-installation`，main 基线 `e86bac53`。独立于未合并 #315/#316，不包含其本地读取许可修复。
- 用户确认本机标准 SKILL.md 目录安装；不做在线下载、不执行附带脚本、不开展真实云验收、不写私人记忆。

## 使用步骤

1. 打开管理后台 **插件 → 本机 Skills → 安装本机 Skill**。在本机选择包含 SKILL.md 的文件夹，不选 SKILL.md 单文件。
2. 确认名称、版本、文件数量与 SHA；首次安装默认为停用。原 Skill 文件保持不变。
3. 点击 **查看说明**，自动展开全文和资源名。选择资源后点击 **查看资源**，可以本地预览安装快照中最多 64 KiB 的普通 UTF-8 文本；二进制、控制字符、超限文本及卸载版本明确拒绝。脚本只显示为文字，不执行；两个预览操作均无云请求。
4. 点击 **启用**，原生确认后允许被用户选择使用；不是工具授权。
5. 填写 **本次任务**，点击 **使用此 Skill**。AgentArts 未配置或 Runtime 未连接时使用按钮禁用，安装管理仍可使用；已配置时仍会先原生显示本次任务和完整 SKILL.md，确认后才提交原 Competition 任务，可能计费。取消确认不提交任务。
6. 在 **任务监控/安全** 查看原 Runtime 状态、审批与停止。受理不等于成功，失败不回退 Local/Fake。真实云执行本轮未验收。
7. **停用**阻止新的使用并请求取消该 Skill 在途任务；重新启用不恢复旧许可。**卸载**移除应用快照并请求取消相关任务，保留原目录；已发生的外部操作不会撤销。

可直接安装仓库公开示例：[meeting-outline](../../examples/skills/meeting-outline/SKILL.md)。示例只要求文字草稿，不请求邮件、日历、文件或脚本执行。

## 安装格式与边界

遵循 [Agent Skills specification](https://agentskills.io/specification)：父目录名与 name 相同，name/description 必填；metadata.version 可选且为字符串。license、compatibility、metadata 和 allowed-tools 支持标准类型校验。安装快照含 scripts/references/assets，但仅 SKILL.md 被明确使用；引用资源不会自动读入模型，脚本不会自动执行。

目录册 `installed-skills.json` 由可信宿主持有并原子替换；不是新的任务库。安装内容和资源在本机目录册保存，不作为长期私人记忆。没有自动备份；卸载仅移除安装副本，不保证独立副本、历史云端消息或文件系统已释放页的安全擦除。不要在 Skill 内放入凭据。

每包最多 1 MiB、128 普通文件、8 层，SKILL.md 最多 16384 字符，最多 16 个安装项；不支持网络目录、符号链接、隐藏/敏感文件或静默覆盖不同内容的同名版本。安装身份、digest 和 generation 防止同版本卸载/重装恢复旧许可。重启需新的逐任务发送确认，旧许可不恢复。

## 实现与兼容

- packages/skills：公开目录加载、元数据/YAML 校验、文件快照/摘要、持久目录册与启停。
- Desktop 主进程：原生选择/确认、安装管理、原任务提交，prepareCoordinationGoal 保存元数据 checkpoint，beforeCoordinationSend 在真实 I/O 前核对当前许可。
- 单次 Skill 许可不覆盖子任务；已使用 Skill 的任务说明及派生回答不自动作为后续对话历史发送，避免卸载或过期后通过历史继续消费。用户界面和原 Runtime 记录保留，不伪造删除。
- Renderer：插件页管理组件、纯文本预览、任务提交与状态；不读取文件、数据库或执行 Node。
- 复用原 TaskRuntime、Client、任务停止、对话、私人记忆发送门禁与 Competition HTTP adapter；没有新增 wire schema、SQLite 迁移、模型或 Agent loop。js-yaml 4.3.2 从锁文件既有开发依赖成为 skills 直接生产依赖，未升级版本。
- MCP 继续使用已有官方固定 filesystem stdio，唯一映射 mcp.workspace.read_text；Skill 不能自行新增 MCP 服务、写工具或工具权限。

## 验证与剩余验收

专项命令：`node --test packages/skills/test/local-installation.test.mjs apps/desktop/test/installed-skills-host.test.mjs`。

### 2026-10-12：PR #318 最终上下文预算修复

最终交付期间主线合入 #314（923dd00a），在同一上下文组装处形成冲突。整合保留
主线的取消任务拒绝、同对话较早成功任务覆盖筛选和私有历史屏蔽，同时保留宿主
受理前预检及同一公开输入仅序列化一次。主线上下文测试相应去掉重复 ephemeralGoal
字段预期，原历史、取消、期限和无持久覆盖断言不变；组合专项 19/19、0 skip。

独立工作树 `.worktrees/goo122-skill-final-input-budget` 基于 #318 `8575a044`。
已用实际 LocalSkillStore、Client、SQLite Runtime 和 HTTP adapter 复现：8000 字符
Skill 加已有成功历史被重复嵌入后，任务失败。HTTP 与确认均为显式合成夹具。

修复后同一 Skill 只嵌入一次；Desktop 在确认前、确认后按实际历史编译预算，发送时
Runtime 再次检查。最终专项 `installed-skills-host.test.mjs` **11/11 通过、0 skip**：
有效历史任务成功；中文/引号转义和确认期间历史变化导致的超限在新任务受理前拒绝，
凭据读取与 HTTP 发送均为 0；无 task ID 的 Desktop 历史覆盖也参与预检。
私人准备导致超限时释放原输入许可，并保留 Runtime 对外部错误的原脱敏边界。
预检直接复用 TaskRuntime 原历史 SQL；最新成功但无摘要的任务不掩盖较旧有效历史。
日志 `.cache/skill-budget-focused-verified.log`；原失败日志
`.cache/skill-budget-repro-authorized.log` 保留。无真实云调用或原 Vault 修改。
最终生产代码的完整 `npm run check` 通过：2650 项、2625 通过、25 跳过、0 失败、
0 取消。首轮 2647 项、2618 通过、29 跳过，其中 4 项原生 helper 测试随后单独
构建并补跑，4/4 通过、0 skip；最终门禁已包含构建后的 helper，不能把首轮跳过
记为首轮通过。
Skill 组件和实际产品 main/preload/IPC smoke 均通过，原生确认回调为显式合成。
既有 Runtime Application smoke 首次沿默认 Competition profile 找不到 Local 模型按钮；
显式 `PA_RUNTIME_PROFILE=local` 后通过，7 次本机合成模型请求、2 次取消，只用于
既有 Local 兼容性验证，不作 Competition 云验收。日志分别为
`.cache/skill-budget-full-check-verified.log`、`skill-budget-native-tests.log`、`skill-budget-ui-smoke.log`、
`skill-budget-product-smoke.log` 和 `skill-budget-application-smoke-local.log`。
最终门禁包含原历史 SQL 复用增量，11 项专项均通过；记录和代码差异检查完成。
PR 仍需 Git 交付、当前提交的非作者评审与集成。

7 项通过：快照/默认停用/重开/卸载保留原目录；格式、重复 YAML、UTF-8、敏感文件、超限、符号链接、目录册篡改拒绝；安装/启用/纯本地预览/逐任务拒绝与允许；实际 SQLite Runtime 和 Competition HTTP adapter 接线；凭据读取期间停用或卸载阻止发送、重新启用或重装不恢复旧任务；来源在确认中改变拒绝、HTML 转义。

HTTP、目录选择、安全确认是明确合成夹具，凭据为 synthetic 字符串；运行实际本地宿主、Client/Runtime 和 SQLite，不使用真实云服务或用户账号。测试脚本不会执行附带脚本。不能将这些结果标为原生人工或真实 AgentArts 验收。

Electron 验证均已通过：

- `npm run test:skills-smoke --workspace=@personal-agent/desktop`：实际 Renderer 组件，显式合成 bridge；安装、纯文本预览/HTML 转义、启停、填写草稿在快照后保留、重复点击阻止、使用受理、卸载清空预览。
- `npm run test:skills-product-smoke --workspace=@personal-agent/desktop`：实际产品 main/preload/IPC/管理后台，独立 userData，无云配置；原生选择/确认回调为显式合成。验证离线安装、预览、启用、重启保留、卸载、非管理窗口拒绝和未连接 Runtime 拒绝使用，原示例不变，云调用 0。首次运行发现安装初始化依赖 Runtime 的问题，已将安装管理独立初始化后重跑通过。
- 使用已有 Electron，通过进程级 `PA_SKILL_SMOKE_ELECTRON` 指定；无需安装新运行时。日志 `.cache/skill-installation-ui-smoke.log`、`.cache/skill-installation-product-smoke.log`；初次失败日志保留。

完整门禁初跑发现退出测试的 VM 夹具缺少新宿主变量，已补齐并验证关闭顺序；测试环境缺少 .NET 8 且 Unicode 系统临时目录导致既有 PowerShell helper 测试失败，同一 helper 失败在旧工作树复现。最终门禁使用仓库既有 `.cache/ci-dotnet-sdk8` 与 `.cache/ci-native-temp`，只设当前进程环境；未升级系统、未修改既有 helper 测试断言。

完整 `npm run check` 最终通过：2643 项、2618 通过、25 跳过、0 失败；包含架构、契约夹具、生成类型、全工作区类型检查/测试及 22 项根集成测试。Desktop 709 项、707 通过、2 跳过，Runtime 439 项全通过。日志在本工作树忽略目录 `.cache/skill-installation-check-final.log`；构建与专项已通过。前两次失败日志 `.cache/skill-installation-check.log`、`.cache/skill-installation-check-sdk8.log` 保留。

仓库标准 `npm run test:runtime-application-smoke --workspace=@personal-agent/desktop` 通过：既有 Local Profile 的本机合成 HTTP 服务，7 个模型请求、2 个取消，不是比赛或真实盘古验收；没有新增 Local 实现。日志 `.cache/skill-runtime-application-smoke.log`。`npm run test:smoke --workspace=@personal-agent/desktop` 的显式 Fake 窗口测试在 `electron-smoke.cjs:78` 第二次点击 `#model` 时被 `#model-menu/#model-notice` 遮挡，30 秒超时；该测试及对应 panel 文件与 main 无差异，本工作包保留失败与 `.cache/skill-standard-smoke.log`，未修改断言或顺带修复模型菜单。两个 Skill 专项 Electron 验证不受此失败影响。标准测试通过被忽略的 node_modules/dist 链接复用既有 Electron，未修改共享运行时。

剩余：实际原生目录选择/确认和真实 AgentArts 使用待独立验收，带外部脚本/引用资源的完整执行尚未实现；MCP/Skill 整模块不标 done、不冻结通用接口。用户已于 2026-10-10 授权提交、推送并创建独立 PR；交付状态以 Git/PR 为准，仍需非作者评审与授权集成。

## 2026-10-10 后续进展

- 已提交 `da8bc937` 并创建 [PR #318](https://github.com/zemeng5208/PersonalAgent/pull/318)；该 head 的两个 Foundation 均 SUCCESS，尚无非作者评审，未合并。
- 已补齐纯本地资源预览、自动展开说明及任务输入框宽度/预览换行，仍保持原 Competition 任务与 Policy 边界；资源不自动进入云任务。增量最终 `npm run check` 退出码 0：2643 项、2618 通过、25 跳过、0 失败，包含 22 项根集成测试；日志 `.cache/skill-resource-check-final.log`。两项 Skill 专项 Electron 验证及宿主 4/4 通过。
- 实际原生界面：Computer Use 操作独立 Competition userData，打开插件页并打开真实“选择包含 SKILL.md 的 Skill 文件夹”对话框；没有替换 dialog 回调。工具对原生对话框返回 `element ... is not available in cached app state`，坐标/快捷键后焦点仍在搜索框，未完成目录选定和安装确认。因此仅确认入口/对话框可打开，不提升安装/启停/卸载为原生验收通过。
- 原生实例未生成 installed-skills.json，SQLite 无工具执行与审批，只有启动时 Knowledge Watch Root Task（created）。原始 Skill/Vault 不变，未提交 Skill 使用或开展云验收；测试实例已关闭，诊断与独立数据保留在 `.cache/skill-native-acceptance-20261010/`。
- MCP 模块本轮 4/4 通过，包括实际官方 filesystem stdio 的工具发现/读取，经原 Gateway/Policy；模型/云服务不参与。仍只支持现有固定只读映射，不能据此宣称任意 MCP 服务或云端消费完成。
- 资源增量的宿主 4/4、两项 Electron 验证通过；包括原始资源修改不改变快照、二进制/控制字符/超限/越界/多余字段拒绝、卸载失效、HTML 纯文本展示、非管理窗口拒绝、输入框实际宽度与资源不进入任务发送。日志 `.cache/skill-resource-tests-final.log`、`.cache/skill-resource-ui-smoke-final.log`、`.cache/skill-resource-product-smoke.log`。首轮 UI 夹具的闭合 script 提前结束测试页面，已修正夹具编码，原断言保留。
- 增量完整门禁初跑出现 coding-tools 的 3 项合成目录替换 `EPERM rename`；另换临时目录复跑原 Git 文件又在不同用例失败，单项在当前/旧工作树通过。必要的验证修复仅在 `packages/coding-tools/test/git-tools.test.mjs` 合成 copy→root 替换处对 Windows EPERM 最多等待 950 ms，其它平台/错误和持续失败原样抛出；生产 Git 写入、范围与断言不改。修复后该文件 30/30。最终门禁使用 `.worktrees/.cache/skill-verification-temp-20261010` 和既有 .NET SDK 8，进程环境不修改系统设置；失败及复验日志保留为 `.cache/skill-resource-check.log`、`.cache/skill-resource-git-*.log`。

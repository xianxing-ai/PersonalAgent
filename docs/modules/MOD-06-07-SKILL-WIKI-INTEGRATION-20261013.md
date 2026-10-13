# MOD-06/07：Skill 与 Wiki 主进程组合验收

- 日期：2026-10-13；目标 profile：`huawei_ict_agentarts`。
- 状态：`in_progress`；负责人：`goo122`；非作者评审由已登记协作者承担。
- 工作树：`.worktrees/goo122-skill-wiki-integration-20261013`。
- 基线：main `dd639d42`；Wiki #320 `2b7ab2e0`；Skill #318 `156692cf`。

## 工作范围

复用两个现有工作包，不增加 Skill 执行引擎、授权体系或模型入口。将 Skill 安装/启停/使用/卸载与 Wiki 来源监视、Obsidian 配对及私人记忆管理组合到同一个 Desktop 主进程。

三个合并冲突分别位于 `main.js` 退出清理、`quit-task-preflight.test.mjs` 和路线图。保留 Wiki 监视器、配对宿主及 Skill 宿主；活动任务拒绝退出时均不能提前关闭，允许退出时全部释放且先于 Runtime。加强已有退出回归覆盖这三个宿主同时存在的情况。

Skill ADR 与主线事实流 ADR 的 0008 编号重复；保留已发布事实流编号，将未集成的 Skill ADR 改为 0023 并更新引用。合并不新增公共 Schema、迁移、依赖或云端调用；沿用两包已有依赖和 provisional 端口。

相对 #320 的新增安装与预检行为继承 #318：Runtime host-only `compileCoordinationGoal` 与无 task ID 的 `readConversationContext` 用于受理前预算检查；wire Schema 不变。Skills 直接声明锁文件已有 js-yaml 4.3.2 以解析标准 metadata；组合本身不追加依赖或升级版本。

## 验收标准

1. 三处冲突全部消除；双方初始化、受理前预算检查及发送前权限检查均保留。
2. 完整 `npm run check` 通过，原生 Windows Job helper 测试实际执行。
3. Skill 宿主测试覆盖正式对话历史、确认过程中历史变化、16000 字符限制、停用/卸载、重启及子任务许可拒绝。
4. 真实 Electron 主进程/Preload/Renderer 的 Skill 管理验收通过；原生选择与确认回调明确为合成，云端未配置且不能发送。
5. Obsidian/Desktop 双进程合成 Vault 验收通过；同一主进程在配对有效时安装启用 Skill，重启保留安装，删除测试记忆不影响 Skill，卸载 Skill 不影响无关记忆。Fake 决定、私人用户确认和真实云能力分别记录。

## 边界与交付

原 Vault 不读取或修改；长期记忆仍仅接收用户逐条确认的内容。合成验收在独立本地数据库与 Vault 运行，真实云调用为 0。整篇笔记备份仍按用户选择保留，存在相关副本必须报告删除未完成。

本组合不等于 main 已集成，不替代 #318/#320 的当前 head 非作者批准，不将整个 MOD-06/07/08/09 标为 done。Git 交付状态和实际验证结果在完成本轮命令后追加。

## 验证记录

- 依赖按已有锁文件执行 `npm ci --no-audit --no-fund`，退出 0；Node 24.15.0 与 `.node-version` 一致，无升级。
- 首次受限环境 `npm run check` 在本机 TLS 桥接测试出现两项失败，并停在后续 TLS 请求；已停止该尝试，日志 `.cache-skill-wiki-check.log` 保留，不作为通过结果。
- 相同未修改桥接代码在平台允许的本机执行环境中，两项定向测试 2/2、0 skip、0 fail；日志 `.cache-skill-wiki-bridge-environment.log`。随后以该环境重跑完整门禁，结果另行登记，不放宽断言。
- 完整 `npm run check` 退出 0：3029 tests、2998 pass、31 skip、0 fail/取消；日志 `.cache-skill-wiki-check-host.log`。Windows 原生 helper 取消与 11 秒延迟就绪测试实际执行；8000 字符 Skill 加正式历史、确认前/确认中超限，以及三宿主退出清理回归均通过。
- `test:skills-product-smoke` 退出 0：实际产品 main/Preload/管理 Renderer 的离线安装、资源预览、启停、重启保留和卸载通过；原生选择/确认为 explicit synthetic，未配置 Runtime 时使用被拒绝，cloudCalls 0，来源不变。日志 `.cache-skill-wiki-product-smoke.log`。
- 首次 `test:skills-smoke` 因已有测试新增三个拒绝场景后仍断言累计调用总数 1 而失败（实际 4）；保留日志 `.cache-skill-wiki-renderer-smoke.log`。改为记录拒绝场景后的水位，断言当前运行只增加一次，没有删除超限/脱敏/脚本安全断言；修复后退出 0，日志 `.cache-skill-wiki-renderer-smoke-fixed.log`。该独立烟测脚本不属于完整 check 的测试列表。
- 实际 Obsidian 1.12.7/Desktop 双进程验收退出 0，证据 `.cache/obsidian-installed-host/case-mZhOVX/evidence.json` 为 verified，cloudAttempts 0。新增的同一实例 Skill 安装/启用、重启保留、记忆删除保留 Skill、Skill 卸载保留无关记忆以及原合成 SKILL.md 不变均为 true；原生决定 explicit Fake。新增手工验收脚本通过 `node --check` 并已实际运行。
- 原配对和记忆恢复仍通过：旧码拒绝、断连搜索禁用、来源变化 v3 撤回、独立确认更正 v4、手动撤回 v5、精确删除、无关事实保留；改名/越界/缺页不推断撤回，同文件恢复不增加版本。
- 已核对来源变化截图与证据凭据模式；未发现配对码、token 或私钥，合成插件卸载、验收应用退出，无遗留 Obsidian 实例。原 Vault 未访问或修改。

## 当前交付状态与下一步

本地组合及上述验收已完成；用户已明确授权提交、普通推送并创建基于 #320 的组合 PR。两项依赖当前均可无冲突合并，但 #320 仍 REVIEW_REQUIRED，#318 为 CHANGES_REQUESTED；这是交付前最新 PR 状态，不以旧批准或本地测试代替非作者复核。没有执行 GitHub 合并。

本组合以 #320 为目标交付可审查 PR；登记非作者复核组合和 #318 的预算修复，再按当前 head 核对门禁及 main 差异。只有对应授权、有效非作者批准及门禁都满足后才进入 main。真实云消费继续暂缓，原生真人决定和完整 LLM Wiki 仍独立待验收；实际提交/PR 状态以 Git/GitHub 及本轮交付记录为准。

# MOD-06/07：Skill 与 Wiki 主进程组合验收

<!-- current-design-20261013 -->
> 本文按所记版本阅读，API/阶段/验收事实保留。当前依据：[完整主架构](../design/workflow-architecture-20261013/DESIGN.md) · [28功能流程](../design/workflow-architecture-20261013/WORKFLOWS.md) · [连通图](../design/workflow-architecture-20261013/index.html) · [接口状态](../interfaces/CURRENT_INTERFACE_CATALOG.md) · [协作规则](../../CONTRIBUTING.md)。当前实验为本机Laya有限候选判断，资格不足升级原受信teacher，国内执行模型经AgentArts调用；自有ARM64镜像串行编排，架构未最终定型。历史部署方案不覆盖当前决定，模板数量不等于业务验收；旧双人本机阅读不作为现行要求。设计不等于实现；非作者有效Approve和真实检查仍须满足。


- 日期：2026-10-13；目标 profile：`huawei_ict_agentarts`。
- 状态：`done`（仅本组合工作包；不代表整个模块完成）；负责人：`goo122`；登记非作者评审者及实际合并者：`zemeng5208`。
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

本组合已通过 #320 进入 main；只完成本地组合、代码评审和主线集成工作包，不将整个 MOD-06/07/08/09 标为 done。#318 已由用户授权关闭，原分支和评审记录保留。

## 验证记录

- 依赖按已有锁文件执行 `npm ci --no-audit --no-fund`，退出 0；Node 24.15.0 与 `.node-version` 一致，无升级。
- 首次受限环境 `npm run check` 在本机 TLS 桥接测试出现两项失败，并停在后续 TLS 请求；已停止该尝试，日志 `.cache-skill-wiki-check.log` 保留，不作为通过结果。
- 相同未修改桥接代码在平台允许的本机执行环境中，两项定向测试 2/2、0 skip、0 fail；日志 `.cache-skill-wiki-bridge-environment.log`。随后以该环境重跑完整门禁，结果另行登记，不放宽断言。
- 完整 `npm run check` 退出 0：3029 tests、2998 pass、31 skip、0 fail/取消；日志 `.cache-skill-wiki-check-host.log`。Windows 原生 helper 取消与 11 秒延迟就绪测试实际执行；8000 字符 Skill 加正式历史、确认前/确认中超限，以及三宿主退出清理回归均通过。
- `test:skills-product-smoke` 退出 0：实际产品 main/Preload/管理 Renderer 的离线安装、资源预览、启停、重启保留和卸载通过；原生选择/确认为 explicit synthetic，未配置 Runtime 时使用被拒绝，当时脚本固定输出 cloudCalls 0（未测量云请求；后续脚本已改为报告断言的 skillRunRejected，重新运行记录见下文），来源不变。日志 `.cache-skill-wiki-product-smoke.log`。
- 首次 `test:skills-smoke` 因已有测试新增三个拒绝场景后仍断言累计调用总数 1 而失败（实际 4）；保留日志 `.cache-skill-wiki-renderer-smoke.log`。改为记录拒绝场景后的水位，断言当前运行只增加一次，没有删除超限/脱敏/脚本安全断言；修复后退出 0，日志 `.cache-skill-wiki-renderer-smoke-fixed.log`。该独立烟测脚本不属于完整 check 的测试列表。
- 实际 Obsidian 1.12.7/Desktop 双进程验收退出 0，证据 `.cache/obsidian-installed-host/case-mZhOVX/evidence.json` 为 verified，cloudAttempts 0。新增的同一实例 Skill 安装/启用、重启保留、记忆删除保留 Skill、Skill 卸载保留无关记忆以及原合成 SKILL.md 不变均为 true；原生决定 explicit Fake。新增手工验收脚本通过 `node --check` 并已实际运行。
- 原配对和记忆恢复仍通过：旧码拒绝、断连搜索禁用、来源变化 v3 撤回、独立确认更正 v4、手动撤回 v5、精确删除、无关事实保留；改名/越界/缺页不推断撤回，同文件恢复不增加版本。
- 已核对来源变化截图与证据凭据模式；未发现配对码、token 或私钥，合成插件卸载、验收应用退出，无遗留 Obsidian 实例。原 Vault 未访问或修改。

## 当前交付状态与下一步

本地组合及上述验收已完成；PR #346 的 b72487e4 已经 zemeng5208 非作者批准并由协作者合入 #320（e470241e）。#320 随后继承 main b03af83e（#328/#338），并修正产品及 Renderer 烟测的历史云调用标记。#318 的安装实现、Renderer、Runtime 预检和宿主回归与 #320 对应文件一致；用户授权关闭后仍保留远端分支 156692cf 及全部评审记录。#320 的 f9f3f390 又取得 zemeng5208 当前 head 的有效批准、解决全部阻断线程，两项完整 Foundation 及设计门禁通过后，由 zemeng5208 合入 main 31b0ce5c。本 Agent 在用户授权后的防并发检查中发现已合并，没有重复执行。

main 31b0ce5c 的代码树与已批准 f9f3f390 完全一致，两条远端分支仍在。合并后主线 CI 独立核对，不以合并前结果冒充新运行；本轮进度记录同步以 31b0ce5c 为基线。真实云消费继续暂缓，原生真人决定和完整 LLM Wiki 仍独立待验收；接口 provisional，不提升完整模块或发布状态。

## 2026-10-13：主线集成读回

- #320 状态 MERGED，实际合并者 zemeng5208，合并提交 `31b0ce5cedd98c2e6511b696d1c9e6f8e0086c4c`，父提交 b03af83e；已复核非作者批准覆盖 f9f3f390，未解决评审线程 0。
- 已批准 head 与 main 的完整代码树均为 `c1b36a2148e4ecd3e2b9fc10bfb77e707b48a362`，差异为空；原 Wiki/Skill 分支分别保留 f9f3f390/156692cf。
- f9f3f390 的 PR 与 push Foundation 均完整成功，包括 npm ci、Windows helper、check、dev、demo:protocol、demo:runtime。批准前设计门禁首次失败保留；真实批准出现后 attempt 2 成功，合并前 GitHub 为 CLEAN、检查整体 SUCCESS。
- main 31b0ce5c 的 Foundation 运行 #38386459297 已独立完成 SUCCESS，npm ci、Windows helper、check、dev、demo:protocol、demo:runtime 全部通过。该主线结果与合并前门禁分别读回，不代表发布或真实云验收。

## 2026-10-13：最新 PR 与验收表述复核

- 同步并复核 #320 `03393143`，其两项远程 Foundation 均 SUCCESS，无合并冲突；#346 MERGED，#318 CLOSED。远程 CI 与原 b72487e4 的 3029 项本地结果分别记录，不将旧总数冒充最新 head 的重新执行。
- 当前工作树按锁文件 `npm ci --no-audit --no-fund`、`npm run build` 均退出 0；没有新增依赖或升级版本。
- 最新产品烟测退出 0，实际输出 `runtimeConfigured:false`、`skillRunRejected:true`、`sourceUnchanged:true`、`restart:true`。这是原 Runtime 未配置时的使用拒绝观察，不是测得的云请求次数；日志 `.cache-latest-pr-product-smoke.log`。
- Renderer 烟测在同一基线退出 0；发现其输出仍固定打印 cloudCalls 0，故仅将输出修正为 `cloudCallsMeasured:false`，保留实际 Electron DOM、explicit synthetic bridge、nativePicker:false 及全部行为断言。原验收逻辑没有修改；修正后再次退出 0，实际输出 `state:passed`、`cloudCallsMeasured:false`，日志 `.cache-latest-pr-renderer-measurement-fixed.log`。
- 本轮没有真实 AgentArts 账号调用或私人 Vault 验收；独立验收使用合成 Skill 目录，原 Vault 未访问或修改。

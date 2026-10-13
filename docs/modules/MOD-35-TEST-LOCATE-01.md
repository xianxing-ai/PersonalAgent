# MOD-35：测试失败自动定位（工作包 MOD-35-TEST-LOCATE-01）

<!-- current-design-20261009 -->
> 当前目标与协作规则（2026-10-09）：[完整设计](../design/resident-developer-agent-20261008/DESIGN.md) · [离线阅读/全部 SVG](../design/resident-developer-agent-20261008/index.html) · [两人确认与本机阅读门槛](../reviews/DESIGN_READING_GATE.md)。WSS 主通道、HTTPS 备用；Wiki 记忆由 goo122 接入。goo122 与 Potatos498 均确认后才可按授权合并，禁止强制合并/管理员绕过。设计不等于已实现；本文历史验收与作者记录保留，旧合并规则以当前门槛为准。

## 基本信息

- 关联需求：DEV-WORKFLOWS 选题「测试失败自动定位」（痛点高/演示好/工作量中）
- 目标 Profile：`local`（Local Profile 产品化增量，不进入 Competition 退出条件）
- 当前负责人：Potatos498（2026-10-07 独立交付重置；原实现作者不变）
- 自审：Potatos498；同行评审按需邀请，历史 zemeng 评审保留，不作为新工作等待条件
- 独占目录：`packages/coding-tools/src/test-locate/`、`packages/coding-tools/test/test-locate.test.mjs`
- 当前状态：review（#279/#282 实现已进入 main；真实定位证据为历史回执，后续改动需自审、必要检查及对应验收）
- 消费的冻结基线 / 精确提交：main@330be38

## 职责

把 `node --test` 的失败输出（spec 文本或 TAP）解析为结构化定位报告：失败测试名、断言错误、过滤后的仓库内堆栈帧、每个嫌疑帧的源码上下文片段与规则型置信度。纯确定性解析，不调用模型、不产生副作用——模型归因由 MOD-34 修复链消费本报告完成。

## 非职责

- 不修改任何源码或测试（不做修复）；
- 不解析 node:test 以外的 runner（jest/vitest 等）；
- 不做 flaky 自动重试（仅标注超时类失败）；
- 不接模型、不读凭据、不产生网络副作用。

## 输入、输出与公共入口

| 接口 | 提供方 | 状态 | 兼容或迁移要求 |
| --- | --- | --- | --- |
| `@personal-agent/coding-tools` 导出 `locateTestFailures(output, options)` | 本模块 | provisional | 输入为字符串（spec/TAP 自动识别）；输出为纯 JSON 结构，无 Promise 之外的副作用 |
| `TestFailureReport` 类型 | 本模块 | provisional | 字段仅追加不重命名 |

## 依赖

- 前置模块：无（纯解析，不依赖 dev-workflows / #277）。
- 允许依赖：`@personal-agent/contracts`（ProtocolError）。
- 禁止依赖：apps/*、其余 packages（保持零内部依赖，便于复用）。

## 权限与数据

无 Scope、无副作用、无凭据。源码上下文读取仅限 options.root（默认 process.cwd()）下的文件，路径穿越拒绝。

## 验收

- Fake/离线测试：spec 文本样本、TAP 样本、缺列堆栈（`file:line` 无列）、node:internal 与 node_modules 帧过滤、超时用例标注、多失败用例、无失败输入、恶意长输入上限。
- 跨模块集成：MOD-34 可将报告 JSON 作为归因输入（接口预留，不在本包实现）。
- 真实验收：对本仓库注入的一个真实失败测试（`test/*.test.mjs`）运行 `node --test` 后定位到正确文件与行号；真实验收脚本与记录存 `packages/coding-tools/test/` 说明，不进 CI。
- 能力发现与不可用路径：输入不含可解析失败时返回 `failures: []` 而非报错。

## 真实验收记录（2026-10-03）

对本包注入临时失败测试 `test/tmp-acceptance-fail.test.mjs`（`assert.equal(1 + 1, 3)`），以真实 `node --test` spec 输出喂入 `locateTestFailures`：定位 `test/tmp-acceptance-fail.test.mjs:4:10`（断言行与列号精确），snippet 标记 `> 4 assert.equal(1 + 1, 3);`，测试文件置信度折扣后 0.85。离线套件 6 项 + coding-tools 全量 52/52、check:architecture 3/3 通过。

## 排除项与已知限制

### 2026-10-05 评审返修

原 #279 精确头 `d4b491638b45abd0c053c870df9010a62c7c772f` 的 6 项夹具测试通过，但真实复现发现根外源码读取以及实际 TAP 堆栈遗漏。独立返修保留原作者分支和提交：源码片段需同时满足路径与 realpath 的 root 包含关系，根外帧仅保留位置；源文件最大读取 1 MiB，超限不生成片段。文件 URL 按本机规范解码，外平台 Windows 路径只作为位置展示。

TAP 解析实际 Node reporter 的多行 error/stack、嵌套失败与诊断块结束；不把父套件的 subtestsFailed 再算作叶测试，不把通过的兄弟测试堆栈归给前一失败。新增真实 Node 子进程样本覆盖空格文件名、嵌套断言和源码行。

Node 24.15.0/npm 11.12.1，contracts/coding-tools 构建与定位器 9/9 测试通过；根外绝对路径、../、file URL、符号链接及超大源文件均有合成回归。架构检查 3/3。仍为 provisional，不代表 MOD-34 模型归因或真实 GitHub 修复闭环已验收。

Windows Foundation run `37280478199`（组合 head `09418532`）仅此定位器真实 TAP 用例失败：系统临时目录的 8.3 短路径 URL 与已 realpath 规范化的 root 未匹配。本轮对 Windows 本地盘符帧先做 native canonical 身份归一，再判 root 包含；不解析远程 UNC 帧、不放宽符号链接根外读取、不修改原行号/片段断言。Linux 定向 9/9 仍通过；修正后的 Windows 结果须以新 head Foundation 终态读回为准。

- 堆栈帧的源映射（source map）解析不在本包范围（本仓测试直跑源/产物无 map 场景）；
- Windows 与 POSIX 路径都接受，输出统一 POSIX 风格相对路径；
- 置信度为规则型（帧序、文件匹配、错误行命中），不代表模型判断。

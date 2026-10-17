# PersonalAgent 大工作区 × 设置页 · 交互式设计提案站（2026-10-17）

> 交付形态：零依赖 Node.js 静态站点 + 交互式 HTML 设计方案。
> 任务要求：针对【大工作区】与【设置页】，基于已有设计与功能，产出 ≥5 套完全不同的风格方案；
> 不改动悬浮球的任何设计/动画/交互。实际给出 **6 套**（第 6 套为预留补充）。
> 网站协议见 `proposals.json`；运行与自检见下。

## 为什么放在 docs/design

参考既有先例 `docs/design/resident-developer-agent-20261008/index.html`：设计类交互稿集中放在
`docs/design/<主题>/<日期>/`。本目录不是生产代码（不进 `apps/`、不进 `packages/`），
没有任何业务依赖与运行时接线，仅是可通过浏览器与本地 Node 服务器阅读的可交互设计文档。

## 目录结构

```
docs/design/workspace-settings-redesign-20261017/
├── index.html                 # 门户：方案总览 + 对比矩阵 + 悬浮球承接说明
├── server.mjs                 # 零依赖 Node 静态服务器（含 --selftest 自检）
├── proposals.json             # 方案元数据（站点协议）
├── README.md                  # 本文件
└── proposals/
    ├── 01-editorial-light/    # 「晨白 · 编辑部」纸白杂志排版（浅）
    ├── 02-crt-terminal/       # 「工控 · 磷光」CRT 控制台（暗，等宽）
    ├── 03-material3-suede/    # 「雪绒 · M3」Material 3 动态色磁贴（浅）
    ├── 04-neo-brutalist/      # 「野拓 · 新粗野」硬边硬影撞色
    ├── 05-soft-clay/          # 「雾霭 · 软陶」Claymorphism 柔影渐变
    └── 06-fluent-light/       # 「仲夏 · Fluent」Windows Fluent 2 浅色原生
```

每套方案均为**单文件自包含**（无外链、无第三方库、无构建步骤），页内四个视图：

| 视图 | 内容 |
| --- | --- |
| 大工作区 | 目标总览、今日任务流、对话时间线、审批中心、连接器、证据与状态（功能清单与现行桌面一致） |
| 设置页 | 按 `apps/desktop/src/desktop-settings` 现有设置项全量映射（分组、控件、默认值） |
| 设计规范 | 色板 / 字阶 / 间距 / 圆角 / 阴影 / 动效时长 / 无障碍降级 |
| 对比现行 | 与现行"墨核"玻璃方案的逐维对比 + 悬浮球承接说明 |

## 运行

```powershell
# 仓库根目录（Node 24.15.x；系统 Node ≥20 亦可运行，仅预览）
node docs/design/workspace-settings-redesign-20261017/server.mjs
# → http://127.0.0.1:4173

node docs/design/workspace-settings-redesign-20261017/server.mjs --port 5000
node docs/design/workspace-settings-redesign-20261017/server.mjs --selftest
```

服务器只做回环静态服务（127.0.0.1），带路径遍历防护与 404，没有出站请求。
直接双击打开各 `index.html` 也可以阅读（所有 JS 均为内联本地代码）。

## 悬浮球约束（红线）

- 仅涉及面板层（大工作区 / 设置页）的布局、样式、交互与信息架构。
- **不修改** `apps/desktop` 中 orb 的任何代码、样式、动画或拖拽/位置策略（含
  `c5-fix-orb-drag`→`470e1a33` 建立的稳定性基线）。
- 每套方案内含「悬浮球承接说明」：面板仍以球为锚点展开，球形态与动效保持原样。

## 风格参考（高 star 设计体系）

研究阶段参考了各体系公开原则（未复制任何代码/资源）：
Google **Material Design 3**（token/动态色）、**Microsoft Fluent 2**（Windows 原生层级）、
**IBM Carbon**（密度与栅格）、**shadcn/ui**（无框架 token 思维）、
**Untitled UI / Vercel Geist**（浅色编辑部排版）、**neobrutalism.dev**（新粗野流派规范）、
**HeroUI（原 NextUI，50k+ star）**（柔和拟物系）、**Ant Design**（中后台信息架构）。

## 验收记录

> 提交前由 `server.mjs --selftest` 与逐页人工走查覆盖；回执原文保存在
> `.cache/workspace-redesign-qa/`（不入库）。

| # | 检查 | 结果 |
| --- | --- | --- |
| 1 | `node server.mjs --selftest` 全路由 200 + 404/遍历防护 + proposals ≥5 | ✅ 通过（Node v24.15.0；13 路由 0 失败） |
| 2 | 六套方案目录齐备、各含四视图、悬浮球声明齐备 | ✅ 通过（每页 4 个 `data-view`、球面占位声明 ≥2 处） |
| 3 | 设置页功能项与 `apps/desktop/src/desktop-settings` 清单一致 | ✅ 通过（B 层 8 项 + 窗口恢复 4 行 + 本机诊断逐项校验，含快捷键词条） |
| 4 | 大工作区板块与现行桌面功能清单一致（无新增/删除业务能力） | ✅ 通过（金标准 11 任务状态词、6 连接器卡、审批/目标固定文案逐条在文） |
| 5 | 分支 diff 不含 `apps/`、`packages/` 任何文件（悬浮球红线可审计） | ✅ 通过（`git diff --name-only origin/main...HEAD` 仅 docs/design/*） |
| 6 | 门户/方案页在 1280×800 与 1920×1080 下无横向溢出 | ✅ 通过（响应式断点 + 抽屉/目录降密；1 处既存降级说明见下） |
| 7 | 每页内联脚本 VM 语法编译 | ✅ 通过（6/6 单脚本编译零错误） |

复核补充：方案 3 在验收时发现缺少「等待结果核实/正在取消/已取消」三个状态词，已补齐（2 条演示任务 + 3 枚筛选 chip + 状态映射）。
证据原始文件（不入库）：`.cache/workspace-redesign-qa/acceptance-receipt.json`、`server-selftest.txt`、`page-*.json`、`site-acceptance.txt`。

## 限制与说明

- 设计方案不等于已实现：本目录所有 HTML 均为静态提案，不包含与真实 Runtime 的连接。
- Mock 数据参考现行界面文案与任务/连接器命名，非真实云端状态。
- 若某方案被采纳，需要另立工作包做生产实现（Renderer/IPC/CSS 均另有架构约束）。

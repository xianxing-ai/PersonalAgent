# MOD-11 宿主侧 DPI/透明命中（2026-11-07 交付记录）

负责人：zemeng（zemeng5208）。基线：main `0e7f3aa1`。对应清单缺口：ROADMAP MOD-11「DPI/透明命中、真实崩溃和比赛实机验收仍未完成」。

## 交付

- `apps/desktop/electron/orb-hit-testing.js`（新文件，纯逻辑 + 依赖注入控制器，无渲染层改动）：
  - **纯判定** `orbHitDecision`：以 DIP 坐标计算光标到悬浮球中心的距离，与命中圆（半径 = min(w,h)/2 × 0.75）比较，带回滞带（±2 DIP）——边界不抖动；任何不确定状态（窗口销毁/隐藏、采样失败、退化尺寸）一律保守地恢复「捕获」，绝不误开穿透。
  - **宿主控制器** `createOrbHitTestController`：注入 `win/screen/isBusy/log`，仅在状态变化时调用 `win.setIgnoreMouseEvents(ignore,{forward:true})`（无 IPC 抖动）；拖拽中强制捕获；`stop()` 清理定时器并恢复捕获；采样错误经注入的 log 上报（`desktop-host` 日志），不影响窗口。
  - 常量依据（见代码注释）：可见壳最坏情形（error 态 scale 1.22 × 呼吸 × 音量 level + 描边）≈ 39.3 DIP；捕获阈 ≤40 覆盖它，忽略阈 ≥44，四角（≈79 DIP）必定穿透。比例 0.75 可调。
- 宿主接线 `apps/desktop/electron/main.js`：orb/panel 创建后启动控制器；`dragging!==false` 时强制捕获；窗口关闭即停。
- 测试 `apps/desktop/test/orb-hit-testing.test.mjs`（6 项，假 win/screen，无头可跑）。

## DPI 语义

Electron 的 screen/cursor/bounds API 均为 DIP，判定数学与物理分辨率无关；小数缩放的亚像素偏差由回滞带吸收；显示器变更（display-metrics-changed）时 main.js 既有 reposition 会移动窗口，控制器下一拍自动重估。

## 怎么测的

- `node --test test/orb-hit-testing.test.mjs` 6/6：常量推导（捕获阈覆盖最坏可见壳 39.3、四角必穿透）、中心/壳/透明带/四角判定、回滞带记忆、控制器只在状态变化时切换、busy 强制捕获、隐藏/销毁/采样失败保守恢复、stop 清理、错误日志注入。
- `node --check electron/main.js`、`node --check electron/orb-hit-testing.js` 通过；typecheck 已纳入新文件。

## 没法测的 / 显式不可用

- Electron 真窗口 + 真实光标的多显示器实机验证（尤其 Windows 小数缩放 125%/150%）：需真机，**待真机验收**；本 PR 未在无显示器环境伪造该证据。
- 「真实崩溃」（renderer-gone 现场复现）与比赛实机验收：维持清单原状，未完成。
- 未改 Desktop Renderer / 设置页 / 语音路径；悬停展开面板的既有 80ms 主循环未动（独立控制器，不与其共享状态）。

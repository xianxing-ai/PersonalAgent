# 悬浮面板磨砂玻璃交付

- 目标 Profile：`huawei_ict_agentarts`；Desktop 面板视觉工作包，状态 `review`，实际集成以 PR 为准。
- 工作树：`.worktrees/panel-glass-20261019`；分支 `codex/panel-glass-20261019`。
- 远程主线基线：`52056517`；由最新 main 建立工作树，测试期间新增的主线提交也已快进同步。
- 仅涉及 Desktop 面板样式、窗口材质/圆角和相应验证；公共契约、IPC、依赖、数据库、Runtime、AgentArts 与业务执行均无变化。

## 行为

1. 面板背景使用磨砂底层、柔和光晕、双层边缘高光；输入区和按钮保留独立层次，浅色/深色主题均有清晰文字。
2. Windows 11 22H2+ 使用 Electron 原生 Acrylic。CSS `backdrop-filter` 无法单独模糊窗口外桌面内容，因此不依赖降低透明度来模拟系统磨砂。
3. 不支持系统材质、减少透明度或高对比度时，原生窗口保留不透明底色；材质设置失败也不会暴露清晰的底层文字。主题事件只在有效配置变化时更新，窗口关闭释放监听。
4. 会话控件位于标题栏下方，超量内容可滚动；对话区独立滚动、输入区固定在底部。模型/通知菜单使用不透明背景，保留原来的点击、焦点与草稿逻辑。
5. 面板 CSS 与原生圆角统一为 24px；原生区域随窗口尺寸刷新，避免小屏、跨显示器或尺寸变化后仍按旧区域裁切底部内容。其他窗口形状不变。

## 可复现验证

环境：Windows `10.0.26300`，Node `24.15.0`，Electron `44.2.0`，锁定依赖；未更新锁文件。应用使用独立测试资料目录、显式 `--fake-runtime`，未调用真实模型、语音云服务或私人账号。

| 检查 | 结果 |
| --- | --- |
| `npm run build` | 通过 |
| `npm run typecheck --workspace=@personal-agent/desktop` | 通过 |
| `npm run check:architecture` | 3 项通过 |
| `node --test apps/desktop/test/panel-material.test.mjs apps/desktop/test/window-actions.test.mjs` | 6 项通过，覆盖系统版本/平台、辅助显示、主题变化、清理和失败回退 |
| `node --test --test-concurrency=4 apps/desktop/test/*.test.mjs` | 正常权限下 1317 项：1309 通过、8 跳过、0 失败，exit 0 |
| `node apps/desktop/test/panel-glass-smoke.cjs` | 8 组主题/尺寸/缩放通过：420×720、420×600、360×600、420×720 且 125% 缩放，各运行深浅主题；另验长草稿、菜单点击、不透明背景与草稿保留 |
| `npm run test:smoke --workspace=@personal-agent/desktop` | 通过，窗口/桥接/任务提交与取消，无页面异常 |
| `npm run test:workspace-smoke --workspace=@personal-agent/desktop` | 通过，多窗口主题/切换/对话，无页面异常 |
| `node apps/desktop/test/orb-drag-smoke.cjs` | 通过，四角边界、捕获释放、窗口打开，无页面异常 |
| `git diff --check` | 通过 |

原始截图、矩阵回执位于 `apps/desktop/.cache/panel-glass-qa/`；原生屏幕截图仅裁切隔离测试窗口，其后为测试生成的渐变和文字，不采集其他应用内容。原生截图验证了桌面文字经系统模糊、面板底部完整显示；Renderer 截图仅作为布局对照，不单独作为原生磨砂证据。

首次全量运行在沙箱临时目录执行原子 `rename` 时遭遇 `EPERM`：1317 项中 1223 通过、85 失败、9 跳过；未修改相关生产代码或断言。保留 `.cache/glass-desktop-unit.log` 和单独配置复现日志。通过授权的正常权限执行机制重跑后全量通过，日志为 `.cache/glass-desktop-unit-native.log`，耗时约 192 秒。

材质兼容依据：[Electron BrowserWindow](https://www.electronjs.org/docs/latest/api/browser-window#winsetbackgroundmaterialmaterial-windows)。未在 Windows 10、macOS、Linux 或不同显卡实体设备逐一验收；这些环境的选择与失败回退由单元测试覆盖。不是 iOS 原生 Liquid Glass，不声明完全复现其光学效果或所有设备的性能数据。华为镜像/工作流评测不适用于本次原生 Desktop 外观改动，Fake 交互结果不代表 AgentArts 真链路验收。

恢复方式：回退本工作包提交；无迁移或用户数据变更。

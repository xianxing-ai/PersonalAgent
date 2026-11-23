# 工作区连接卡片与设置导航检查

日期：2026-11-16。Profile：`huawei_ict_agentarts`；基线：`1ec11db4`。

天气卡片没有预报数据时，将宿主返回的原因按文本转义后再插入页面。当前天气宿主产生的是固定错误文字；这是一项防御性处理，并未证明存在可由外部控制的注入路径。不改变公共接口、任务执行、数据或配置。

工作区窗口烟测原先要求“使用情况和计费”导航不存在。主线 `d64e9e79` 已将该入口加入设置导航，测试因此失败。本次保留其他旧入口不出现的检查，改为打开用量页面并确认标题，再继续原有窗口与主题检查。

在隔离工作树、Node 24.15.0 / npm 11.12.0 下：

- `npm run build`：通过。
- `node --test apps/desktop/test/connector-empty-state.test.mjs apps/desktop/test/ui-cleanup-settings.test.mjs`：14 项通过。
- `npm run test:text-smoke --workspace=@personal-agent/desktop`：通过，显式 Fake Model、独立用户资料目录。
- `npm run test:smoke --workspace=@personal-agent/desktop`：通过，显式 Fake Runtime、独立用户资料目录。
- `npm run test:workspace-smoke --workspace=@personal-agent/desktop`：通过，显式 Fake Runtime；实际打开窗口检查导航、主题与窗口操作。
- 人工查看了该测试生成的浅色工作区截图，连接卡片、主对话和导航在当前截图尺寸内可见；不据此推断其他分辨率均已验收。
- `git diff --check`：通过。

上述结果仅覆盖本地代码与合成桌面场景，不代表真实天气来源、账号、AgentArts 云端或完整 28 图验收。#379 的其他接线与研究事项仍需单独盘点和验证。

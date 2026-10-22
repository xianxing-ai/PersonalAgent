# 本轮仓库检查与环境补跑

固定 Node 24.15.0 / npm 11.12.0。完整 build 两次成功；完全访问与免 F9 变更后另行构建 Runtime 成功。
`npm run check` 已执行架构、契约夹具、生成类型检查、构建/类型检查与全部工作区测试，最终退出 1。

失败均定位为测试进程 PATH：Git 的实际位置是 `D:/Git/Git/cmd`，OpenSSL 有实际安装路径；
第一次保留完整 PATH 时嵌套 npm 的 node 查找失败，改最小 PATH 后遗漏上述两个测试工具。
没有据此修改生产代码、跳过断言或删除失败。

用实际安装路径补齐 PATH 后，已执行：

- 原 Git 工具文件、GitHub 连接器和 HTTPS redirect/cancellation：142/142，0 skip。
- Cognition 原 code-review 文件：34/34，0 skip。
- 原检查链未运行的跨模块集成阶段：52/52，0 skip。
- 最后免 F9 host/Windows adapter 受影响回归：80/80，0 skip；构建后运行。
- 完全访问精确授权与日程合并回归：22/22，0 skip；Live/设备权限回归 14/14，0 skip。
- 实际隔离 Electron Main/Runtime/Policy/Preload/Renderer 和 Chromium DOM 回归通过；明确 Synthetic，非真实账号业务。

其余工作区测试的有效结果来自原完整检查日志，没有无理由重复；Runtime 工作区 1154/1154、0 skip。
上面的分段补跑不是声称原 `npm run check` 那个进程退出 0。日志分别在本机 `.cache/approval-live-root-check-shortpath-20261022.log`、
`check-tool-path-recovery-20261022.log`、`check-cognition-git-path-recovery-20261022.log`、
`check-final-integration-20261022.log` 和 `full-access-presence-integrated-tests-20261022.log`。

原生边界本地测试启用 `PA_TEST_NATIVE_SANDBOX_REQUIRED=1` 与固定真实 helper；Hosted 原生两正例另记真实平台回执。
代码检查和 Synthetic 测试不替代鹈鹕、邮件、天气、平台及设备各自真实验收。

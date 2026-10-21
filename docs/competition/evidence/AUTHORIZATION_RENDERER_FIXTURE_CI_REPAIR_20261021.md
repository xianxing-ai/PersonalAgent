# PR #484：面板与 Workspace 夹具定向修复（2026-10-21）

Competition Profile。基于 `e7607ecbb` 隔离工作树，仅修四个已有测试文件；源码提交 `d654bd4d980cbaf2b1f24bebc0ab906c9c20475b`。没有修改 Main、Renderer、Workspace 生产实现、权限门禁、Schema 或依赖。

## 原失败与原因

原 Windows job `119283688561` 中分配到本包的 11 例为 expiry 5、feedback 4、Workspace 2。它们是以下夹具失配，不是通过删除断言或放宽产品边界解决：

1. `panel-approval-expiry.test.mjs` 抽取真实 `refreshApprovalCards`，未将其新增依赖 `approvalsWithoutQuestionCards` 注入 VM。现在导入真实 Renderer helper；定时到期、按钮锁、最新快照和卸载清理断言原样保留。
2. `panel-task-feedback-order.test.mjs` 遍历 `render = ...` AST 时，新问题卡外包装器没有 Host feedback 语句，却把前面已找到的真实面板反馈片段覆盖为空。现在只接收包含该原反馈逻辑的片段，并断言唯一且非空。Host/操作错误的 revision 所有权、相同文本、迟回和显式刷新断言不变。
3. `workspace-command-config.test.mjs` 的 Synthetic recipe factory 漏真实 `outputSchema`，原严格投影验证收到 undefined 后拒绝。现在只从公开 `createWorkspaceCommandTool` 构造器取得真实 descriptor；执行仍为显式 Fake，不执行本地命令。保留独立许可、撤销和去除 stdout/stderr 私人内容的断言。
4. `workspace-command-recipes.test.mjs` 在 Windows 比较 TEMP 的短路径别名与真实 canonical path。现在按同一 `realpathSync.native` 比较 Node/npm 路径；完整固定 argv、symlink flags 及拒绝模型自选选项的断言不变。

没有将 deny 与 expiry 混淆，没有恢复旧设置页全局许可或降低结果 Schema 检查。

## 实际验证

四个 MJS 的 `node --check` 与 `git diff --check` 在隔离树通过。该树没有安装依赖或借其他树旧 dist 执行测试；将源码正常合入统一集成树后，在**实际同源 head `2a2075dd5aafcaec86a7f1b4ec3c6efafcf154c3`** 使用该树已有依赖/dist 执行下列最小回归。集成 owner 确认期间没有生产代码变化；执行前后工作树 clean。

Node 24.15.0 / PowerShell 7，TEMP/TMP 指向仓库外独立测试目录；串行执行，无构建、Electron、native 子进程、模型或账号操作。

| 命令（Node 24） | 结果 | 原始安全输出 |
| --- | --- | --- |
| `node --test --test-concurrency=1 --test-reporter=spec apps/desktop/test/panel-approval-expiry.test.mjs apps/desktop/test/panel-task-feedback-order.test.mjs` | 21 pass / 0 fail / 0 skip | [panel.txt](authorization-renderer-fixture-ci-20261021/panel.txt) |
| `node --test --test-reporter=spec --test-name-pattern='project scripts need a trusted helper, factory receipt and separate session consent' apps/desktop/test/workspace-command-config.test.mjs` | 1 pass / 0 fail / 0 skip | [workspace-config.txt](authorization-renderer-fixture-ci-20261021/workspace-config.txt) |
| `node --test --test-reporter=spec --test-name-pattern='native fixed Node recipes preserve symlink resolution' apps/desktop/test/workspace-command-recipes.test.mjs` | 1 pass / 0 fail / 0 skip | [workspace-recipes.txt](authorization-renderer-fixture-ci-20261021/workspace-recipes.txt) |

合计 23 pass / 0 fail / 0 skip，命令退出 0（约 4.69 秒）。面板为真实源码函数 + VM/Fake IPC，Workspace 为真实 descriptor/投影 + Synthetic execute 或固定 recipe 元数据；这不是 Main/Renderer 实体渲染、真实工具执行或 OS 隔离验收。没有重跑已有 UI、整个 Workspace 文件或 native 进程矩阵。

原 Windows 失败与其他 owner 修复分别保留，本组通过不代表该旧 CI 已绿或 PR 全部必需检查完成；新 head 的仓库技术 CI 由统一 PR 实际执行。所有修复和本记录通过同一 #484 集成分支交付，不单独新建组件 PR、auto-merge 或入队。

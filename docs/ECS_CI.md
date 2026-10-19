# 单台 ECS 分担现有 CI 与批准后的自动合并

当前接入一台华为 Ubuntu ECS，使用 GitHub 官方开源 Actions Runner、独立 `pa-ci` 用户和 systemd 开机自启。其余三台机器尚未接入，不配置用户本机。GitHub 原 Windows Runner 与 ECS 并行分担同一个 PR 的必要检查。

## 检查分工

| 原检查 | ECS：ecs-linux-check | Windows：check |
| --- | --- | --- |
| 架构门禁、契约夹具、生成类型一致性 | 执行 | 已迁移到 ECS |
| 全工作区类型检查 | 执行原 npm run typecheck | 已迁移到 ECS |
| 构建测试所需 dist | 构建本机测试输入 | 构建本机测试输入 |
| 原 workspace 单测 | 26 个已确认无 Windows 平台测试分支的 workspace | 8 个 Windows / 桌面 / 宿主相关 workspace |
| 原 22 个集成测试文件 | 20 个跨平台文件 | Obsidian pairing、wiki write recovery 两个文件 |
| .NET 8 Windows Job Helper | 不适用 | 保留原构建与 helper 环境 |
| storage / protocol / runtime 示例 | 不重复执行 | 运行原 Node 入口，复用本次已构建的 dist |

精确清单在 [partition.json](../scripts/ci/partition.json)。Windows 保留 coding-tools、cognition、knowledge、windows-client、agentarts-runtime、desktop、obsidian-plugin、runtime 的原 `npm run test`；ECS 执行其他 26 个原 workspace 测试脚本。没有删除测试或修改断言。每次运行验证清单覆盖所有现有 workspace 与集成测试文件且不重不漏；新增文件或 workspace 未分组会失败，需明确审查归属。

运行版本为 Node 24.15.0 / npm 11.12.1。ECS 使用 `npm ci --ignore-scripts`，避开不使用的 Electron GUI 下载；当前锁定依赖没有其他必要安装脚本，后续若引入应显式接入。Windows 完整 `npm ci` 和原生宿主构建保留。两端均只在 PR 和 main push 执行，避免 feature push 与同一 PR 重复构建。

首次 Ubuntu 全量实验发现 coding-tools 的 isolated-repair publish CAS / unrelated 用例返回 unknown，预期 published；补丁发布依赖 Windows PowerShell，故 coding-tools 原套件保留 Windows。不能把该实验称为通过，也不能把 Linux 绿灯当作 Windows 原生验收。

本次把实际检查工作移到 ECS，同时去掉 Windows 三个示例前重复的全仓构建。两端各需本机构建作为测试输入，尚未跨平台共享 dist；少量 workspace 原测试脚本内部仍会构建其依赖。实际提速须比较调整前后完成耗时，不能仅凭并行或增加 Runner 声称提速。自动合并减少的是全绿后等待手动合并的时间，仍需非作者审批。

## 合并规则

main 原必需状态 `check` 保留，追加 `ecs-linux-check`，均绑定官方 Actions app。保留 strict 主线同步、管理员约束、一次非作者审批、过期批准作废和会话解决规则。

`Approved PR auto-merge` 在 CI/审查工作流完成后检查 PR，每五分钟补查，也可手动触发。仅从默认分支加载脚本，使用短期 `GITHUB_TOKEN`；只处理同仓库到 main 的非 Draft PR，复用现有 `evaluateReviews`，要求既有名单中至少一位非作者对当前 head 的有效批准，且没有未处理的 Changes Requested。两项必需 CI 及当前 head 其他检查/状态必须成功。

随后调用 `gh pr merge --auto --squash --match-head-commit`，由 GitHub 再次检查分支保护与会话。无 `--admin` 或 Owner 例外。本配置 PR 本身仍须独立批准，进入 main 后才自动处理后续 PR。不接入 AI、不调用模型。

## 运维

远程 Runner 目录执行 `sudo ./svc.sh status`、`start`、`stop`；GitHub Settings → Actions → Runners 确认在线。ECS 只执行同仓库分支；fork PR 的同一 Linux 检查改用 GitHub Ubuntu Runner，避免因跳过任务而遗失已迁移的验证。自动合并仍只处理同仓库 PR。专用 CI 主机不放生产或模型凭据；公开仓库长期 Runner 不能作为恶意代码隔离边界。

恢复时同时还原原 Windows 完整 CI、撤回新增必需状态 `ecs-linux-check`，再停止 ECS 服务；不能先撤走 ECS 执行器而遗失已迁移的测试。保留原 `check` 与审查规则。

依据：[官方 Runner](https://github.com/actions/runner)、[Runner 服务与自启](https://docs.github.com/en/actions/how-tos/manage-runners/self-hosted-runners/configure-the-application)、[GitHub 自动合并](https://docs.github.com/en/pull-requests/how-tos/merge-and-close-pull-requests/automatically-merging-a-pull-request)、[gh pr merge](https://cli.github.com/manual/gh_pr_merge)。

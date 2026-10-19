# ECS 协助 CI 与批准后的自动合并

使用 GitHub 官方开源 Actions Runner，运行在华为 Ubuntu ECS；服务由 systemd 管理，以独立 `pa-ci` 用户执行并随开机启动。Windows 原有 `Foundation / check` 完整保留，ECS 新增 `ECS Linux CI / ecs-linux-check`，执行 Node 24.15.0、npm 11.12.1 下的 `npm ci --ignore-scripts`、`npm run check` 和审查门禁测试。Linux 检查不能证明 Windows 原生路径通过。

ECS 无图形桌面，安装时不运行生命周期脚本，避免 Desktop 的 postinstall 下载 Electron GUI 二进制；保留上述所有代码检查，不运行 Electron 窗口冒烟。目前锁定依赖无其他必须执行的安装脚本。以后加入需要生成本地产物的依赖时，应显式接入它的可信构建步骤。Windows Foundation 的完整安装与原生验证不受影响。

`Approved PR auto-merge` 在 CI/审查工作流完成后检查 PR，每五分钟补查一次，也可手动触发。它仅从默认分支加载脚本，使用短期 `GITHUB_TOKEN`，不运行 PR 代码。仅处理当前仓库到 main 的非 Draft PR，复用现有 `evaluateReviews`，要求既有名单中至少一位非作者对当前 head 的有效批准，且没有待处理的 Changes Requested。

`check` 和 `ecs-linux-check` 必须来自官方 Actions app，当前 head 的所有检查及外部状态均须成功。主线必须同步、可合并。随后调用 `gh pr merge --auto --squash --match-head-commit`，由 GitHub 再次执行分支保护、审查与未解决会话规则；不传 `--admin`，不使用 Owner 审查例外。新提交使旧批准失效，红灯或缺少结果均不合并。

部署时在 main 的既有必需状态 `check` 之外增加 `ecs-linux-check`，保留 `strict`、管理员约束、一次非作者审批、过期批准作废、会话解决等原有规则。工作流合并到 main 后，后续 PR 无需逐个手动开启自动合并。配置 PR 自身仍须独立批准，不豁免审查。

ECS 工作流只接收同仓库分支，不执行 fork PR。专用 CI 主机不放生产凭据或模型密钥，Runner 用户不使用 root。公开仓库的长期自托管 Runner 不能作为恶意代码的隔离边界；如需接受外部贡献者代码，应先部署临时隔离 Runner。原 Windows CI 仍可验证 fork PR。

本次不接入 AI，不调用模型，不要求模型密钥。没有给本地电脑配置常驻 Runner 或开机服务。

运维：在远程 Runner 安装目录运行 `sudo ./svc.sh status`、`sudo ./svc.sh start`、`sudo ./svc.sh stop`。GitHub 仓库 Settings → Actions → Runners 可确认在线状态。恢复时停止远程服务；若撤回 ECS 工作流，同时从 main 必需状态中移除新增的 `ecs-linux-check`，保留原有 `check` 与所有审查规则。

依据：[官方 Runner](https://github.com/actions/runner)、[Runner 服务与开机启动](https://docs.github.com/en/actions/how-tos/manage-runners/self-hosted-runners/configure-the-application)、[GitHub 自动合并](https://docs.github.com/en/pull-requests/how-tos/merge-and-close-pull-requests/automatically-merging-a-pull-request)、[gh pr merge](https://cli.github.com/manual/gh_pr_merge)。

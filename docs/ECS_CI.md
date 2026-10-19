# 按 PR 分流 Windows 与 Linux 镜像 CI

华为 Ubuntu ECS 使用 GitHub 官方开源 [Actions Runner](https://github.com/actions/runner)、独立 `pa-ci` 用户和 systemd 开机自启。Linux 负责 AgentArts 镜像相关 PR；普通 PR 保留完整 Windows 检查。第二台 Windows ECS 的安装独立进行，接入前本工作流仍使用 GitHub Windows Runner。所有服务安装都在远程 ECS。

## 路由与验证

Foundation 的 `ecs-linux-check` 读取 GitHub 当前 PR 的完整分页文件列表，再生成仅包含所选任务的矩阵：

| PR 修改范围 | 实际 CI |
| --- | --- |
| 仅 `apps/agentarts-runtime/**` | Linux image CI，在 ECS 构建和测试镜像 |
| 普通 Windows、桌面、连接器及其他文件 | Windows CI，执行完整 `npm run check` |
| 同时涉及镜像目录和其他目录 | Windows CI + Linux image CI |
| 镜像共享依赖、根依赖或 CI 配置 | Windows CI + Linux image CI |
| 文件证据不完整、未知路径、main push 或手动运行 | 两边均执行；API 错误或 head 变化直接失败 |

共享依赖包括 `packages/contracts/`、`models/`、`coordination/`、`agentarts/`，`scripts/agentarts/`、`scripts/laya/`、`scripts/ci/`，`.github/workflows/`、`.github/actions/`，`tests/architecture/`、`tests/contracts/`、owned-agentarts-image 集成测试，以及根 `package.json`、锁文件、`tsconfig.base.json`、`.node-version`、`.npmrc`。重命名同时考虑新旧路径，删除也参与分类。规则与回归用例见 [pr-route.mjs](../scripts/ci/pr-route.mjs) 及其测试。

Windows 保留 .NET 8 Job process helper、原始完整架构/契约/生成类型/类型检查/全部 workspace 单测/全部集成测试，以及三个示例。示例复用本次已构建的 dist，避免重复全仓构建。此前将同一 PR 的单测分成两份的配置已移除。

Linux 使用 Node 24.15.0 / npm 11.12.1，执行架构、契约夹具、生成类型检查、五个镜像 workspace 的类型检查及模型/协调/传输/编排/镜像应用测试、owned-agentarts-image 集成测试。已有镜像测试还导入真实 Runtime/SQLite 宿主 fixture，因此先用原 `npm run build` 补全测试输入，不将缺依赖用例跳过；Linux 不运行完整 Windows 测试集。随后使用现有 allowlist 导出上下文，实际构建 `linux/arm64` 并检查产物架构。QEMU 用于在 X64 ECS 构建 ARM64。构建不推送、不部署、不调用模型；通过只证明这些 CI 检查，不能代替 AgentArts 平台和真实工具链验收。

Linux 的 `npm ci --ignore-scripts` 避开无关 Electron GUI 下载；新增必要依赖安装脚本时须显式接入。Windows 使用完整 `npm ci`。同仓库镜像任务使用 `[self-hosted,Linux,X64,personalagent-ecs]`；fork 镜像任务使用 GitHub Ubuntu 24.04，避免把外部 PR 交给常驻 ECS。没有给未选平台创建跳过状态来充当通过。

ECS 直连 Docker Hub 超时，因此 CI 将 Dockerfile 中官方 Node 基础镜像的 registry 显式换为 Docker 官方 ECR Public 副本，保留相同版本及 SHA256 digest；仅接受该固定格式，未知基础镜像不静默替换。已在 ECS 拉取同 digest 的 ARM64 基础镜像，未修改产品 Dockerfile 或全局 Docker 镜像源。

## 合并门槛

main 两项原必需状态名 `check` 与 `ecs-linux-check` 及官方 Actions app 绑定不变。`ecs-linux-check` 现在是路由与门禁回归检查；`check` 是最终汇总，要求路由及每个实际选中任务都成功，失败、取消、跳过或缺少结果均不能通过。两绿表示本 PR 所需平台已实际通过，不要求无关平台空跑。

保留 strict 主线同步、管理员约束、一次有效非作者审批、过期批准作废和会话解决规则。`Approved PR auto-merge` 仍从默认分支读取脚本，复用现有 `evaluateReviews`，只处理同仓库到 main 的非 Draft PR，要求四位既有协作者之一对当前 head 有有效非作者批准且无未处理 Changes Requested；当前 head 的其他检查/状态也必须成功。

之后执行 `gh pr merge --auto --squash --match-head-commit`，由 GitHub 再检查保护和会话。无需修改自动合并脚本或放宽保护；本配置 PR 本身也须独立审批。AI 暂不启用。

## 运维与恢复

Runner 位于 `/opt/personalagent-ci/runner`，systemd 服务 `actions.runner.zemeng5208-PersonalAgent.ecs-472f-c018-linux.service` 自动启动。Docker 服务也需自动启动，`pa-ci` 的 Docker 组权限经用户明确授权。Docker 组具有 root 等价权限；该专用 CI 主机只接收本仓库任务，不放生产或模型凭据，不能作为恶意代码的隔离边界。

镜像步骤通过 `sg docker` 在新进程载入已授权的组成员关系，无需重启正在处理其他 PR 的 Runner；正常重启和开机后服务也会自动继承该成员关系。

### 自动资源管理

该 Linux 节点 2 核、约 5.4 GiB 可用物理内存、40 GiB 系统盘，先保持单 Runner、单重任务；镜像测试文件并发为 1，构建 workspace 串行。已观察 Runner 整个 systemd 进程组的历史峰值约 1.54 GiB；服务使用 `MemoryHigh=3G`、`MemoryMax=4G`，约留 1.4 GiB 给系统及独立 Docker 构建。该 cgroup 限制覆盖 Runner 及其后代，Docker 构建进程归 Docker 服务，不能把它或单 Node heap 误报为整机上限。实际 Docker 构建已成功，当前镜像/构建缓存不足 1 GiB。

远程 `/opt/personalagent-ci/maintenance/` 保存 root 拥有的资源脚本，Runner 前后 hook 同步检查，并在新 Foundation 的前后步骤中显式回读。启动要求磁盘至少 8 GiB、`MemAvailable` 至少 2.5 GiB；门槛按当前构建增量、已观察进程组峰值及系统余量设置，后续按实测更新。空间不足只先回收过期 CI 数据，仍不足明确失败并写摘要；不自动付费扩容、不杀其他任务，也不伪造成功。

每个实际任务按 5 秒采样整机可用内存及磁盘余量，摘要记录最低可用量和整机已用内存峰值；JSONL 诊断留在 `/opt/personalagent-ci/resource-state/`，保留 14 天。报告只记录容量指标，不输出环境变量或凭据。

远程 `personalagent-ci-maintenance.timer` 每小时在空闲时维护。它与任务启动共用文件锁；有 `Runner.Worker` 时跳过，维护期间新任务的前置 hook 等待。只处理核验归属的 CI 路径：过期 7 天的 Runner 临时目录、14 天 Worker/npm 日志和资源报告、30 天 Runner 日志、3 天的旧 allowlist 上下文；拒绝符号链接、外部路径、其他用户数据和含近期文件的旧目录。Docker 只回收超过 7 天的未使用构建缓存，保留 6 GB 缓存预算，不清空镜像、容器或 volume。每次构建结束只删除本次镜像标签和本次 allowlist 上下文；失败的未完成导出留作短期诊断，之后按保留策略处理。

`scripts/ci/resources_test.py` 用临时 fixture 验证清理边界、外链/他人文件保护、活跃任务互斥和内存不足失败。运维可执行 `python3 /opt/personalagent-ci/maintenance/resources.py dry-run` 查看空闲回收范围。持续不足时根据资源摘要调整任务并发、显式切换托管 Runner，或由用户决定升级；Windows 的同类保护由其独立配置任务负责，不能用 Linux 的验证冒充 Windows 已生效。

默认 `PA_IMAGE_RUNNER=ecs`。ECS 故障时可将仓库 Actions 变量 `PA_IMAGE_RUNNER` 设为 `github` 后重跑，让镜像任务在 GitHub Ubuntu 执行；恢复后删除变量或设回 `ecs`。这是显式切换，GitHub 不会因自托管 Runner 离线而自动改派其他系统。不得跳过镜像构建来制造绿灯。

查看服务与 GitHub Runner 在线状态后再处理故障，繁忙时不重启。只清理本次 CI 镜像标签，不执行全局 Docker prune。回滚路由需完整还原上一版两个工作流、分组脚本和命令；保留原必需状态和审批保护。

依据：[Runner 服务](https://docs.github.com/en/actions/how-tos/manage-runners/self-hosted-runners/configure-the-application)、[自托管任务路由](https://docs.github.com/en/actions/reference/runners/self-hosted-runners)、[自动合并](https://docs.github.com/en/pull-requests/how-tos/merge-and-close-pull-requests/automatically-merging-a-pull-request)、[gh pr merge](https://cli.github.com/manual/gh_pr_merge)。

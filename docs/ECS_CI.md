# CI Runner 策略与历史 ECS 运维记录

## 当前策略：全部使用 GitHub 官方标准托管机器（2026-10-23）

本节取代下文历史 ECS 分流说明。所有工作流的实际任务只选择 GitHub 官方标准托管 runner，不使用付费 larger runner，不注销或修改任何 ECS 主机。

- Foundation 的所有 PR（含 fork、所有编号尾数）、merge_group 和手动验证均使用 `windows-latest` / `ubuntu-24.04`。PR 的文件分类不变，队列及手动验证仍执行两平台；不新增 main push 或 post-merge dispatch 全量检查。
- 工作流不再读取 `PA_WINDOWS_RUNNER`、`PA_WINDOWS_RUNNER_OVERRIDES`、`PA_IMAGE_RUNNER` 仓库变量。路由函数兼容合法旧参数，但旧 `ecs` 设置、标签和编号不能把任务送回 ECS；非法配置仍报错。手动输入仅提供 `github`。
- Runner probe 的 push 入口与手动入口只接受官方 Windows 探针；旧 `windows-pool*` / `ecs-17f8` 目标失败关闭，不冒充已测试旧主机。保留显式手动 `psec-strict`（`windows-2025`）与 `psec-strict-arm64`（`windows-11-vs2026-arm`）的原生架构、普通用户和零跳过验收门槛。
- Linux 镜像仍通过 QEMU 构建并验证 `linux/arm64`，不发布。其他工作流原已使用官方 Ubuntu，保持不变。
- 必需状态 `ecs-linux-check`（保留兼容名称）和 `check`、非作者批准、精确 SHA / run / attempt / runner 回执校验、完整 Windows 测试、超时及安全断言均不变。保留的 ECS 源码传输/缓存/准入步骤受旧矩阵条件保护，当前矩阵无法选中；相关历史工具和测试不作本次清理。
- 旧 run 仍使用原事件提交，不能原地改派；需等待本变更按原保护规则合并，后续使用新工作流的 run 才服从新策略。CI 通过不代表已合并、真实 PSEC 验收或产品验收完成。

上述 Windows x64、Windows ARM64 与 Ubuntu 标签均属于[官方标准托管 runner](https://docs.github.com/en/actions/reference/runners/github-hosted-runners)。当前公开仓库使用标准 runner 免费；不选择 larger runner。

## 历史策略与主机运维记录（不再作为调度规则）

同仓库普通 PR 按编号个位数分流：0–6 的所选 Windows/Linux 检查使用 GitHub 托管机器，7–9 使用对应系统的 ECS 公共池。同类自建节点共享用途标签，GitHub 将任务派给匹配且空闲的 Runner，忙时排队，不为每个 PR 在每台机器重复完整检查。仓库工作流不注册、安装或配置主机；工具链、长期服务、自启动与资源保护由各主机负责人管理。

`windows-latest` 只选择 GitHub 托管 Windows。自建 Windows 必须显式选择 `[self-hosted,Windows,X64,personalagent-windows]`。公共池不固定机器数量：已注册且在线、完成主机准入配置的第二、第三、第四台 Windows 才能实际领取；未注册机器不算已验收。

## 路由与验证

### Merge Queue 兼容（组织仓库）

Foundation 接收 `merge_group: checks_requested`，验证 payload 的仓库、`refs/heads/main` 基线、队列 ref 与 `GITHUB_REF` 一致、组合 SHA 与 `GITHUB_SHA` 一致。队列按整个组合提交执行 Windows 和 Linux 两条原有检查，不按某个 PR 的文件清单缩减覆盖。

队列始终使用 GitHub 托管 `windows-latest` / `ubuntu-24.04`，忽略普通 PR 的个位数分流、ECS 开关与 override。队列分支属于目标仓库不代表其中所有代码均来自同仓库，故不能据此把 fork 代码交给持久 ECS。普通 PR 仍按文件决定所需平台，再按下述策略选择机器池。

最终 `check` 独立要求两个托管平台实际通过，回执必须匹配本次 run、attempt 和组合 SHA；缺少、跳过、取消、失败或身份不符都不能通过。普通 PR 仍绑定 PR head，不能与队列的组合 SHA 混用。不新增 main push 全量检查，不推送镜像或部署。

代码合并、必要 CI 通过后才能由管理员启用队列规则，保留原审批及必需检查。建议初始 Merge commit、构建并发 1、每组合并 1–5 个 PR、所有条目必须通过；超时应按历史真实 CI 耗时设置。此文档不是设置已开启的证明，必须以 GitHub 规则读回和实际 `merge_group` 运行验收为准。

官方依据：[队列管理](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/configuring-pull-request-merges/managing-a-merge-queue)、[merge_group 事件](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#merge_group)。

Foundation 的 `ecs-linux-check` 读取 GitHub 当前 PR 的完整分页文件列表，再生成仅包含所选任务的矩阵：

| PR 修改范围 | 实际 CI |
| --- | --- |
| 仅 `apps/agentarts-runtime/**` | Linux image CI，在所选 Linux 池构建和测试镜像 |
| 普通 Windows、桌面、连接器及其他文件 | 一条 Windows CI，执行完整 `npm run check` |
| 同时涉及镜像目录和其他目录 | Windows CI + Linux image CI |
| 镜像共享依赖、根依赖或 CI 配置 | Windows CI + Linux image CI |
| 文件证据不完整、未知路径或手动运行 | 两边均执行；API 错误或 head 变化直接失败 |

共享依赖包括 `packages/contracts/`、`models/`、`coordination/`、`agentarts/`、`client/`，`apps/runtime/`，`scripts/agentarts/`、`scripts/laya/`、`scripts/ci/`，`.github/workflows/`、`.github/actions/`，`tests/architecture/`、`tests/contracts/`、owned-agentarts-image 集成测试，以及根 `package.json`、锁文件、`tsconfig.base.json`、`.node-version`、`.npmrc`。Runtime 与 Client 是实际镜像集成 fixture 的依赖。重命名同时考虑新旧路径，删除也参与分类。规则与回归用例见 [pr-route.mjs](../scripts/ci/pr-route.mjs) 及其测试。

Windows 保留 .NET 8 Job process helper、原始完整架构/契约/生成类型/类型检查/全部 workspace 单测/全部集成测试，以及三个示例。示例复用本次已构建的 dist，避免重复全仓构建。此前将同一 PR 的单测分成两份的配置已移除。

同仓库 PR 的默认策略为编号个位数 0–6 → GitHub 托管，7–9 → 对应系统的 ECS 公共池，Windows 和 Linux 使用同一个默认分组。例如 #465、#466 选托管，#467、#468、#469 选 ECS，#470 再选托管。PR 更新和重跑保持同一分配，ECS 忙时等待同系统的匹配空闲节点，不自动跨池改派。这是按 PR 编号约七三分流，不保证任务数、运行时间或资源负载七三分，也不预留托管并发名额。手动完整验证保持原默认：托管 Windows、ECS Linux。main push 和合并后 dispatch 不再触发 CI；合并前 PR 当前提交通过即可，不增加主线复测或主线证据复用层。fork 两个平台均强制托管，显式开关也不能把 fork 送入常驻 ECS。该策略不是实时资源预测；`online` 不表示磁盘、内存或工具链已经通过。

| Actions 仓库变量 | 默认值 | 用途 |
| --- | --- | --- |
| `PA_WINDOWS_RUNNER` | `auto` | `auto` 使用 PR 个位数策略；`github` / `ecs` 显式选择 Windows 池 |
| `PA_WINDOWS_RUNNER_OVERRIDES` | `{}` | 按 PR 定点切换，例如 `{"421":"github"}`；优先于仓库 Windows 开关 |
| `PA_IMAGE_RUNNER` | `auto` | `auto` 使用 PR 个位数策略；`github` / `ecs` 显式选择 Linux 池；没有 PR 编号时 `auto` 保留 ECS |

变量由有权限的维护者修改；不从 PR 正文、评论或模型输出读取调度指令。无效值使路由失败。路由只用本次 Actions 短期 token 读取 PR 文件，无需向主机分发个人 PAT 或提升 runner-list API 权限。

启用默认个位数分流时须核对现存配置：两个池变量应为空或 `auto`，且目标 PR 无 Windows 定点 override。已设置的 `ecs` / `github` 仍优先，Windows 定点 override 仍只覆盖 Windows、不改变 Linux；本源码改动不会清除仓库变量。保留这些显式故障切换能力，不将旧配置误报成新默认已在所有 PR 生效。

本次已获批准的一次性例外：仅当真实 `pull_request` 事件对应 `zemeng5208/PersonalAgent` 同仓库源分支 `codex/pr-harness-big-batch-20261020`、目标同仓库 `main`，且现有 PR API/head/文件证据验证成功时，所有实际选中的 Windows/Linux 检查均使用现有 GitHub 托管 job。匹配采用可信 PR API 返回的精确仓库及分支名，不采用正文、评论或分支前缀，也不猜 PR 编号；其他分支、仓库、事件和默认分流不变。原始配置仍先严格校验，合法的显式 ECS 选择在这一个分支上被一次性托管例外覆盖。没有修改全局变量、工作流权限、必需状态名称或测试步骤。

例外实现在该源分支的源码中，创建 PR 前随提交进入合成 merge ref，因此无需创建后补配变量，首轮 PR CI 即可选中托管 runner；仍须从本 run/attempt 的实际 runner 与最终 `check` 验证真实结果。该限定分支不得在未来其他工作包重用；后续清理例外时保留其他分支的原始策略。旧 run 不会原地改派，重跑保留原事件 SHA；手动 `workflow_dispatch` 不替代 PR 必需状态。

手动完整 Foundation 验证还可用 `windows_runner` / `image_runner` 输入显式选择两个池，不改其他 PR 的仓库变量；手动运行始终检查两个平台，不可用来缩小覆盖范围。

两条 Windows 路径使用同一套安装、构建与测试命令；ECS 额外执行源码/下载缓存传递和主机准入校验，不删产品测试、不修改断言。混合 PR 中架构/契约及镜像相关测试仍在两个操作系统检查，保留兼容性覆盖。去重只消除同一 PR 的两份 Windows 全套和三个示例各自再次构建全仓的开销；没有把跨平台公共检查移走后宣称等价。

ECS 的 Git HTTPS 直连曾在实际短任务中失败。工作流因此由托管路由作业 checkout 精确事件 SHA，将不含 checkout 凭据的 Git 元数据和对象打包成同 run、路由生产 attempt 的短期 Actions artifact；ECS 从 Actions 下载并核验独立输出的 SHA256，在本任务新建的临时目录本地恢复精确 SHA，全程不在 ECS 执行 Git 网络 fetch。打包拒绝 HTTP/credential/include 等本地 Git 配置和含凭据的 origin，不包含未跟踪 `.env`、依赖、缓存、Git hooks 或 reflog；还原禁用 hooks，不覆盖既有 checkout。源码 artifact 保留一天；排队超过有效期必须重新运行全部 jobs，不能复用其他 run 的工件。仅重跑消费者时，工件名使用保留的路由输出 `producer_attempt`；重新运行全部 jobs 时，路由输出更新为新的生产 attempt。下载通道不可达仍应失败并显式切换，不能跳过源码或测试。

Linux 使用 Node 24.15.0 / npm 11.12.1，执行架构、契约夹具、生成类型检查、五个镜像 workspace 的类型检查及模型/协调/传输/编排/镜像应用测试、owned-agentarts-image 集成测试。已有镜像测试还导入真实 Runtime/SQLite 宿主 fixture，因此先用原 `npm run build` 补全测试输入，不将缺依赖用例跳过；Linux 不运行完整 Windows 测试集。随后使用现有 allowlist 导出上下文，实际构建 `linux/arm64` 并检查产物架构。QEMU 用于在 X64 ECS 构建 ARM64。构建不推送、不部署、不调用模型；通过只证明这些 CI 检查，不能代替 AgentArts 平台和真实工具链验收。

Linux 的 `npm ci --ignore-scripts` 避开无关 Electron GUI 下载；新增必要依赖安装脚本时须显式接入。Windows 使用完整 `npm ci`。选中 ECS 的镜像任务使用 `[self-hosted,Linux,X64,personalagent-ecs]`；选中托管及所有 fork 镜像任务使用 GitHub Ubuntu 24.04，避免把外部 PR 交给常驻 ECS。没有给未选平台创建跳过状态来充当通过。

Windows ECS 的 Electron 安装包直连 GitHub 也曾失败。选中 ECS 时，托管路由作业只安装锁定的 npm 包而不执行安装脚本，再用锁定的官方 `@electron/get` 从官方发布地址下载 Windows x64 Electron，核验 Electron npm 包内嵌 SHA256。官方缓存布局通过同 run、路由生产 attempt 的独立 artifact 传给 ECS，使用与源码一致的 `producer_attempt` 绑定；恢复时校验归档 SHA256、完整锁文件摘要、版本与文件摘要，并设置本 job 的 `electron_config_cache`。原始 `npm ci` 和 Electron `postinstall` 仍执行并使用官方内嵌校验和；没有跳过安装、修改依赖、使用第三方二进制源或改主机配置。缓存工件保留一天，不能借用其他 run 或不同锁文件的缓存。

ECS 直连 Docker Hub 超时，因此 CI 将 Dockerfile 中官方 Node 基础镜像的 registry 显式换为 Docker 官方 ECR Public 副本，保留相同版本及 SHA256 digest；仅接受该固定格式，未知基础镜像不静默替换。已在 ECS 拉取同 digest 的 ARM64 基础镜像，未修改产品 Dockerfile 或全局 Docker 镜像源。

## 合并门槛

main 两项原必需状态名 `check` 与 `ecs-linux-check` 及官方 Actions app 绑定不变。`ecs-linux-check` 现在是路由与门禁回归检查；`check` 是最终汇总，要求路由及每个实际选中任务都成功，失败、取消、跳过或缺少结果均不能通过。两绿表示本 PR 所需平台已实际通过，不要求无关平台空跑。

最终汇总还通过 GitHub API 读取**本 run、本 attempt** 的所有 jobs，逐项核验选中 job 的 `success`、`runner_name` 和标签，并在 summary 中将未选平台标为 `not selected / not run / not a pass`。重跑不能借用旧 attempt 的通过结果。

保留 strict 主线同步、管理员约束、一次有效非作者审批和会话解决规则。首轮需要四位既有协作者之一给出非作者批准；后续 CI 修复提交保留批准，不要求反复审批。显式撤销或 Changes Requested 仍然阻止合并。`Approved PR auto-merge` 从默认分支读取脚本，只处理同仓库到 main 的非 Draft PR；当前 head 的全部检查/状态必须成功。

未启用 Merge Queue 时，CI 完成事件触发受保护自动合并：`gh pr merge --squash --match-head-commit`，由 GitHub 再检查保护和会话。多条 PR 并行检查，合并请求串行且立即核对 main 是否变化；不再读取 main 的测试结果，也不补发合并后 CI。更新后只测试该 PR 新版本。不使用 Owner 审核例外或管理员绕过；仍要求有效批准，其他保护不变。

此防护合入默认分支后，启用 Merge Queue 时 `Approved PR auto-merge` 工作流只评估资格并记录 `no request sent`，不使用内置 `GITHUB_TOKEN` 自动入队。脚本不从 actor 名、token 字符串或缺失元数据推断外部身份，也没有环境变量开关。已有入队项保持不变；用户移出队列后，周期扫描不会将其重新放回。此防护不是全自动入队功能已恢复；尚未合入时，现有默认分支行为不受本 PR 改变。

依据 [GitHub GITHUB_TOKEN 文档](https://docs.github.com/en/actions/concepts/security/github_token)（2026-10-21 核对），该 token 产生的事件通常不创建新工作流，`merge_group` 不在列出的例外中。#470 的自动入队日志、内置 token 接线和对应队列 SHA 零工作流支持事件抑制判断，但不等于已取得 GitHub 服务端投递诊断。不要用源 PR 绿灯替代队列检查，也不要手写成功状态。

恢复单个 PR 时，由已获授权的非此 Actions token 身份在确认用户仍要求入队后执行正常入队，并读回队列 SHA 的真实 Foundation。库函数保留显式 `queueAdmissionImpl` 接口供未来受信调用方接入：它须自行验证执行身份与当前用户授权、遵守取消、匹配传入的精确 head 并使用正常队列保护；函数只传仓库、PR 编号和 head，不传工作流 token。当前 CLI 不提供该适配器，异常不回退到内置 token 或盲重试。新增 App/PAT 或持久凭据配置需单独授权，不在本防护内。

同一 PR 的选中检查并行执行；首个失败会停止该 PR 的剩余检查，其他 PR 继续并行。`CI failure feedback` 在 Foundation 失败或超时完成事件后，从默认分支加载通知脚本，在对应的仍打开且 head 未变的 PR 中 `@原作者`，附实际失败 job 链接。评审者负责审批和验证，不代改代码。同 run/attempt 只通知一次；取消、旧 head、已关闭 PR 和手动探测不通知。通知只读取 API 元数据，不执行失败 PR 的代码或下载其工件。工作流须合入默认分支后才接收真实完成事件；消息到达时间取决于 GitHub 事件和通知投递。

## 运维与恢复

Runner 位于 `/opt/personalagent-ci/runner`，systemd 服务 `actions.runner.zemeng5208-PersonalAgent.ecs-472f-c018-linux.service` 自动启动。Docker 服务也需自动启动，`pa-ci` 的 Docker 组权限经用户明确授权。Docker 组具有 root 等价权限；该专用 CI 主机只接收本仓库任务，不放生产或模型凭据，不能作为恶意代码的隔离边界。

镜像步骤通过 `sg docker` 在新进程载入已授权的组成员关系，无需重启正在处理其他 PR 的 Runner；正常重启和开机后服务也会自动继承该成员关系。

### 资源保护接线与部署边界

下述 Linux 文件来自保留的 `ba6072f` WIP。仓库中的脚本与 systemd 模板不证明远程维护 timer、自动 hook 已加载。脚本更新仍须由主机负责人安装、回读配置并用真实 job 验证；本任务不会执行这些主机操作。Foundation 的显式 start/complete 步骤只能证明该次调用，不等于自动 hook 或冷重启验收。

该 Linux 节点 2 核、约 5.4 GiB 可用物理内存、40 GiB 系统盘，先保持单 Runner、单重任务；镜像测试文件并发为 1，构建 workspace 串行。已观察 Runner 整个 systemd 进程组的历史峰值约 1.54 GiB；服务使用 `MemoryHigh=3G`、`MemoryMax=4G`，约留 1.4 GiB 给系统及独立 Docker 构建。该 cgroup 限制覆盖 Runner 及其后代，Docker 构建进程归 Docker 服务，不能把它或单 Node heap 误报为整机上限。实际 Docker 构建已成功，当前镜像/构建缓存不足 1 GiB。

Linux Foundation 调用 checkout 之外 `/opt/personalagent-ci/maintenance/resources.py` 做前后检查，文件不存在或资源不足时失败。脚本设计的门槛为磁盘至少 8 GiB、`MemAvailable` 至少 2.5 GiB；空间不足只先回收过期 CI 数据，仍不足明确失败并写摘要。不会自动付费扩容、杀其他任务或伪造成功。

每个实际任务按 5 秒采样整机可用内存及磁盘余量，摘要记录最低可用量和整机已用内存峰值；JSONL 诊断留在 `/opt/personalagent-ci/resource-state/`，保留 14 天。报告只记录容量指标，不输出环境变量或凭据。

`personalagent-ci-maintenance.timer` 模板设计为每小时在空闲时维护。它与任务启动共用文件锁；有 `Runner.Worker` 时跳过，维护期间新任务的前置 hook 等待。只处理核验归属的 CI 路径：过期 7 天的 Runner 临时目录、14 天 Worker/npm 日志和资源报告、30 天 Runner 日志、3 天的旧 allowlist 上下文；拒绝清理根及祖先符号链接、外部路径、其他用户数据和含近期文件的旧目录。Docker 只回收超过 7 天的未使用构建缓存，保留 6 GB 缓存预算，不清空镜像、容器或 volume。每次构建结束只删除本次镜像标签和本次 allowlist 上下文；失败的未完成导出留作短期诊断，之后按保留策略处理。

`scripts/ci/resources_test.py` 用临时 fixture 验证清理边界、外链/他人文件保护、活跃任务互斥和内存不足失败。运维可执行 `python3 /opt/personalagent-ci/maintenance/resources.py dry-run` 查看空闲回收范围。持续不足时根据资源摘要调整任务并发、显式切换托管 Runner，或由用户决定升级；Windows 的同类保护由其独立配置任务负责，不能用 Linux 的验证冒充 Windows 已生效。

Windows ECS 使用主机负责人安装的 `C:\ProgramData\PersonalAgentCI` 前后 hooks。仓库只读验证实际 PreJob context：非 fixture、run/attempt/job 匹配、真实 Runner.Worker 启动身份、资源门槛、单核 affinity 及继承的 Node/.NET 设置。缺项直接失败，不能用在仓库内重新调用 hook 来冒充自动加载成功。Node heap1536 MiB 是每进程限制，整机聚合硬内存上限未配置；真实进程树峰值与 PostJob 记录须另外回读。

默认 `PA_IMAGE_RUNNER=auto`。ECS 故障时可将仓库 Actions 变量 `PA_IMAGE_RUNNER` 设为 `github`，取消旧 run 并确认结束，再重新运行全部 jobs，让路由重新选择 GitHub Ubuntu；仅重跑失败 job 会复用旧 route。恢复后删除变量或设回 `auto`。这是显式切换，GitHub 不会因自托管 Runner 离线而自动改派其他系统。不得跳过镜像构建来制造绿灯。

Windows 故障或公共池繁忙时，先查看 GitHub runner 注册、online/busy 状态与 job 是否已领取。可以等待空闲节点；需迁出时设置该 PR 的 `PA_WINDOWS_RUNNER_OVERRIDES` 为 `github`，取消旧 run 并确认已结束，再 **Re-run all jobs**。仅重跑失败 job 会复用旧 route 输出，不能用来切换池。全池故障可设置 `PA_WINDOWS_RUNNER=github`，同时清除冲突的逐 PR override。已领取但资源不足的任务会由主机准入失败；不杀其他进程、不把排队当通过，不假定 GitHub 自动迁移已领取任务。恢复后清除临时 override；已有运行不会因此原地改派。

PR 也可显式添加精确标签 `ci:windows-github`，将所选 Windows 检查迁至普通 GitHub 托管池。路由从现有 PR API 的最后一次读回获取标签，不信任事件载荷里的标签。标签仅能选择 GitHub，不能选择 ECS 或自定义 Runner；先验证原有配置，非法变量或 override 仍失败。有效标签优先于有效的 Windows 变量、逐 PR override 和尾号分流；Linux 选择、平台分类、全部技术检查和合并门禁保持原规则，fork 继续强制隔离，merge group 继续使用既有双托管平台。

添加或移除标签本身不会触发 Foundation，也不会修改已有运行。需要新的既有 PR 事件（例如先添加标签再正常推送代码触发 synchronize），或完整重跑原 PR 的所有 jobs 让 route 重算；仅重跑失败平台不会重算池。标签是池选择，不是健康证明或绿灯捷径；仍须核对准确 head、真实 Runner 和最终必需检查成功。手动 workflow_dispatch 的成功证据与 PR 必需检查的实际接受状态分别核实。

## 验证与证据

`Runner probe` 是短任务，不包含安装或全量构建。默认不会随普通 PR 执行。合并后可手动选择 `windows-github`、`windows-pool`、`windows-pool-pair`、`windows-pool-three` 或 `ecs-17f8`；`ecs-17f8` 需要主机的同名定点标签。合并前可将待审提交普通推送至 `codex/ci-probe/<target>/<unique-suffix>` 触发相同流程，无需绕过 main 保护。只在刚读取的注册状态及主机负责人确认都满足时创建该探测 ref；pair/three 分别仅用于至少两台/三台已准备好的 Windows，验证多 job 在公共池的分配，不能假定任务必然落在不同机器。

验收按以下四项分别记录，不相互替代：

1. 注册：GitHub runner id、名称、OS、用途标签。
2. 在线与资源：读取时刻的 online/busy，以及主机配置/fixture；不代表真实 job。
3. 短任务：run/attempt/job ID、job API 的 `runner_name`、真实自动 PreJob/PostJob 与日志结果。
4. 完整 CI：准确 commit SHA、全部所选平台结论及最终 `check`；不是短任务或历史另一提交的通过。

主机对应关系为 Linux `ecs-472f-c018-linux`、Windows `ecs-782b-windows-2`、第三台计划 `ecs-17f8-windows-3`、第四台 `ecs-905d-4175-windows-4`。这张名称表不是注册或通过证明，实时证据放在 PR 验证记录中。CI 与真实 AgentArts 部署、模型、设备、冷重启验收继续分开。

查看服务与 GitHub Runner 在线状态后再处理故障，繁忙时不重启。只清理本次 CI 镜像标签，不执行全局 Docker prune。回滚路由需完整还原上一版两个工作流、分组脚本和命令；保留原必需状态和审批保护。

依据：[Runner 服务](https://docs.github.com/en/actions/how-tos/manage-runners/self-hosted-runners/configure-the-application)、[自托管任务路由](https://docs.github.com/en/actions/reference/runners/self-hosted-runners)、[自动合并](https://docs.github.com/en/pull-requests/how-tos/merge-and-close-pull-requests/automatically-merging-a-pull-request)、[gh pr merge](https://cli.github.com/manual/gh_pr_merge)。

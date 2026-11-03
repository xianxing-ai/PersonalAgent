# 独立云持续会话宿主

目标 profile 为 `huawei_ict_agentarts`。这是原 RuntimeApplication/TaskRuntime/Policy/ToolGateway/Scheduler 的另一种受信进程组合。AgentArts 仍负责已发布的编排；旧 Desktop 会话不迁移，整库和授权均不复制。该入口目前为 **provisional**，没有真实 Linux、业务账号、长期运行或关机验收结论。

生产链为：Desktop 可信 IPC → 已登记 SSH 主机和原出机检查 → runner 1.2 的固定私有 socket → 同一个云 Runtime → 原 Policy 与 AgentArts。`packages/contracts/schema/cloud-persistent.json` 是唯一跨宿主命令/读回协议。SSH 签名只校验传输身份，不批准工具。

## 部署前提

- 已获准使用的 Linux 主机、固定 SSH 指纹和已登记的受限 SSH 用户。没有自动购置 ECS、开放入站端口、创建凭据或提升访问权限的步骤。
- 独立持久数据目录，不能是 tmpfs，不能指向 Desktop 数据库或其副本。首次云 owner 不能接管已有其他任务的数据库。
- 固定且干净的源码 release，按根锁文件安装并构建完整依赖。现有 owned AgentArts 镜像只包含控制器依赖，**不包含这套 Runtime/SQLite/Policy**，不能拿它替代此宿主。
- 原 runner 已安装为 1.2；安装脚本同时部署 `remote-runner-service.mjs`、`local-repo-executor.mjs` 和 `cloud-runtime-transport.mjs`。非交互 SSH 不继承 systemd 环境，所以 runner 在无 `RUNNER_TOKEN` 时只读取固定 `/etc/personal-agent-runner/token`，不执行该文件的 shell 内容。
- 已登记 SSH 用户必须已经能访问原 runner journal、凭据和专用 `personal-agent-runner` 组。云 installer 只检查权限，不修改用户、组或策略。私有 socket 为该组 `0660`，目录为 `0750`；不监听公网 TCP。
- 独立云宿主资格记录必须包含固定 host/runtime、源码 revision、Runtime artifact 身份、持久卷和独立宿主观察的 Evidence 引用。它不能由模型、Renderer 输入或一次 SSH 心跳生成。关机后的真实持续运行证据仍单独验收。

受信部署配置默认是 `/etc/personal-agent-cloud-runtime/config.json`，字段如下。所有凭据字段均为主机本地受限文件路径，值不得进入配置、Git、日志或浏览器。

```json
{
  "version": 1,
  "owner": {
    "runtimeId": "fixed-cloud-runtime-id",
    "hostId": "original-registered-runner-id",
    "deploymentVersion": "fixed-agentarts-endpoint-version",
    "contractRef": "original-responsibility-contract",
    "contractVersion": "1"
  },
  "dataDirectory": "/var/lib/personal-agent-cloud-runtime",
  "qualification": {
    "runtimeId": "fixed-cloud-runtime-id",
    "hostId": "original-registered-runner-id",
    "dataDirectory": "/var/lib/personal-agent-cloud-runtime",
    "sourceRevision": "REPLACE_WITH_EXACT_40_HEX_RELEASE_HEAD",
    "runtimeArtifactRef": "REPLACE_WITH_READ_RUNTIME_BUILD_IDENTITY",
    "storageEvidenceRef": "original-persistent-volume-evidence-ref",
    "independentHostEvidenceRef": "original-independent-host-evidence-ref"
  },
  "agentarts": {
    "gatewayUrl": "https://your-fixed-agentarts-gateway",
    "runtimeName": "your-fixed-runtime",
    "deploymentVersion": "fixed-agentarts-endpoint-version"
  },
  "agentAuthorizationFile": "/etc/personal-agent-cloud-runtime/agent-authorization",
  "hostAuthorizationFile": "/etc/personal-agent-cloud-runtime/host-authorization",
  "receiptSecretFile": "/etc/personal-agent-cloud-runtime/receipt-secret"
}
```

`readRuntimeBuildIdentity()` 从该 release 构建后的 `@personal-agent/runtime` 读取；不要把源码 SHA 当成 artifact ref。系统服务复用原 runner 的 EnvironmentFile；独立启动且没有该环境时可提供 `runnerTokenFile`，其内容是原 token 本身。文件只由受信服务账号读取，禁止其他用户读取。配置、release 和凭据的实际权限及来源需在部署前核实。

仅准备服务定义：

```sh
sudo sh scripts/remote-runner/install-cloud-runtime.sh \
  /opt/personal-agent/releases/EXACT_RELEASE \
  /etc/personal-agent-cloud-runtime/config.json REGISTERED_SSH_USER
```

这一步不启用、不启动服务。核实资格和授权后才运行 `systemctl start personal-agent-cloud-runtime`。默认 `Restart=no`，避免把未知进程死亡当作抢占许可。Desktop `userData/cloud-persistent-binding.json` 只保存非秘密绑定：`{version:1,owner:<上述owner>,originRuntimeId:<本机固定身份>,qualificationEvidenceRef:<资格引用>}`；该 owner 必须匹配已启用的原 runner 主机。没有配置时 UI 明确不可用。

## 执行、控制与恢复

在远端执行器卡片选择原用户任务及期限，显式新建云持续会话。它是一个新的云所有者会话，不移动已运行的本机任务。提交意图先持久化；丢失回执以后只能按原提交命令读回，不能再次执行 submit。

云端先在原 SQLite 绑定 source/task/session，并幂等入队原用户指令，再读取固定 AgentArts contract。只读 describe 失败后，原维护循环可恢复尚未完成的本地 admission，不能重做未知工具。重复 tick 不重复写入/通知原指令。暂停、取消和拒绝审批先提交原本地控制/Policy，即使 AgentArts 离线也不能延后撤销。

审批 UI 展示原参数、摘要和期限，仅人工 `allow_once` 或 `deny`。Desktop 重新计算读回参数的 digest，若 runner 的脱敏改变了参数，则该回执不能用于批准。允许通过原 Runtime 一次性 Policy 消费；没有复制 Desktop 的模式或 grant，也没有默认完全访问。

维护循环复用 Desktop 的同一实现，只调用原 Scheduler 与原 worker。云进程在取得独占目录和 owner 之后调用原 `recoverInterruptedTasks()`；中断运行进入原 reconciliation，不能改成新任务。`.runtime-owner.lock` 不会超时失效；异常退出、主动停止时尚有 worker，或锁被替换，都必须先核实原进程及未知操作，再由获准操作者处理原锁。不要删除数据库、重建提交或自动换主机。服务启动在尚无 worker 的准备阶段失败，只释放自己持有的锁。

停用或移除 SSH 主机不会证明云任务已经停止。先读取原会话并完成其停止读回，再撤去传输访问。

## 实际能力与验收边界

当前固定服务装配原 proactive core（原上下文、事项、Scheduler）与生产 AgentArts teacher；设备离线始终为 false。Desktop 业务连接器、外部副作用工具和账号没有因此变成云能力。缺少的具体工具保持 unavailable / waiting_device，后续按同一 Runtime 组合增加实际获准的适配器，不能只改 capability 的 location。

本地 Fixture 检查了 Schema、真实 Runtime/SQLite/Policy、原结果恢复、排他目录、审批篡改、未知控制恢复及 socket/UI 边界。没有调用真实云服务、创建 ECS、使用 SSH 凭据或改变浏览器状态。真实验收必须固定同一 release/endpoint，并在实际关机窗口内取得原云 Scheduler、原工具和读回证据；#531 的 F23/F26、物理设备、WinForms 和独立真人审核门槛保持不变。

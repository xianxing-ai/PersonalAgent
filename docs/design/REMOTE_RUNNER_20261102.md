# 自备服务器上的远端执行器

目标 profile：`huawei_ict_agentarts`。执行器只跑已经定义好的值班任务和异步子任务，不另建 Runtime、调度器、授权层或任务库。本地仍用现有 TaskRuntime 记主机、回执和审计。

证据等级：协议、回环假主机和本机进程是 **Fixture**。安装脚本可以用 `sh -n` 做语法检查。没有连过真实华为云 ECS 或 VPS，也没有真实 GitHub 账号。这些真机验收还没做。

`developerDutyRemoteRunner()` 不传参数时仍返回原来的 stub。桌面和 `runner.host.*` 走 `createRemoteRunnerService`，那才是会真正派发的路径。

## 准备一台华为云 ECS 或普通 VPS

1. 买一台 Linux 云主机。华为云 ECS 常见镜像是 Ubuntu 或 Huawei Cloud EulerOS（openEuler 系）。架构可以是 x86_64 或 ARM64（aarch64）。
2. 安全组只放行 SSH，通常是 tcp/22，来源收成你自己的地址。不要把执行器状态目录或别的端口公开到公网。
3. 用你自己的 SSH 公钥登录一次，确认 `ssh user@地址` 可用。
4. 在服务器上保存主机公钥原文。本地登记时要填它的 SHA-256，并粘贴同一把公钥，指纹对不上就不能连接。
5. 把仓库里的 `scripts/remote-runner/` 拷到服务器，执行 `sudo sh install-remote-runner.sh`。脚本可以重复执行：版本没变就只做校验。它会安装固定版本的 Node.js 22.21.0，放入 `personal-agent-runner` 系统用户、systemd 服务、日志轮转，并在 `/etc/personal-agent-runner/token` 生成执行器令牌。令牌文件权限是 640，不会写进命令行。
6. 在主对话里用 `runner.host.add` 登记名称、地址、端口、用户、`huawei-ecs` / `vps` / `other`、系统、架构、并发和每分钟上限、仓库允许列表、主机密钥指纹、私钥和执行器令牌。这一步只生成待确认提案。
7. 核对摘要后调用 `runner.host.confirm`。未确认的主机不能收任务。私钥和令牌进本机安全存储，登记记录里只有引用。
8. 用 `runner.host.test` 或面板上的「测试连接」看心跳。

面板「远端执行器」列出主机、运行记录和任务回执。主对话还可以 `runner.host.list`、`enable`、`disable`、`remove`。

## 任务怎么跑

本地把任务签成 HMAC，经传输层交给远端。默认传输是 OpenSSH，`StrictHostKeyChecking=yes`，并且只用这次写入的 known_hosts。测试用回环传输，不需要真的 SSH。

远端进程是 `scripts/remote-runner/remote-runner-service.mjs`（1.1.0）。标准输入一次一个任务；`--serve` 给 systemd 扫 inbox。本地在首次异步调用前原子保存原任务、输入摘要与 unknown；相同键的输入变化或旧记录缺少摘要时拒绝。远端也在执行前持久保存 unknown 与输入摘要，完成后原子替换文件。同一幂等键只读回原记录，执行期限到期不会让原写入重新获准。合并请求直接拒绝。每分钟任务数默认不超过主机上的上限。

同一状态文件由独占文件锁串行保护，防止并发 SSH 进程各自执行同一任务或覆盖状态；当前实际并发为一，不把主机登记的 `maxConcurrent` 当已实现的并发数。进程崩溃后保留锁，状态/取消请求仍只读，不能靠锁超时重做未知操作。需在核实原进程和副作用后由运维解除残留锁；文件损坏明确失败，不初始化空记录。临时 SSH 私钥与 known_hosts 使用系统临时目录，准备失败及会话关闭均删除本次目录。

子任务不会因为主机在线就报成功。执行器只运行主机自己的模型命令，任务里不能另外带命令。配置文件是 `/etc/personal-agent-runner/model-command.json`，安装脚本在文件不存在时写入空命令，不会覆盖已有文件：

```json
{"command":["/usr/local/bin/your-agent","--once"],"timeoutMs":120000}
```

`command` 是可执行文件和参数，不用 shell。目标文字从标准输入送进去，最长 8000 字。命令配置超时默认 120 秒，范围 1 秒到 10 分钟，但实际执行同时受本次提交的原 deadline 限制；宿主单次最多 60 秒。进程环境只有 `PATH`、`HOME`、`LANG`、`LC_ALL`、`USER`、`TMPDIR`，不带执行器令牌，也不带 GitHub 凭据。退出码 0 才是成功，摘要是标准输出。非零退出保留失败；取消或超时不能证明远端副作用停止，因此保留 unknown，均不改到本地再跑一遍。`command` 为空或文件不存在时回执是 `needs-config`，状态是失败，父任务改在本地执行并写明「远端主机没有配置模型命令」。

没有健康主机、心跳过期或会话准备失败且未调用 `exec` 时，`submit` 才能记 `location: "local"` 和原因。调用 `exec` 后的异常、丢失/错绑回执、取消或期限到达一律保留原主机 unknown，不能重试 SSH、换主机或本地重做。回执必须匹配原 jobId、幂等键与 kind。异步子任务允许本地执行时仍走原 worker，并说明原因。值班轮询同样把缺口记成不是“无变化”。机器重新打开后，游标只有在远端声明自己接在本地游标之后才前进；对不上就保持本地游标，避免重复评论。未知写入由 `verifyUnknownWrite` 读回，`redo` 为 false。

`developerDutyRemoteRunner()` 不传服务时仍是无主机 stub。已经登记并启用的主机存在时，桌面默认使用 `createRemoteRunnerService`，不再停在 stub。

## 排障

- 指纹不一致：重新复制服务器公钥，不要改成“跳过检查”。
- SSH 失败：先在本机手动 `ssh -p 端口 用户@地址`。安全组或本机防火墙只需要 22。
- 服务反复重启：看 `systemctl status personal-agent-runner`。`--serve` 才是常驻进程，`--verify` 只打印版本。
- 令牌丢失：服务器上的 token 文件不能从日志恢复。需要重新生成并在本地更新主机，更新同样要确认。
- 日志和审计里不应出现私钥、`ghp_` 或执行器令牌。出现了就是缺陷，不要把那份日志贴到工单。

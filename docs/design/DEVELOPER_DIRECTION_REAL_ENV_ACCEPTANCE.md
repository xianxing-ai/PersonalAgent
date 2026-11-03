# 开发者方向：需要真实环境的验收

目标 profile：`huawei_ict_agentarts`。这里的四项都不能用夹具代替。自检命令只报告缺什么，不访问 GitHub，不投递 webhook，不连接远端，也不弹通知。

```bash
npm run check:developer-real-env
```

缺任何一项时退出码是 2。四项变量都在时退出码是 0，这只表示可以开始下面的步骤，不是真机已经通过。不要把 token 贴到聊天、写进仓库或打进日志。

## 1. 真实 GitHub 写入

需要：

- `GITHUB_TOKEN`：对测试仓库有写评论权限的 token，只放在本机环境变量或受信凭据存储。
- `GITHUB_REPOSITORY`：`owner/name`。
- `GITHUB_TEST_PR`：一个专门用来验收的 PR 号。不要用需要保留的正式 PR。

步骤：

1. 确认自检已经不再把「真实 GitHub 写入」列成缺失。
2. 用桌面里已配置的凭据引用，对 `GITHUB_TEST_PR` 发一条带 `<!-- personal-agent:duty-status -->` 的状态评论。
3. 把同一条评论正文改掉再发一次。预期是更新原来那条，PR 里仍然只有一条状态评论。
4. 删除这条评论。
5. 打开该 PR 的 GitHub 网页，确认评论已不在。

预期输出：网页上先出现一条状态评论，更新后仍是一条，删除后没有这条评论。合并、强推、删分支、发布和改权限即使自主级别已登记，也必须另有人工确认，不能被这次验收自动做掉。

## 2. 公网 webhook

需要：

- `GITHUB_WEBHOOK_URL`：GitHub 能从公网访问到的 `createGitHubWebhookServer` 地址，不能是只有本机才能打开的 `127.0.0.1`。
- `GITHUB_WEBHOOK_SECRET`：与监听器相同的 secret。

步骤：

1. 在测试仓库把 webhook 指到 `GITHUB_WEBHOOK_URL`，内容类型用 JSON，secret 用上面的值。
2. 对同一个 PR head 触发两次 `pull_request` 或 `check_run`。
3. 再推一个新 head，触发一次。

预期输出：同一 delivery 或同一 `repo#number@headSha` 第二次被去重；head 变化后产生一次新的路由。只在 `127.0.0.1` 上用夹具 POST 不算这一项通过。

## 3. 远端机器

需要：

- `REMOTE_RUNNER_HOST`：能 SSH 或按现有 runner 协议到达的机器。
- `REMOTE_RUNNER_REPO`：那台机器上可以 checkout 的仓库路径或 `owner/name`。

步骤：

1. 在那台机器上配置 `sourcePath` 和 `recipes`，把 `executeRepoTask` 交给 `handleRunnerJob`。没有执行器时回执是 `needs-config`，摘要里会写出这四步配置，这不是通过。
2. 投递一条 `repo-task`，`baseSha` 用那台机器上真实存在的 40 位提交，`branch` 用 `agent/` 开头。
3. 读回执里的 `diffSummary`、`testReport` 和 `evidenceLevel`。

预期输出：回执来自那台机器，`verification` 为 `executed`，测试输出能对上那边实际跑的配方。本机 `createLocalRepoExecutor` 的夹具通过不能代替这一项。

## 4. 操作系统通知弹窗

需要：图形桌面会话，以及 `notify-send`。只有 `DISPLAY` 或 `WAYLAND_DISPLAY`、但没有通知程序时，自检仍报告这一项缺失，并且不会弹窗。

步骤：

1. 在这台有图形界面的机器上打开桌面应用。
2. 对已订阅「打断」的仓库发一条失败或需要确认的通知。
3. 看系统是否弹出通知，并看开发者方向时间线。

预期输出：弹出操作系统通知，时间线 `evidenceRef` 以 `desktop:` 开头，而不是 `desktop-inapp:`。系统通知不可用时落到应用内列表，那是回退，不是这一项通过。

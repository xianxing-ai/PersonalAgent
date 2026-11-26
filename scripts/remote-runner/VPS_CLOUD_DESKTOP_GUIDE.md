# VPS 云电脑一键部署与新手使用指南

本指南帮助你把任意一台 Linux VPS（如 Ubuntu / Debian / openEuler，建议 2 核 4G 以上）变成 **PersonalAgent 可操控的“云电脑 + 远端执行器”**：
- 底层复用本仓库已有加密与认证底座：`OpenSSH` + `HMAC-SHA256` 签名 + 防重放 + Windows 本机 `safeStorage` 加密。
- 云端桌面复用高星开源方案 **`linuxserver/docker-webtop`**（内置 Ubuntu XFCE 桌面，通过浏览器免装客户端即可查看和鼠标键盘操作）。

---

## 第一步：在 VPS 上一键安装云电脑与执行器

登录你的 Linux VPS（通常使用 `root` 或带 `sudo` 权限的用户），上传本仓库中的 `scripts/remote-runner/` 目录（或把仓库拉到 VPS），然后运行：

```bash
cd /path/to/PersonalAgent/scripts/remote-runner
sudo sh install-cloud-desktop.sh
```

> 如果你在 Windows 添加主机时不使用 `root`，而是用普通 sudo 用户（例如 `ubuntu`），请带上 `--ssh-user ubuntu`，脚本会自动把该用户加入 `personal-agent-runner` 和 `docker` 组：
> ```bash
> sudo sh install-cloud-desktop.sh --ssh-user ubuntu
> ```

安装脚本会自动完成：
1. 安装 Node.js 并创建 `/usr/bin/node` 软链接，部署 `/opt/personal-agent-runner/remote-runner-service.mjs` 与 `personal-agent-runner` 服务。
2. 安装并启动 Docker。
3. 生成受控策略文件 `/etc/personal-agent-runner/vps-control.json`（只放行白名单可执行程序，禁止模型随意执行破坏性系统命令）。
4. 拉取并启动 `lscr.io/linuxserver/webtop:ubuntu-xfce`（容器名 `personal-agent-webtop`），桌面端口 **仅监听在 VPS 本机回环 `127.0.0.1:3000 / 3001`**，不直接裸露到公网。

安装完成后，在 VPS 查看你的执行器令牌（不要把令牌贴到公开聊天中）：

```bash
sudo cat /etc/personal-agent-runner/token
```

记下 `RUNNER_TOKEN=` 后面的那串 64 位字符。同时确认你的本机 SSH 公钥已写入 VPS 的 `~/.ssh/authorized_keys`。

---

## 第二步：在 Windows PersonalAgent 客户端登记这台 VPS

1. 启动 PersonalAgent 桌面端，打开工作区右侧栏中的 **“VPS 电脑”** 折叠面板，点击 **“刷新主机”**。
2. 点击 **“添加 VPS / 云电脑”** 展开表单：
   - **主机名称**：小写字母/数字/短横线，例如 `my-vps`
   - **VPS IP 或域名**：填写你的 VPS 公网 IP
   - **SSH 端口**：一般保持 `22`
   - **SSH 用户名**：例如 `root` 或 `ubuntu`
   - 点击 **“探测主机公钥”**：客户端会自动运行 `ssh-keyscan` 读取并锁定服务器公钥指纹（防中间人劫持）
   - **SSH 私钥**：粘贴本机对应的 OpenSSH 私钥（例如 `C:\Users\<你的用户名>\.ssh\id_ed25519` 的内容）
   - **执行器令牌 RUNNER_TOKEN**：粘贴第一步中 `RUNNER_TOKEN=` 后面的字符
3. 点击 **“保存并启用 VPS”**。提交后输入框内的私钥与令牌会立即清空，只以加密形式保存在本机安全存储区中，绝不会发送给大模型或显示在界面中。
4. 在列表里分别点击 **“测试连接”** 和 **“云电脑状态”**，看到心跳时间和 `云桌面状态：running` 即表示通道已真实打通。

---

## 第三步：通过对话控制 VPS 与在浏览器看云电脑画面

- **在对话中让助手操作 VPS**：
  - 查询状态（只读）：例如“查看我的 VPS 和云桌面当前运行状态” -> 调用 `runner.vps.status`
  - 受控执行命令（需你每次审批确认 + 本机出机检查）：例如“在 VPS 检查 Node 版本 / 磁盘剩余空间” -> 调用 `runner.vps.exec`
  - 控制云桌面（需你每次审批确认）：启动/重启云桌面或在云桌面里打开网址 -> 调用 `runner.vps.desktop`
- **在自己电脑浏览器里打开可视化的 Linux 云桌面**：
  在 Windows PowerShell 运行：
  ```powershell
  ssh -N -L 3001:127.0.0.1:3001 root@你的VPS公网IP
  ```
  保持该窗口运行，然后在浏览器访问 `https://127.0.0.1:3001`（首次提示自签名证书时选择“高级 -> 继续前往”），即可看到完整可用的 Ubuntu 桌面环境。

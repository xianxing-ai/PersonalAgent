# Windows Laya 安装

同步仓库只包含 SDK/服务接线和此安装入口，不包含模型权重或 Python 虚拟环境。
在装有 **PowerShell 7.2+、64 位 Python 3.12（含 py launcher）** 的 Windows 电脑上，
从 PersonalAgent 仓库根目录执行：

```powershell
pwsh -NoProfile -File scripts/laya/install-windows.ps1
```

脚本自动创建项目内 `.cache/laya/venv`，安装固定的 CPU Python 依赖，并从官方
Hugging Face 下载固定 revision 的五个模型文件（合计约 678 MB，Python 依赖另计）。
代码和安装脚本随 GitHub 仓库同步；模型源为 `convaiinnovations/laya`，不是 GitHub 附件。
文件先下载到独立临时路径，校验大小及 SHA256 后才发布到应用原本会发现的位置。
再次执行会复用已经验证的文件；已有文件校验失败时保留文件并明确报错，不覆盖缓存。
脚本不安装系统 Python、不写系统 site-packages、不读取账号凭据、不改应用配置、不启动模型。

若只是确认已安装内容，运行只读入口：

```powershell
pwsh -NoProfile -File scripts/laya/install-windows.ps1 -VerifyOnly
```

安装完成后，在 PersonalAgent 管理设置中选择「本地 Laya → 启动本地模型」，等待就绪。
应用原有的内存、健康、模型身份和停止门禁继续生效。安装验证不等于模型前向或业务链通过。
源码同步后启动应用前仍按项目要求执行 `npm run build`。

## 固定来源与本次证据

- 模型 revision：`55cf4c4ebb4ebe31b2550e8bdf3bd21b99753851`。
- SDK：`laya[serve]==0.3.20`；Python 3.12；CPU Torch `2.14.0+cpu`。
- 五个文件的字节数与 SHA256 全部固定在脚本内。本机逐文件内容哈希与原下载缓存对象标识一致，未发现权重或模型配置改动；本次没有训练或修改模型。
- 权重 `model.safetensors`：643835514 bytes，SHA256 `9d628fd971b700382ac6f65920a86f149777b2e748e0c955fb3b19695aa8f204`。
- 适用范围：源码 checkout 的 Windows 本地 Laya。不是安装包资源布局、云端部署或自动后台下载的实现。
- 针对性验证入口：`node --test scripts/laya/install-windows.test.mjs`。新电脑完整依赖下载及模型启动仍需在目标电脑实际验证。
- 2026-10-22：安装器回归 8/8 通过、零 skip，覆盖缓存复用、保留异常旧文件、下载校验后发布、失败/中断清理、junction 拒绝及只读验证。首次受限执行无法创建 junction；在独立临时目录的许可执行保留原断言后通过。
- 本机原有环境的 `-VerifyOnly` 实际通过，未加载权重；另从官方固定 revision 真实下载 472-byte `rl_agent_config.json` 并通过大小及 SHA256 校验。没有重新下载完整权重或在新电脑安装全部依赖。

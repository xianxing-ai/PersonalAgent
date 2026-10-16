# MOD-08L：Obsidian 显式安装与真实宿主验收

<!-- current-design-20261013 -->
> 本文按所记版本阅读，API/阶段/验收事实保留。当前依据：[完整主架构](../design/workflow-architecture-20261013/DESIGN.md) · [28功能流程](../design/workflow-architecture-20261013/WORKFLOWS.md) · [连通图](../design/workflow-architecture-20261013/index.html) · [接口状态](../interfaces/CURRENT_INTERFACE_CATALOG.md) · [协作规则](../../CONTRIBUTING.md)。当前实验为本机Laya有限候选判断，资格不足升级原受信teacher，国内执行模型经AgentArts调用；自有ARM64镜像串行编排，架构未最终定型。历史部署方案不覆盖当前决定，模板数量不等于业务验收；旧双人本机阅读不作为现行要求。设计不等于实现；非作者有效Approve和真实检查仍须满足。


- Profile：`huawei_ict_agentarts`；负责人：`goo122`
- 非作者评审：`zemeng` 或其他已登记协作者
- 状态：`review`；作为 [PR #321](https://github.com/zemeng5208/PersonalAgent/pull/321) 的插件修复与验收补充，尚未评审或集成
- 工作树：`.worktrees/goo122-wiki-source-revisions`
- 分支：`codex/goo122-wiki-source-monitor`；基线：PR #321 `1b917cff`
- 拥有目录：`apps/obsidian-plugin/`、`tests/manual/obsidian/`、相关模块文档
- 依赖：MOD-08K 已交付的公开 Knowledge Obsidian 适配器；接口 host-only provisional

## 实现与兼容

真实 Obsidian 不从插件所在目录解析普通相对 `require`；MOD-08K 的旁置
`knowledge-obsidian.cjs` 在实际宿主中产生 `MODULE_NOT_FOUND`。
构建现在将既有公开适配器内联到 `main.js`，只需 main/manifest 两个安装文件。
没有新增依赖、wire capability、数据库迁移、网络监听或授权入口。
回归 Fake 明确拒绝插件旁置模块，以复现真实加载器行为。

安装工具要求明确本机 Vault 绝对路径，固定标准 `.obsidian/plugins/personal-agent-knowledge/`。
默认停用，不修改社区插件启用清单；已有目录、链接、硬链接、网络路径及整盘拒绝。
独占写入产物和 SHA-256 安装回执。中断安装不递归回滚，也不覆盖残留目录。
卸载前预检启用清单、回执、所有文件摘要及额外文件；仅移除未修改的自身文件。
停用仍未落盘时拒绝；修改或额外文件保留。部分卸载可从剩余受信文件继续。
手动安装无回执与自定义配置目录暂不支持自动卸载。

## 真实宿主证据

2026-10-11，使用本机 **Obsidian 1.12.7（installer 1.12.7）** 和官方 CLI。
验收启动前拒绝其他活动 Obsidian 实例；只启动独立 profile，逐次核对合成 Vault 的完整路径。
所有正文、配置和插件操作都位于工作树 `.cache/obsidian-installed-host/`；没有读取或修改
用户原 Vault，没有访问原 Obsidian profile。退出只停止本次启动的进程。

复现入口（显式指定已安装可执行文件）：

```powershell
node tests/manual/obsidian/plugin-installed-host.mjs --executable 'C:\明确的安装目录\Obsidian.exe'
```

- 实际安装默认停用；通过宿主启用并加载；启动时无自动知识连接。
- 实际 Modal 选择 `Allowed` 后检索命中合成笔记；HTML 字符串纯文本展示，生成 img 数 **0**。
- 引用打开到 `Allowed/note.md`；正文变化后旧引用拒绝、下一次查询旧词命中 **0**。
- 撤销关闭全部窗口并清连接；重载后仍未连接；实际停用落盘后卸载成功。
- 无关合成笔记保持原文；云调用尝试 **0**。不使用 Fake Obsidian 宿主。
- 最终日志 `.cache/obsidian-real-host-final.log`；证据
  `.cache/obsidian-installed-host/case-3NCic1/evidence.json`；`plugin-search.png` 已实际查看，
  标题、输入、纯文本摘录和可点击路径完整可读。夹具和截图不入 Git。

初次失败记录保留：CLI 参数顺序、`=>` 输出前缀、restricted-mode 重载等待、
旁置模块加载失败、UI 等待选择器误匹配以及停用配置异步落盘。
按宿主实际行为修正验收脚本，没有改写启用清单或绕过卸载保护。
两组自动测试并行构建曾造成产物竞态，现改为测试前串行构建一次。

## 本地门禁

- 插件自动测试 **7/7**：实际安装保护、拒绝覆盖、停用清单、摘要变化、额外文件、
  无效回执、中断卸载恢复、整盘/网络/链接路径及实际安装包 Fake 生命周期。
- 本轮首次完整 check 使用系统 .NET 10，coding-tools 的 4 项实际 helper 测试和
  Desktop 的 3 项 .NET 8 测试失败；日志 `.cache/obsidian-installed-full-check.log` 保留。
  apphost 明确报告缺少 Microsoft.NETCore.App 8.0，SDK discovery 没有稳定 .NET 8 SDK。
  此环境失败不记为代码通过，也未删除或跳过测试。
- 后续完整门禁仅为测试子进程设置仓库已有 SDK **8.0.425** 与运行时 **8.0.31** 的
  `DOTNET_ROOT`、`DOTNET_ROOT_X64` 与 PATH；不改系统配置或升级项目目标框架。
- SDK 8 重跑其余门禁均通过，仅 Desktop 外置写回工具注册在当前 PowerShell 的中文
  临时路径下失败。单独复现同一原断言后，使用仓库缓存内独立 ASCII TEMP/TMP 通过；
  没有改写原测试或生产 ACL 检查。该环境调整不代表生产 Unicode 路径兼容性已修复，
  Desktop 写回宿主应独立跟进。两次完整 check 的失败日志均保留。
- PR #321 原 head `1b917cff` 的一项 Foundation 首次在已有 Windows Job 孙进程启动
  测试超时，同 head 的另一项成功；失败项 run `38132836012` attempt 2 重跑成功。
  补充提交的当前 head 需等待新的 CI，不沿用旧 head 的通过状态。
- 最终**分段复验**覆盖完整门禁：原 check 中架构、生成类型、构建、类型检查及其余
  工作区通过；用上述 .NET 8/ASCII TEMP 环境重跑 Desktop **717 pass、2 skip、0 fail**，
  再执行被失败中断的根集成 **25/25**。去重后共 **2683 项，2658 pass、25 skip、0 fail**。
  插件 **7/7**，Runtime **447/447**，Knowledge **42 pass/1 skip**。
  此结果不是一次 `npm run check` 的 exit 0；原单次失败与分段恢复均明确保留。
  日志：`.cache/obsidian-installed-full-check-sdk8.log`、`obsidian-desktop-final-tests.log`、
  `obsidian-root-integration.log`；`git diff --check` 及验收脚本语法检查通过。
- 修正后手动安装包 `.cache/personal-agent-knowledge-0.1.0-single-file.zip` 仅含
  main/manifest；自动安装回执由安装命令生成。旧三文件产物仅保留为历史证据。

## 剩余边界

该证据只证明本机插件安装和只读使用。插件到 Desktop Runtime 的受信配对、
逐条确认记忆、整理写入、跨库投影及真实云消费没有因此完成；仍沿用 Desktop 原有
Runtime/Policy 流程。云端验收继续按用户要求暂缓，MOD-08/09 不标 done。

官方依据：[Obsidian CLI](https://obsidian.md/help/cli)。

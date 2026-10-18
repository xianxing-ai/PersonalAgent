# PersonalAgent Knowledge 桌面插件

<!-- architecture-scope-20261013 -->
## 当前架构职责

目标profile：huawei_ict_agentarts。工程责任：MOD-08（goo122）。产品流程：F04、F05；逐节点流程见[WORKFLOWS](../../docs/design/workflow-architecture-20261013/WORKFLOWS.md)，主架构见[DESIGN](../../docs/design/workflow-architecture-20261013/DESIGN.md)，模块接线见[MODULES](../../docs/design/workflow-architecture-20261013/MODULES.md)。

复用Wiki来源、配对引用、正文写入及恢复；检索来源可追溯，不把跨文件/SQLite称为原子事务。

当前实验由本机Laya提供有限候选判断，仅资格验证通过的站点可直接决定；资格不足、不确定或复杂问题升级原受信teacher。国内执行模型经AgentArts调用，本模块提供实际能力或候选，模型不能代签授权/宣布主任务成功。调用仍经既有公开端口、Runtime/Policy/ToolGateway或ModelGateway；同资源写入、取消、版本、结果未知与Evidence沿用既有语义。模板依赖由自有ARM64镜像串行推进；并行和机会影子尚需实际验收，架构未最终定型。

本轮仅重写架构说明。具体方法/配置/真实证据以当前源码与下面技术参考为准；这些参考的历史阶段不覆盖[当前接口状态](../../docs/interfaces/CURRENT_INTERFACE_CATALOG.md)，也不证明新责任/语音/影子接线已经完成。

## 现有API、运行说明与历史验证参考
<!-- /architecture-scope-20261013 -->

Competition Profile 的本机只读辅助入口。使用既有 `@personal-agent/knowledge/obsidian`
端口；无网络、模型调用、长期记忆保存或写入权限。

## 构建和安装

根目录 `npm run build` 会构建依赖及插件；产物在 `apps/obsidian-plugin/dist/`。
适配器打包在 `main.js` 内，宿主只需 `main.js`、`manifest.json`。安装命令：

```powershell
npm run install:vault --workspace=@personal-agent/obsidian-plugin -- --vault 'D:\明确选择的Vault'
```

仅支持本机既有目录、标准 `.obsidian` 配置。安装到
`.obsidian/plugins/personal-agent-knowledge/`，生成文件摘要回执，默认停用；
之后在 Obsidian 社区插件设置中启用。仓库构建不修改用户 Vault。
已有同名目录拒绝覆盖；目录链接、硬链接、整盘、网络路径拒绝。
升级先停用并卸载旧版本，安装中断的无回执目录保留供核对。

卸载前在 Obsidian 停用插件并等待配置落盘，建议关闭 Obsidian，然后运行：

```powershell
npm run uninstall:vault --workspace=@personal-agent/obsidian-plugin -- --vault 'D:\明确选择的Vault'
```

只清除与安装回执一致的本插件文件；存在修改、其他文件、无效回执或仍启用时拒绝。
不递归删除目录、不改笔记和其他插件，不编辑启用清单。手动复制的安装缺少本工具回执，
不能由此命令卸载；自定义 Obsidian 配置目录当前不支持。

通过命令面板运行“连接本机文件夹”，输入当前 Vault 内的文件夹；输入 `/` 明确选择
全库。连接只存当前会话，重新启动必须重新选择。“检索本机知识库”显示可点击的路径和
行号，打开前重新核验内容摘要；变化后要求重新检索。笔记内容只作为文本展示。
“清除本机临时索引”和“撤销知识库连接”可随时使用；卸载会关闭窗口、取消读取并清缓存。

单库 1000 文件、每文件 512 KiB、总正文 8 MiB；超限或读取失败拒绝整次查询。
每次查询仍重新读取受限来源，临时索引不提供离线旧正文回退。

## 验证与边界

`npm run test --workspace=@personal-agent/obsidian-plugin` 加载实际独立安装包和显式
Fake Vault API，验证无自动读取、作用域、检索、引用变化与撤销，并验证实际文件安装保护。
完整 root check 包含构建与此测试。真实 Obsidian **1.12.7** 的隔离合成 Vault 验收已通过：
实际安装/启用、Modal 选择与检索、纯文本摘录、版本拒绝、重载、停用和卸载。
详见 [MOD-08L](../../docs/modules/MOD-08L-OBSIDIAN-INSTALLATION-01.md)。
新增 [MOD-08M](../../docs/modules/MOD-08M-UNICODE-PAIRING-01.md) 的 host-only
`createRuntimePairingPeer()`，供可信桥接在已连接文件夹上获得只读会话；它不签发工具授权。
Runtime 仍须核对本机物理 Vault 并经原生确认。撤销文件夹/卸载会中止 peer，重新连接需要
新的会话。后续 [MOD-08N](../../docs/modules/MOD-08N-AUTHENTICATED-BRIDGE-01.md) 增加
TLS 指纹/一次性密钥桥接与 Desktop 专用原生配对窗口，仍 provisional。
整理写入和逐条确认记忆继续使用 Desktop 原有 Runtime/Policy 和原生确认。

## 配对 Desktop Runtime

1. 插件连接当前 Vault 的允许文件夹；运行“配对 Desktop Runtime”。
2. Desktop 管理后台 → 记忆 → 知识源，选择并启用同一个物理 Vault，再点“配对 Obsidian”。
3. 将插件一次性配对码粘贴到专用密码窗口，在原生确认中核对 Vault、文件夹和只读范围。
4. 现有本机知识检索通过 Runtime/Policy 访问插件；配对恒为私人，只读，最多 15 分钟。

配对码 2 分钟失效，复制会进入本机剪贴板，请勿发送到聊天/云端；不写入日志、配置或数据库。
关闭码展示窗口不会撤销已发出的连接，使用“撤销 Desktop 配对”或“撤销知识库连接”立即撤销。
断连、卸载、换源、超时与进程重启后必须重新生成配对码。Desktop 插件模式断连/重启不会自动
使用文件源；显式“撤销配对并返回文件源”才恢复所选文件源。文件源后台监视在插件模式暂停。
版本 2 配对后，私人记忆页面使用插件摘录并核对本机稳定页版本；每条保存/
更正仍需原生确认，撤回和删除沿用现有协调。重启仍可管理已保存记忆，验证来源需要重新配对。
配对不允许整理笔记、自动保存摘录或发送云端。此认证不等于插件发布者签名。
PA2 需要同时更新 Desktop 和插件；新 Desktop 接受旧 PA1 的检索，但旧连接无引用确认能力。
方案见 [ADR-0021](../../docs/adr/0021-paired-citation-memory.md)，接口仍 provisional。

双进程合成验收（要求没有其他 Obsidian 实例，使用隔离配置）：

```powershell
node tests/manual/obsidian/plugin-installed-host.mjs --executable 'D:\软件\Obsidian\Obsidian.exe' --dual-process
```

真实 Obsidian/Electron 与自动化原生确认的 Fake 决策分别记录；此验收不调用云服务。

官方依据：[插件构建/安装](https://docs.obsidian.md/Plugins/Getting%20started/Build%20a%20plugin)、
[Manifest](https://docs.obsidian.md/Reference/Manifest)。

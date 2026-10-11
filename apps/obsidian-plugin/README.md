# PersonalAgent Knowledge 桌面插件

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
仍没有插件到 Runtime 的受信配对。
整理写入和逐条确认记忆继续使用 Desktop 原有 Runtime/Policy 和原生确认。

官方依据：[插件构建/安装](https://docs.obsidian.md/Plugins/Getting%20started/Build%20a%20plugin)、
[Manifest](https://docs.obsidian.md/Reference/Manifest)。

# PersonalAgent Knowledge 桌面插件

Competition Profile 的本机只读辅助入口。使用既有 `@personal-agent/knowledge/obsidian`
端口；无网络、模型调用、长期记忆保存或写入权限。

## 构建和安装

根目录 `npm run build` 会构建依赖及插件；产物在 `apps/obsidian-plugin/dist/`。
将 `main.js`、`manifest.json`、`knowledge-obsidian.cjs` 一起放入选定 Vault 的
`.obsidian/plugins/personal-agent-knowledge/`，再在 Obsidian 社区插件设置中启用。
插件没有自动启用脚本；仓库构建不修改用户 Vault。

通过命令面板运行“连接本机文件夹”，输入当前 Vault 内的文件夹；输入 `/` 明确选择
全库。连接只存当前会话，重新启动必须重新选择。“检索本机知识库”显示可点击的路径和
行号，打开前重新核验内容摘要；变化后要求重新检索。笔记内容只作为文本展示。
“清除本机临时索引”和“撤销知识库连接”可随时使用；卸载会关闭窗口、取消读取并清缓存。

单库 1000 文件、每文件 512 KiB、总正文 8 MiB；超限或读取失败拒绝整次查询。
每次查询仍重新读取受限来源，临时索引不提供离线旧正文回退。

## 验证与边界

`npm run test --workspace=@personal-agent/obsidian-plugin` 加载实际独立安装包和显式
Fake Vault API，验证无自动读取、作用域、检索、引用变化与撤销。完整 root check 包含
构建与此测试。当前没有真实 Obsidian 宿主验收，也没有插件到 Runtime 的受信配对。
整理写入和逐条确认记忆继续使用 Desktop 原有 Runtime/Policy 和原生确认。

官方依据：[插件构建/安装](https://docs.obsidian.md/Plugins/Getting%20started/Build%20a%20plugin)、
[Manifest](https://docs.obsidian.md/Reference/Manifest)。

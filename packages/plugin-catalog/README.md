# 插件目录

目标 profile：`huawei_ict_agentarts`。工程责任：MOD-30（zemeng5208）。接口状态：`provisional`。

这个包是插件和技能的精选目录，不是第二套安装器，也不是任务库。它只调用已有公开入口：

- Skill 使用 `@personal-agent/skills` 的 `readLocalSkillDirectory` 和 `openLocalSkillStore`。安装默认停用，不下载目录，不执行其中的脚本。
- MCP 只核验 `@personal-agent/mcp` 已经导出的 `MCP_FILESYSTEM_PACKAGE_VERSION`，并核对 `@modelcontextprotocol/server-filesystem@2026.8.31` 的 `dist/index.js`。安装不启动服务器，不注册上游的写工具，也不写入 Desktop 的远程 MCP 注册表。
- 高风险启用把目录里的权限声明交给注入的 `PolicyPort.authorize`。本包不调用 `grant`，不能自己签发授权。

直接依赖 `@modelcontextprotocol/server-filesystem@2026.8.31` 只为解析已经被 MCP 包钉死的同一版本。没有新增网络安装器。

## 公开入口

```ts
import {createPluginCatalogService, CURATED_PLUGINS} from '@personal-agent/plugin-catalog';

const catalog = createPluginCatalogService({
  skillStoreFile: '/trusted/skills.json',
  installationFile: '/trusted/plugin-installations.json',
  policy: existingPolicyPort,
});
catalog.search('context7');
catalog.planInstall('skill.anthropic.frontend-design');
```

`installPinned` 从清单里的固定 commit 或 npm 地址下载，摘要不符或下载失败就拒绝，然后才调用现有安装器。`install` 仍接受测试或宿主已经放在本机的目录。两种安装成功都只表示快照已核对并默认停用。没有下载针的一键条目不能走 `installPinned`。

启用高风险条目时，授权的 `toolName` 固定为 `plugin-catalog.enable`，`argumentsDigest` 为 `pluginEnableArgumentsDigest(id, sha256)`。摘要字符串是 `{"id":"<id>","sha256":"<64 hex>"}` 的 SHA-256。低风险说明型技能不消耗授权；写文件、联网写入和执行代码仍不能靠技能正文获得许可。

可选 `onActivity` 在安装、启用、停用或卸载成功后收到插件 id、动作、风险和代次。不传技能正文或参数。活动时间线由 Desktop 消费这份通知，目录本身不保存时间线。

每个条目有 `permissionManifest`，分别声明网络主机、插件数据相对路径、连接器标识和密钥名。空数组表示不授予该类权限。当前精选目录的清单都是空的，因为这些条目没有被承认的运行时网络、文件、连接器或密钥访问。安装确认只出现一次，文案由 `pluginInstallSummary` 生成，并附带这四句白话。确认后的清单写入安装记录。运行时以安装记录和当前目录的交集为准，目录后来新增的权限不会自动生效，安装记录里多写的权限也不会生效。

`createPluginSandbox` 是这个交集的执行边界。未安装、未启用或不在目录中的插件不能访问。网络只允许清单里的 https 主机，重定向不跟随。文件只允许插件数据目录中的已声明相对路径，拒绝 `..`、盘符、UNC 和符号链接。连接器只返回允许或拒绝，不调用连接器实现。未声明的密钥不会读到密钥存储；声明过的密钥值只留在主进程，不写入违规日志。违规追加到有界的本地日志。

## 目录

录取条目、许可证、commit、版本和 sha256 写在 `src/plugins.ts`。标准和复审流程见 [MOD-30 插件目录录取说明](../../docs/modules/MOD-30-PLUGIN-CATALOG-ADMISSION-20261111.md)。

## 验证

先构建 contracts、policy、mcp 和 skills，再构建本包并运行 `npm test --workspace=@personal-agent/plugin-catalog`。测试不访问 GitHub、npm 或托管 MCP 端点。

## 限制

Desktop 管理后台在启动已安装技能时创建插件目录宿主，安装确认走原来的授权卡，preload 的 `pluginAccess` 调用 `plugin.guard`。远程 Context7、Cloudflare 文档 MCP 和 GitHub MCP 只有来源针，没有当前目录摘要，不能安装。真实第三方握手、工具调用和 AgentArts 读回都不在本包的验收范围内。沙箱不启动插件脚本，也不把安装器自己的固定地址下载算作插件网络权限。

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

`install` 成功只表示本机快照或包摘要通过，并且记录为停用。`oneClickInstall: false` 的条目返回 `UNSUPPORTED_CAPABILITY`。没有 commit、版本和 sha256 的清单必须是 `pin.state: 'unpinned'`，并且不能一键安装。

启用高风险条目时，授权的 `toolName` 固定为 `plugin-catalog.enable`，`argumentsDigest` 为 `pluginEnableArgumentsDigest(id, sha256)`。摘要字符串是 `{"id":"<id>","sha256":"<64 hex>"}` 的 SHA-256。低风险说明型技能不消耗授权；写文件、联网写入和执行代码仍不能靠技能正文获得许可。

## 目录

录取条目、许可证、commit、版本和 sha256 写在 `src/plugins.ts`。标准和复审流程见 [MOD-30 插件目录录取说明](../../docs/modules/MOD-30-PLUGIN-CATALOG-ADMISSION-20261111.md)。

## 验证

先构建 contracts、policy、mcp 和 skills，再构建本包并运行 `npm test --workspace=@personal-agent/plugin-catalog`。测试不访问 GitHub、npm 或托管 MCP 端点。

## 限制

目录浏览没有接到 Desktop。远程 Context7、Cloudflare 文档 MCP 和 GitHub MCP 只有来源针，没有当前目录摘要，不能安装。真实第三方握手、工具调用和 AgentArts 读回都不在本包的验收范围内。

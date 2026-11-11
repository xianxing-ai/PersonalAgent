# MOD-30 插件精选目录（2026-11-11）

- Profile：`huawei_ict_agentarts`。
- 工作树：`/agent/repos/PersonalAgent`，分支 `cursor/plugin-catalog-mod30-ccef`，基线 `838e5ef2`。
- 负责人：zemeng5208。状态：`review`。接口：`provisional`。
- 范围：新增 `packages/plugin-catalog`。没有修改 Runtime、Policy、`packages/mcp`、`packages/skills` 的既有实现，没有修改 Desktop renderer，没有修改业务连接器，没有改动 MOD-19。

## 行为

精选目录提供浏览、搜索、详情、安装计划、安装、启停、更新检查和卸载。Skill 安装调用现有 `readLocalSkillDirectory` 与 `openLocalSkillStore.install`，结果默认停用。MCP 安装只接受与 `MCP_FILESYSTEM_PACKAGE_VERSION` 相同的 `@modelcontextprotocol/server-filesystem@2026.8.31`，并核对 `dist/index.js` 的 sha256。摘要不一致时拒绝。安装不启动子进程，不执行技能目录里的脚本，不把上游写工具注册进 Host。

高风险条目启用时调用注入的 `PolicyPort.authorize`。工具名是 `plugin-catalog.enable`，参数摘要绑定插件 id 和 sha256。本包不调用 `grant`。

## 边界

根 `package.json` 的 build 脚本加入本 workspace，使 `npm run build` 能编译新包。`package-lock.json` 只应增加这个 workspace 对既有依赖的引用。`@modelcontextprotocol/server-filesystem@2026.8.31` 已在锁文件中，新增直接依赖是为了从本包解析同一个钉死包。

没有新增 wire capability，没有数据库迁移，没有把目录接到 Desktop。远程 MCP 仍由现有只读 Host 和 Desktop 注册表负责；本目录不能在缺少目录摘要时调用 `createRemoteReadonlyMcpHost` 把它们装成可执行工具。

## 验证

环境：Node v24.15.0，npm 11.12.1。本轮测试没有访问 GitHub、npm 或托管 MCP。

- `npm run build`：退出码 0。
- `npm run check:architecture`：退出码 0，3 通过。
- `npm test --workspace=@personal-agent/plugin-catalog`：退出码 0，8 通过、0 失败、0 跳过。覆盖清单校验、目录针、浏览搜索、技能安装默认停用、篡改目录被拒、脚本文件不被执行、高风险启用缺少授权时保持停用、Policy 授权一次后可启用、filesystem 入口被改写时拒绝安装。
- 维护者在本机用 `readLocalSkillDirectory` 重算了 commit `2c5958ec` 的三份技能目录，摘要与目录中的 sha256 一致。这个对照使用了临时下载的上游文件，没有放进仓库，也不是默认测试的一部分。
- 已安装的 `@modelcontextprotocol/server-filesystem@2026.8.31` 的 `dist/index.js` sha256 与目录针一致；其 tarball sha512 与锁文件 integrity 一致。

## 未验证

- 没有重新握手 Context7 或 Cloudflare 文档 MCP，没有发起 tools/call。
- 没有用真实 Anthropic 技能目录走通正向安装；正向安装由夹具摘要覆盖，生产针只做拒绝不匹配目录。
- 没有 Desktop、Runtime Application 或 AgentArts 调用。因此不能把本包写成 MOD-30 已完成，也不能把目录条目写成 frozen。

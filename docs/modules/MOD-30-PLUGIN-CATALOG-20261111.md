# MOD-30 插件精选目录（2026-11-11）

- Profile：`huawei_ict_agentarts`。
- 工作树：`/agent/repos/PersonalAgent`，分支 `cursor/plugin-catalog-mod30-ccef`，基线 `838e5ef2`。
- 负责人：zemeng5208。状态：`review`。接口：`provisional`。
- 范围：新增 `packages/plugin-catalog`。没有修改 Runtime、Policy、`packages/mcp`、`packages/skills` 的既有实现，没有修改 Desktop renderer，没有修改业务连接器，没有改动 MOD-19。

## 行为

精选目录提供浏览、搜索、详情、安装计划、安装、启停、更新检查和卸载。可一键安装的条目从固定 commit 或 npm 包地址下载，摘要不符或下载失败即拒绝，然后再交给现有安装器。Skill 仍调用 `readLocalSkillDirectory` 与 `openLocalSkillStore.install`，结果默认停用。MCP 仍只接受 `MCP_FILESYSTEM_PACKAGE_VERSION` 对应的 filesystem `2026.8.31`，并同时核对下载包与本机入口 sha256。安装不启动子进程，不执行技能目录里的脚本。

`pdf` 的完整目录 sha256 已补上，并且能通过现有 1 MiB 安装器；启用因为它带有脚本而需要 Policy 授权。`docx`、`pptx`、`xlsx` 也补了目录 sha256，但分别是 1138571、1149051、1112769 字节，现有安装器拒绝超过 1 MiB 的快照，所以不能一键安装。

高风险启用由 Desktop 在用户确认后调用 `AuthorizationPolicy.grant`，再由目录调用 `PolicyPort.authorize`。工具名是 `plugin-catalog.enable`。目录本身不调用 `grant`。已启用插件通过 `projectEnabledPlugins` 生成 `pending` 提案，并用现有 `assertSkillReadbackReceipt` 与 `planMcpSkillReadbackAcceptance` 读回；`closedLoop` 保持 false，不把提案写成云端已执行。

Desktop 管理后台的「插件」页在原有「本机 Skills」上方增加插件市场。界面只保留搜索、分类、折叠详情，以及当前状态对应的一个主动作（安装、启用、停用、更新、卸载）。没有统计面板、星标、刷新、安装计划或云端同步按钮。详情里只显示许可证、来源、风险和权限声明。

## 界面删减

- 不把安装计划、更新检查、云端同步做成单独按钮；计划和更新状态附在条目上，启用后自动形成待读回提案。
- 不重复「安装本机 Skill」。市场只下载目录针，本机文件夹安装仍留在原来的本机 Skills 区。
- 未安装时不显示启用、停用、卸载；已安装时不显示安装。不能一键安装的条目只保留原因，没有按钮。

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

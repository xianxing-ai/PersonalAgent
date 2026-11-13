# MOD-30 插件权限清单与运行时沙箱（2026-11-11）

- Profile：`huawei_ict_agentarts`。
- 模块：MOD-30。负责人：zemeng5208。
- 实现：`packages/plugin-catalog` 的 `permissionManifest` 与 `createPluginSandbox`，Desktop 启动路径里的插件宿主、preload `pluginAccess` 和管理后台插件卡片。
- 状态：`review`。接口：`provisional`。
- 没有修改 `apps/runtime`、Policy 核心、`packages/mcp`、`packages/skills`、业务连接器或 MOD-19。高风险启用仍把原有 scope 交给已注入的 `PolicyPort.authorize`。

## 已有能力

PR #632 已提供精选目录、固定版本安装、默认停用、高风险启用授权，以及管理后台里的搜索、分类和单个主动作。权限说明当时只是 `permissionDeclarations` 的文字，安装确认不展示可执行范围，运行时也没有按声明拦截网络、文件、连接器或密钥。

## 本次行为

每个插件清单增加 `permissionManifest`，显式列出网络主机、插件数据相对路径、连接器标识和密钥名。空数组表示不授予。当前精选条目保持空清单，因为它们没有被承认的运行时访问；测试夹具才声明具体范围。

安装或更新沿用原来的一次授权确认。确认文案包含四句白话，不超过授权卡的 512 字限制。取消则不写安装记录。低风险插件启用不再为同一份清单追加确认；原本的高风险启用授权保持不变。

运行时只使用安装记录与当前目录的交集。目录后来新增的权限要重新安装确认才生效；安装记录被改宽的权限也不会超过目录。未启用插件不能使用清单。网络只接受清单内的 https 主机，不跟随重定向。文件只写在该插件数据目录的已声明相对路径下，拒绝父目录、盘符、UNC 和符号链接。连接器只给出允许或拒绝，不进入连接器实现。未声明密钥不会读取密钥存储。违规写入本地有界日志，日志和 preload 返回值都不含密钥值。

安装器下载固定 commit 或 npm 包仍由目录宿主发起，不算插件自己的网络权限。沙箱不执行插件脚本。

## 接线

- 启动：`initializeInstalledSkills` 创建插件宿主时传入 `plugin-data` 与 `plugin-sandbox-violations.json`。
- IPC：管理后台原有 `plugin.*` 通道增加 `plugin.guard`。preload `desktop.pluginAccess` 只转发这个动作。
- 界面：插件卡片显示四句白话；发生拦截时多一行「已拦截未声明的…」。没有新增按钮。
- 主进程另有 `fetchWithinGrant`、`readPluginFile` 和 `readGrantedSecret`，供宿主内调用。密钥值不到达 Renderer。

## 限制

当前精选插件没有运行时授权，因此正式安装后的沙箱会拒绝网络、文件、连接器和密钥。这不是连接器或 MCP 工具已执行的证据。AgentArts 读回仍保持 `closedLoop: false`。

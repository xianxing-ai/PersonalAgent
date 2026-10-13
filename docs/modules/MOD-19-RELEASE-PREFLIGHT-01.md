# MOD-19-RELEASE-PREFLIGHT-01：Windows 发布前只读检查

<!-- current-design-20261009 -->
> 当前目标与协作规则（2026-10-09）：[完整设计](../design/resident-developer-agent-20261008/DESIGN.md) · [离线阅读/全部 SVG](../design/resident-developer-agent-20261008/index.html) · [两人确认与本机阅读门槛](../reviews/DESIGN_READING_GATE.md)。WSS 主通道、HTTPS 备用；Wiki 记忆由 goo122 接入。goo122 与 Potatos498 均确认后才可按授权合并，禁止强制合并/管理员绕过。设计不等于已实现；本文历史验收与作者记录保留，旧合并规则以当前门槛为准。

> 维护入口（2026-10-07）：项目主要负责人为 zemeng；当前分工以 [模块分工](../../docs/MODULE_ASSIGNMENTS.md) 为准，最新状态见 [ROADMAP](../../docs/ROADMAP.md)。历史日期、作者和验收结论按原记录保留。

## 范围与状态

- Profile：`huawei_ict_agentarts`
- 负责人：zemeng
- 状态：`review`
- 当前交付：确定性、只读的发布准备检查器；不生成、安装、卸载或发布安装包。
- 非完成声明：本首片不代表 MOD-19 完成，也不代表 Desktop 可发布。

## 协作与授权边界

- 用户是项目负责人和授权来源；主对话是 PersonalAgent 工作的唯一指挥入口。
- Sol 仅作为 zemeng 职责范围内的限定实施者，不宣称 Astra 身份，不自行创建代理、侧边栏任务、互派工作或扩大权限。
- Git 作者身份已确认为 `zemeng5208`；`goo122` 是本工作包的非作者评审者。
- 代理或自动化复核只能提供辅助意见，不能代替仓库要求的 goo122 正式批准。

运行方式：

```powershell
node scripts/release/preflight.mjs .
```

参数是待检查的项目根。报告只包含仓库相对路径、固定状态和固定错误码，不返回项目根绝对路径、环境变量、凭据或用户数据。检查器不联网，不执行构建、安装和发布命令，也不读取工作区外文件。

## 当前检查面

检查器静态核对：

1. 根 manifest、`.node-version` 与 Node engine 声明；
2. Desktop manifest、`electron/main.js`、`electron/preload.cjs`、渲染 HTML/JS 及关键引用；
3. Desktop 必要脚本和 Runtime `./application` 公开入口；
4. Desktop 生产依赖闭包中公开 ESM import 对应的构建产物；
5. Electron 精确版本与 lockfile 一致性；
6. Storage 对内置 `node:sqlite` 的依赖，以及打包后 Electron 主进程 SQLite 冒烟仍未验证；
7. 生产打包配置、Windows 打包脚本、安装器定义；
8. 独立安装/启动、升级后数据保留、卸载和 SQLite 打包运行证据。

`nextStep` 仅表示最早可以继续处理的工程步骤：

- `fix_project_structure`：源码入口或 manifest 缺失/非法；
- `run_build`：必要公开构建产物缺失；
- `implement_packaging`：源码与构建产物齐备，但生产打包/安装器尚未声明；
- `perform_release_acceptance`：静态配置齐备，仍须实际生成候选并完成人工/隔离验收。

无论 `nextStep` 为何，当前检查器固定返回 `publishable: false` 和 `releaseStatus: blocked`。文件存在、JSON 可解析、构建产物齐备或旧证据文件存在，都不能独立证明安装包可发布。

## Node、Electron 与 SQLite 边界

仓库固定 Node `24.15.0` / engine `24.15.x`，Desktop 固定 Electron `44.2.0`。当前 Storage 使用 Node 内置 `node:sqlite`，不是独立 npm 原生 SQLite 插件，因此这里没有可由静态检查确认的第三方 `.node` ABI rebuild 结论。

Electron 自带的 Node/V8 运行时与命令行 Node 不是同一可执行环境。正式候选必须在打包后的 Electron 主进程中验证至少一次 SQLite 导入、建库/迁移、写入、读回、关闭与重启读回；静态版本匹配和源码中的 `node:sqlite` 引用不能代替该验收。检查器以固定阻塞项 `PACKAGED_ELECTRON_SQLITE_SMOKE_REQUIRED` 保留这一边界。

## 当前仓库结论

在基线 `72cc76b` 上，Desktop/Runtime 源入口和版本声明存在，但仓库没有生产打包配置、Windows 安装器定义或发布脚本；独立安装/启动、升级保留数据、卸载及打包后 SQLite 运行证据也未提供。干净工作树未预置所有必要 `dist` 文件时，检查器会先报告 `run_build`，但它不会自行执行构建。

因此本首片工作包进入 `review`；检查报告的 `releaseStatus` 仍是 `blocked`。它提供可重复的准备检查与缺口列表，不把“文件存在”升级成“可以发布”。后续是否实施生产打包配置与候选生成由主对话统一指挥；本首片不会自行转入安装器实现。后续若获授权，还须在隔离用户数据目录完成安装、启动、升级、数据保留、卸载和回滚边界验收，发布授权仍是独立门槛。

## 最少验收

本首片只要求：

```powershell
node --check scripts/release/preflight.mjs
node --check scripts/release/preflight.test.mjs
node --test --test-isolation=none scripts/release/preflight.test.mjs
node scripts/release/preflight.mjs .
git diff --check
```

测试使用临时合成目录覆盖：源码/构建产物可进入下一步、缺文件与缺构建产物、非法 manifest/路径不回显，以及旧证据文件存在仍不能给出发布判定。最后一条真实仓库运行只做静态只读检查。

实际验证：定向测试 7/7、两文件语法与差异检查通过；包含 junction 逃逸与畸形 installer target 回归。
基线只读运行返回 pass 16、missing 16、blocked 7、invalid 0，下一步为 `run_build`，
`publishable=false`。没有执行安装、构建、网络或发布操作。路径检查不声称构成对恶意并发
文件替换的操作系统沙箱；该脚本用于受控源码树的发布准备检查。

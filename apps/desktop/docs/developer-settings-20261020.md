# H4 开发宿主产品设置

目标 Profile 为 `huawei_ict_agentarts`。本工作包提供受信 Desktop 设置宿主和独立管理控件，消费原 Workspace、模型宿主、developer deployment、ToolGateway 与出机确认；不新增 Runtime、任务库、调度器或授权层。

当前为接线中的源码增量。H2 拥有 `main.js`、管理页面与通用 Harness 设置装配；H1 拥有 RuntimeApplication 的可信动态工作流读取。本文的端口交接不代表这些调用方已接通或真实服务已验收。

## 受信主进程装配

```js
import {createDeveloperSettingsHost} from './developer-settings-host.js';

const developerSettings = createDeveloperSettingsHost({
  userData: app.getPath('userData'),
  safeStorage,
  readWorkspace: () => codingWorkspace.readDeveloperConfiguration(),
  readModels: () => modelApiHost.snapshot().models,
  onUpdate: publishAdminSnapshot,
});
const developerDeployment = await developerSettings.createDeployment(originalDeveloperOptions);
```

`originalDeveloperOptions` 沿用原 `cacheRootPath`、`readModelGateway`、`confirmExport`、`available` 等可信依赖。缓存目录须提前创建，位于选定工作区外。该路径传给原公开工具工厂只读取描述符，描述符生成不执行 Git、命令或网络操作。描述符提取时使用的拒绝执行占位端口不进入执行代理。实际执行始终调用当前原 deployment 的工具和参数校验。

对返回的 `developerDeployment.host.tools`、`competitionToolAvailability`、`competitionToolExports` 只注册一次；沿用原 `host.bind(application)` 和 `prepareExport(scope)`。保存/停用后不重建 Runtime、不清任务，不重新注册工具。关闭时调用设置宿主的 `close()`。不要同时装配第二个静态 deployment。

固定代理的配置相关枚举保持通用 Schema，当前原工具仍执行精确仓库、路径、recipe 校验；原枚举公开策略与精确载荷出机确认继续生效。任务首次接触代理后钉住设置 revision，不能在同一任务中借用新设置。停用或 Workspace/模型绑定变化使旧源失效。写入已开始后撤销设置，代理返回 `RESULT_UNKNOWN`，沿原 Runtime 核实结果，禁止重放或将撤销当作回滚。

绑定通过已有 `host.bind(application)` 消费原 Runtime 的 `getTask/listTasks/loadCheckpoint/saveCheckpointOnce`。原任务 checkpoint `desktop-developer-settings-binding-v1` 仅保存 `{version:1, revision}`，不保存凭据、任务正文或第二份任务记录；首次准入先原子保存并精确读回，存储失败或不一致均拒绝执行。相同 revision 的任务绑定可跨设置宿主重启保持；更换设置后原 revision 不可重绑。

首次 bind 捕获原 `listTasks({limit:1}).snapshotSequence`，重复 bind 同一 application 不重置边界。缺 checkpoint 的任务只在明确证明启动后创建时才能首次绑定：按该任务原 conversationId 对固定启动快照分页查找，最多 10 页、每页 100 项；找到即拒绝，全部读完未找到才允许，页预算耗尽或响应异常也拒绝。已有精确 checkpoint 不扫描历史。旧版没有 marker 的既存任务在重启后保守 unavailable，需创建新任务；历史超过扫描预算时，尚未绑定的新任务也可能被保守拒绝。此限制不通过扩大权限或推测 updatedAt/任务 revision 放行。无 context 的可信配置预览保持原行为。

设置密文继续使用原 version 1 与同步临时文件/rename 原子保存，没有数据库或密文格式迁移；绑定存储复用原 Runtime checkpoint。配置停用与宿主关闭不删除原持久绑定，也不把旧任务变成新任务。

H1 的可信动态工作流 resolver 读取：

```js
context => developerSettings.readDeveloperWorkflows(context)
```

`context` 必须包含原 `taskId` 与取消信号，不能由模型输入提供。返回的是当前原 deployment 的 `runtimeOptions.developerWorkflows`，失效返回 `undefined`。固定代理的 `host.runtimeOptions` 有意不缓存旧工作流；H1 将 resolver 接入原工作流消费者，保持每次执行前原授权和 source 检查。

## 管理 UI / IPC 接线

H2 在现有受信 admin/mainFrame 白名单内接线以下 IPC，拒绝其他页面与未知字段；不要暴露给普通对话、AgentArts 或 renderer 的任意 Node 能力。

| IPC | 主进程调用 | 结果 |
| --- | --- | --- |
| `developer.settings.read` | `developerSettings.snapshot()` | 安全管理快照 |
| `developer.settings.configure` | `await developerSettings.configure(input)` | 保存后快照 |
| `developer.settings.toggle` | `await developerSettings.setEnabled({enabled})` | 当前启停快照 |

`configure` 输入为 `{enabled, configuration, token?}`。`configuration` 使用原 version 1 GitHub/Git/workflows 字段，但不接受 `workspaceRoot`、`github.tokenFile`；Workspace 根由当前原宿主注入。首次须提供 token，留空只保留已保存凭据。工作流 modelId/configurationRef 必须选自原模型宿主已启用绑定；步骤与 token 预算沿原 Schema，用户明确填写。

管理快照仅投影仓库与非敏感配置、选定 Workspace/recipe、模型 id/configurationRef、启停状态和能力可用性，不包含 token、模型 API Key 或 opaque provider。不得把整个快照并入云端对话；云端状态继续使用 `projectDeveloperConversationStatus(developerDeployment.snapshot())`。

```js
import {mountDeveloperControls} from '../features/admin/developer-controls.js';
const controls = mountDeveloperControls(developerSettingsContainer, invoke);
controls.render(adminSnapshot.developerSettings);
controls.showSettings(developerSettingsPageVisible);
// 关闭管理视图时：controls.close();
```

H2 负责实际导航、挂载、快照更新与生命周期。控件只临时收集用户输入的 GitHub token，提交前清空密码框，隐藏/关闭时再次清空；不使用 localStorage。保存配置不授权真实账号操作，也不调用真实模型。开启原工作流不保证其模型、出机、任务授权或平台能力可用。

## 保存与兼容

新产品配置保存为 userData 内 `developer-settings.json` 的 version 1 密文信封，全部配置及 token 使用注入的原 Electron safeStorage 加密，原子 rename 后切换配置源。加密不可用或读取失败明确报告，不回退明文。未读入/迁移任何真实旧凭据，也不自动读取 `PA_DEVELOPER_CONFIG_FILE`。

原 `createDesktopDeveloperDeployment({configPath,...})` 文件模式保持兼容；新 `configurationSource` 仅供可信主进程，用同一原校验逻辑验证内存源，并拒绝同时指定文件模式或内存中的 tokenFile。模型 Key 继续只由原模型宿主管理。此变动不改公共 contracts、数据库迁移、依赖或锁文件，不提升任何接口冻结/云验收等级。

若保存已成功而绑定失败，读回报告已保存但 unavailable；不自动回滚或重试外部写入。旧任务仍保持原 revision 拒绝新绑定，需由原任务恢复/核实流程处理。

## 当前必要检查与缺项

遵循当前先完成源码和调用方、最后统一测试的顺序，仅执行四个源码文件的 Node 语法检查、一个隔离 Fake 测试及 `git diff --check`。

最小用例：`node --test apps/desktop/test/developer-settings-host.test.mjs`，**1/1 通过**。它验证密文信封/快照不含 synthetic 明文 token、代理引用稳定、旧 task revision 失效，以及撤销在途写入返回 `RESULT_UNKNOWN`。safeStorage 与原工厂均为显式注入 Fake；这不证明 Windows 加密、GitHub 凭据、原工厂完整组合或真实工具运行。

未运行依赖安装、构建、全套测试、真实工厂与动态 resolver 的集成检查、实际 renderer 渲染/交互、真实 safeStorage、账号/模型/命令/AgentArts 调用。H2/H1 完成实际端口接线后由主控组织统一验证；这些缺项不能据此标记整个功能或 MOD 完成。

### 原 Runtime 持久绑定修复验证（2026-10-20）

完整 `developer-settings-host.test.mjs` 现为 6/6 通过，使用显式 Fake 原 Runtime checkpoint 接口，覆盖同 revision 重启保留、R1→R2 后旧任务跨重启拒绝、旧版无 marker 任务拒绝/新任务准入、持久写失败与假成功零执行、错误不回显凭据及有界历史预算耗尽拒绝。Desktop typecheck 与 diff 检查通过。未安装依赖、未重建依赖闭包；`developer-deployment-config` 消费集成所需的 Client/Runtime/Cognition 构建产物在该隔离树缺失，未将未运行算作通过。真实 Runtime SQLite 组合、Windows safeStorage 和实际管理调用方仍待对应集成验证；本次不写入 H2/H1 调用方。

## 2026-10-21：设置保存诊断与实际工作区入口（Refs #464 B）

本地目录入口是管理后台「开发 → 环境 / Worktrees」，不是「电脑操控」。开发表单的仓库字段
只填写 GitHub `owner/repo`，不选择本地目录。首次选择目录先保存设置，原工作区绑定需重启后
装配；本次根据原宿主只读状态区分「未选择」与「设置已保存但绑定尚未就绪」，提供相应提示，
不自动重启、不替换原 Runtime，也不豁免工作区、文件范围或任务授权。

原部署验证、设置宿主、Main 私有 IPC 和表单曾依次丢弃校验类别，使多种保存失败呈现同一提示。
现在只由固定目录签发 `DEV_SETTINGS_*` 诊断，带固定中文提示与字段类别。Main 仅在三个
`developer.settings.*` 操作中返回该安全诊断；表单经原 invoke 接收并展示固定文本。未知异常或
伪造的 code/message/diagnostic 一律返回固定 `DEV_SETTINGS_SAVE_FAILED`，不传原异常、堆栈、
文件名、绝对路径或凭据。密钥仍在提交后立即清空，原加密信封版本及原子保存不变。

主要诊断包括工作区未选择／待装配／已变化、允许文件缺失／范围不安全、gh 可执行文件、
仓库与 Git 字段、工作流模型／规则、安全存储不可用及写入失败。未勾选开发工作流仍需有效的
原 GitHub/Git 配置与已有文件清单。报告人的具体失败分支仍未知，不把推测当成现场根因。
普通任务预检误拒的主修复由 [PR #465](https://github.com/xianxing-ai/PersonalAgent/pull/465) 独立负责；
本增量不包含该补丁，也不关闭整个 [Issue #464](https://github.com/xianxing-ai/PersonalAgent/issues/464)。

验证使用该工作树的 Node 24.15.0/npm 11.12.0，锁定依赖安装禁用安装脚本。原设置宿主／repairLinks
表单回归 8/8、新增原 Main IPC → Renderer invoke → 实际
表单 → 原设置与部署验证器组合 5/5 通过；Desktop typecheck、变更 JS/MJS 的语法和 diff 检查通过。
新增组合验证实际文件、硬链接拒绝、加密信封写入与纠正后重试；下游工具提供方和 safeStorage
为显式 Synthetic，无 gh 进程或账号操作。沙箱临时目录的 rename、hardlink 被拒后，夹具改用
项目 ignored cache，并经最小本机测试权限验证硬链接，未放宽生产门禁或跳过断言。

依项目窗口／桥接检查要求，另构建本树 Desktop Main 递归静态导入及其 workspace 依赖闭包
（31 包，未构建无关的 agentarts-runtime／obsidian-plugin），复用已安装的同版 Electron 44.2.0
运行时，使用独立 `PA_USER_DATA_DIR`、`PA_RUNTIME_PROFILE=local`、Fake Runtime 运行原
`npm run test:smoke --workspace=@personal-agent/desktop`。首次在原脚本第 72 行失败：它仍把
无原生能力目录的滑块当作旧步骤预算控件。当前原 `native-reasoning.js` 明确要求无目录时禁用，
且本增量未改该产品规则。仅将原 smoke 的该段更新为严格验证禁用／不可用文本、即使强制派发
input 也不修改对话选择或步骤预算；原 admin 步骤预算可操作断言保留。另运行既有原生能力合法
枚举与不支持／失效模型两项回归，2/2 通过。重跑同一 Electron smoke 通过，含真实窗口、拖动、
Preload IPC、任务提交／取消、后台关闭、主题设置与零 page errors；已查看 panel/admin 截图。

该 Electron 检查证明通用窗口／桥接，未覆盖 Competition 开发表单诊断。后者以上述 13 项组合
回归为依据，safeStorage 及下游工具显式 Synthetic。未运行完整 Runtime／仓库检查、Windows
真实 safeStorage、真实模型、云端或账号验收。没有样式布局、Core wire、数据库迁移、新依赖
或冻结等级变化。Browser 技能未提供，沿用原 Playwright Electron 脚本；未安装浏览器或升级依赖。
本机 ignored 证据：`.cache/developer-settings-diagnostics/smoke-build.log`、
`electron-smoke-ebaf2b46.log`（首次失败）、`electron-smoke-fixed.log`（通过）；截图位于
`apps/desktop/.cache/qa/panel.png` 与 `admin.png`。这些文件不含真实账号数据，不作为云验收。

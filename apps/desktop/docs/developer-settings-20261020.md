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

# 电脑视觉宿主异步生命周期复核（2026-10-26）

目标为 `huawei_ict_agentarts` Competition Profile 的可选 `computer.vision.inspect`。工作树 `<source-worktree>/.worktrees/large-control-20261026`，分支 `codex/large-control-repair-20261026`，基线 `b2fb20dd094743c411656b7e7703c8aae7571a8e`。本轮只检查原视觉宿主、配置宿主和其受信截图读取边界；没有使用真实截图、账号、API Key、模型或用户应用。

## 结论与来源

未复现需要修改视觉生产代码的缺陷。原宿主在 `readArtifact` 返回后、最终元数据读取后、模型返回后均通过原任务状态/期限、配置修订、观察许可和原审批要求复核；配置宿主在出机守卫后再次检查配置、取消和期限，并用独立控制器封住已取消调用。Windows 原生截图读取器核实原 artifact、generation、targetRef/windowRef、target digest、原任务与期限，文件读取中及返回前再次核实；自有浏览器读取器核实 artifact identity、generation、任务、期限和活动上下文。因此目标或窗口代际变化时，下游读取应拒绝原截图。本轮没有修改这些受信读取器，也没有把合成拒绝上升为真实设备结论。

新增的显式 Fake 回归在像素读取等待和模型响应等待两个异步边界分别注入取消、期限到期、配置撤销、关闭：迟到像素没有触发模型调用；模型已经收到的一次请求保留为已发送，但迟到响应没有变成观察结果或可导出的执行提案。配置宿主的 Fake fetch 在**请求已进入传输后**忽略取消并迟到返回，配置轮换、dispose、原调用取消和期限到期均使等待调用拒绝；它不推断真实远端是否已处理请求，也不自动重试。原 `goalVerified:false`、`untrustedObservation:true` 和 Runtime/Policy/ToolGateway 权威边界保持原状。

## 源码绑定与补丁

开始前的哈希和原文件副本在 `.cache/sol-vision-lifecycle-20261026/before-hashes.json` 及 `before/`。唯一代码增量是两个既有测试文件中的三条生命周期回归；精确测试补丁 `.cache/sol-vision-lifecycle-20261026/vision-lifecycle-tests.patch`，SHA-256 `57b1e2f10e650666080924d2e74df7e0b59c02cd1c0f75c8ffcd0017faacb08e`，当前文件上 `git apply --reverse --check` 返回 0。没有生产代码补丁、公共契约、数据库迁移或依赖变化。

| 文件 | 开始前 SHA-256 | 当前 SHA-256 |
| --- | --- | --- |
| `electron/computer-vision-host.js` | `d29fc65b4ee6c6c8d4be404331220a2437fe5b50e109a2e6e4f3e5ff92da4145` | 同左 |
| `electron/computer-vision-config.js` | `148b894cf5de4c51f8eaa2bb165fae59b73f8bf9ee3e2326ab43fa84b4a7e458` | 同左 |
| `test/computer-vision-host.test.mjs` | `8446be088e547a22749b794a625735cf3813b72be96f8d8809cc76ea28aae254` | `6803978e846d470a600f02401709448d6628ee477d77e737e6a28e459bd491c7` |
| `test/computer-vision-config.test.mjs` | `7effbddec98ea34d0edc7753e4b9626c58b6f2b2037ac31156eb1cacec67b015` | `1a3eb99075a95617eb616649e0de8b8f71144582f8e0b17c2aa66e3f5cc0eec4` |

## 检查与限制

固定 Node `<source-worktree>/.cache/toolchains/node-v24.15.0-win-x64/node.exe`：原测试两文件 `27 pass / 0 fail`，日志 `baseline-tests.log`；增加测试后的宿主文件 `15 pass / 0 fail`，日志 `host-lifecycle-tests.log`；配置文件新增迟到 fetch 用例 `1 pass / 0 fail`，日志 `config-late-fetch-tests.log`。计数覆盖不同版本和范围，不相加为完整验收。后两组的 Fake 捕获/模型没有真实设备代际或外部服务副作用；已发送后取消只能拒绝本地结果，不能证明远端未收到或未处理图像。

本轮没有运行大构建、整仓 `npm run check`、Electron/实际桌面、实体设备、云端视觉或长期资源测量。原 E09 有限真实视觉回执属于此前版本，不能替代当前生命周期复验。主集成方负责在单一重型时段核查最终组合。本工作包未提交、未推送、未创建 PR。

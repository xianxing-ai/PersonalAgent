# IMAGE28 本机与真实服务可用性核查（2026-10-31）

目标为 `huawei_ict_agentarts`。本记录仅证明所列探针实际观察，不将环境可用性、Synthetic 测试或历史配置视作 28 图验收。#531 仍须全部接线及真实验收后才能合并。

## 当前设备探针

2026-10-31 09:50:42 UTC，用 Windows `winmm.dll` 的默认设备进行一次有界采样和播放。未保存录音、未发送音频到网络，未改变设备或系统权限设置。

| 项目 | 实际结果 | 证明边界 |
| --- | --- | --- |
| 默认采集 | 1 个设备；open/prepare/addBuffer/start 均返回 0；约半秒获得 9538 字节、非零采样、缓冲完成 | 默认输入驱动可用，不能证明 ASR、说话人或回声抑制 |
| 默认播放 | 1 个设备；open/prepare/write 均返回 0；0.2 秒轻提示音缓冲完成 | 默认输出驱动接受并完成缓冲，未取得真人听感确认 |
| 原设备释放 | stop/reset/unprepare/close 后结束探针进程 | 无持续采集；不能替代产品原麦克风租约与实际关闭读回 |

产品 Live/SIS 真实识别、同一问题回合的播放/最终转写、WinForms 目视与独立真人签名仍未验收。

## AgentArts 配置与实际连接

- 默认 Desktop userData 未发现可直接使用的 AgentArts、邮箱和日历配置。已找到的四份历史 AgentArts 加密配置文件格式可读，但当前 Electron safeStorage 解密失败；原文件未改写。此结论只针对已检查的路径，不代表机器不存在其他配置。
- 随后核实当前用户环境中的网关、Runtime 与 Authorization 均存在。通过现有 `createAgentArtsConfig` 的隔离、无写入读取可得到 `configured=true`、`runtimeReady=true`，HTTPS / Latest；固定 deploymentVersion 和独立镜像 appToken 缺失。没有将凭据写入记录或公开文件。
- 沿 Desktop 现有模型目录读取路径，发送公开常量 `modelCatalogVersion=1.0, action=list`。第一次 HTTP 200 的 SSE 使用 data 内嵌事件；修正探针解析后第二次只读请求仍 HTTP 200，实际事件为 `task_start → error → end`，无正常 `task_end`、无有效模型目录。未请求模型生成、业务工具或重放历史任务；不能据 HTTP 200 声称服务验收成功。
- 第二次读回请求 ID：`c1226715-ef62-4277-b958-f3be61e87c1f`，2026-10-31 10:15:18 UTC。没有伪造固定部署、平台 trace 或真实业务回执。
- 2026-10-31 11:40–11:49 UTC，通过当前已登录控制台只读核实既有 Runtime：`pa-wiki-accept-1027` 的 `wiki-int` endpoint 绑定 `wiki-int-1028`，镜像为历史 `wiki-integrated-20261028-8d6f601c`；`pa-owned-bindings-0dae0ff5-api` 只有 Latest endpoint，当前版本 `arm64-computer-23161679`。这纠正了“尚未发现任何固定入口”的环境缺口，但均不是本轮 #531 镜像或新模板的部署证据。
- 将隔离探针明确绑定到上述 `wiki-int` 后，用已有本地 Authorization 做一次同网关、只读目录请求，实际 HTTP **401**，无有效目录；请求 ID `b8133465-fc2a-4c3c-8353-7f1d3caf1d8d`，11:49:18 UTC。之前一次探针因目的地未重绑定在本地校验处拒绝，未发出网络请求。未创建访问方式、密钥、部署版本或改变平台配置；当前凭据不能据此认定适用于历史固定入口。

## Windows 原生隔离实际探测

在集成提交 `d5e67c8a` 使用仓库 `build-helper.mjs` 与预装的私有 .NET 8 SDK，在仓库外独立临时目录构建原生宿主成功。普通用户诊断为 `elevated=false`、`administrator=false`；Windows 的 PSEC 导出存在，独立支持查询为 `detected=true, major=1, minor=1, flags=15, enforced=false`。这些仅为加载/支持查询，不证明隔离执行通过。

指定真实 `PA_TEST_JOB_HOST_EXE` 并设置 `PA_TEST_NATIVE_SANDBOX_REQUIRED=1` 后，Windows 原生边界与 Desktop 原授权执行测试共 5 项：2 通过、2 失败、1 非 Windows 条件跳过。两个真实执行用例均失败，基线和隔离探针返回 `native-stop-or-protocol-unconfirmed`；产品任务为 `UNSUPPORTED_CAPABILITY`，未降级执行命令。

进一步用产品同样的清理环境启动诊断，宿主退出码 `2147516566`，明确报告默认 .NET 目录缺少 `Microsoft.NETCore.App 8.0`（默认目录只有 7.0.20 和 10.0.10）。私有 SDK 的 .NET 8.0.31 依靠调用环境中的 `DOTNET_ROOT`，产品子进程不继承该值。因此本机当前 **生产原生隔离不可用**；不能把构建成功、API 存在或先前跳过的测试算作通过。本次未安装全局运行时、修改系统策略或放宽隔离/授权检查。

构建、只读诊断及强制测试日志在集成树 `.cache/pr531-native-*`。同一集成提交另已通过实际 Electron **Local Profile** Runtime Application smoke（7 次本地 Synthetic 模型请求、2 次取消）；该结果不代替原生隔离、真实 AgentArts 或完整 28 图验收。

## 尚需完成

需要可用的固定 IMAGE28 部署与独立入站令牌、原平台 trace/评估读回，以及明确授权的邮箱、日历、feeds 和受限 GitHub 工作区。独立真人审核签名与电脑关闭后云端持续运行证据尚无。本次未关闭用户电脑，也未把本机运行替代关机后验收。

本机详细探针与脱敏 JSON 保留在根工作树忽略目录 `.cache/pr-repair/`；源码接线、局部测试与最终整合检查由各工作包记录，接口冻结等级不变。

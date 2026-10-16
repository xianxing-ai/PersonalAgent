# 自有 V4 镜像：真实 AgentArts F15 整图验收

2026-10-16，Competition Profile。**固定公开鹈鹕动画缺陷的 F15 主图和独立隔离图已真实通过；不代表其余 27 图完成。**

## 上传与部署

- SWR：`swr.cn-southwest-2.myhuaweicloud.com/zemeng5208-personal-agent/personal-agent-owned:workflow-v4-e38ef23d`。
- ARM64 索引摘要：`sha256:58c6fc1c8be1dbb14a0a2aae1140a1058d3a8126eb487d541145e8e956f9929d`；远端独立 inspect 已核验架构与摘要。
- 镜像实际构建源码为 `e38ef23dfc5ac5cd59728bb40299e0784f203cae`。上传时工作树 HEAD 为 `09d369a8b5fad79c1eb8f5f48da7b077bc122d93`；本次没有重建。`swr-release.json.sourceRevision` 是上传检查时的 HEAD，不能冒充镜像构建源码。
- AgentArts Runtime：`pa-owned-bindings-0dae0ff5-api`，ID `9a65747e-05f0-475c-a2dc-f24dd3ed87ae`；正式受测版本 **`arm64-v4-e38ef23d-r2`**。
- 平台页面独立读回该版本到上述镜像 tag 的映射，保留旧版本；2000mCPU/8192MiB、8080、原委托、入站 API Key、原模型代理与日志配置保留。新版本内运行标签也已对齐。
- 这是平台配置映射与远端镜像摘要的组合证据；**没有容器内摘要自省**。原报告 `requestedVersionVerified:false` 如实保留，不靠修改自报字段制造平台验证。
- `cloud-catalog.json` 是精确版本的真实 HTTP200 读回：28 图/185 节点，111 host + 41 guard 要求。目录不等于这些宿主均已安装，更不等于业务整图通过。

来源：[上传回执](swr-release.json)、[推送输出](swr-push.txt)、[远端摘要](swr-remote-inspect.txt)、[平台配置读回](platform-configuration.txt)、[平台版本截图](platform-version.png)、[来源说明](provenance.json)。

## 真正的整图入口与通过门槛

执行 `tests/manual/agentarts/pelican-repair-live.mjs`，从受信宿主 stdin 读取配置；云端每次请求均指定 `?endpoint=arm64-v4-e38ef23d-r2`，不使用 Latest，不直连 MaaS。

1. 云端 `workflowVersion:1.0.0/advance` 准备当前节点候选并推进原检查点。
2. 本地原 TaskRuntime/Policy/ToolGateway 执行已注册的选择和工具，生成绑定原参数/身份的回执；随后由云端下一次 advance 消费。
3. 逐一核验 F15_N01—N06 全部 completed；原业务工具实际读取、预览、应用、测试和交付都必须存在，未决提案/unavailable 不能放行。
4. 原父任务 succeeded，原审批、ToolGateway 记录、缓存结果、签名回执、Evidence 和最终文件 SHA256 均一致；关闭数据库后再重开核验。
5. 主图与隔离图拥有不同任务、会话、operation、文件根和授权；原始基线相同，影子结束后主产物哈希不变。两支都通过才总通过。

`testVersion:1/model_turn` 在这里仅作已有 Adaptive selector 的教师调用，不代替任何 F15 节点或 advance。Laya 仍使用本机 CUDA、Torch 线程 1；资格函数明确为 false，**12 次都升级教师**，本测试没有授予 Laya 全局决策资格。

专项测试 22/22（含缺节点、缺 advance、缺原 Evidence、不终结、SQLite 重开和实际 Windows 单次 CAS 的负例/正例）；独立代理只读复核了最终两个 SQLite 库和产物，未重跑模型。历史执行 Evidence 的 `conditional` 标签保留，不能宣传成 20 条 `verified` Evidence。

共享消费者回归另跑37/37、0跳过：原孙悟空、F20、委派、业务 fixture 与鹈鹕 checker；使用显式现有 Python，无云请求，见 [回归日志](shared-harness-regression.txt)。没有因手工 harness/文档改动再次重建已验生产镜像。

## 实测结果与耗时

| 阶段 | 实测 |
| --- | ---: |
| 外层启动至退出 | 198.967s |
| 报告开始至结束 | 197.871s |
| 本机 Laya 启动 | 19.201s |
| 主图：13 次 advance、10 个原操作 | 91.136s |
| 独立隔离图：13 次 advance、10 个原操作 | 84.288s |
| 两图串行合计，含各自审批/工具开销 | 175.437s |
| 12 次 Laya 选择墙时 | 214.292—654.409ms |

26 次 advance 均 HTTP200 并 returned；两图各有 6 个完成节点、10 个确认操作，20 个回执均被后续 advance 消费。每个重要节点的 UTC、墙时、请求/任务/操作 ID、教师调用和资源读数均保存在 [完整报告](cloud-f15-report.json)，两支原报告见 [main](main/receipt.json) 与 [isolated](isolated/receipt.json)。初始故障是 fixture 中三个动画的 `begin="indefinite"`，不是人工替模型生成补丁。

只删除三处 `begin="indefinite"`，其他字节完全一致。原始 SHA256 `2cb6272bb47cb86f93e74ba0033409644d4890eb060a7a90ffd28af0447d80d8`；两支产物均为 `60459cf294de2bfda7a3bc6676cbf25e626af7aef5ff43cd990e1be065530147`。

平台日志独立读回原 `pelican-b1169d1a-3c4b-4f88-8f28-fdc53a8c030f` 的 started/completed，能对应主图原请求；见 [平台日志](platform-log-readback.json) 和 [截图](platform-logs.png)。这证明该次平台日志可观测，不宣称所有请求均已做平台 Trace API 逐条对账。

报告结束后另在真实 Chrome 打开相同产物，观察两帧中轮辐和脚踏角度变化；见 [播放读回](browser-playback.json)、[第一帧](browser-frame-1.png)、[第二帧](browser-frame-2.png)。因此原报告闭合时的 `browserPlayback:not_yet_observed` 保留为历史状态；浏览器复核是其后的独立证据，仅证明观察到运动，不保证所有动画设计均无问题。

## 150ms、GPU 对照及原失败

[GPU 摘要](gpu/summary.json) 保留全部来源哈希。固定短输入暖态 CUDA 记录 serial P50/P95 为 28.848/41.615ms，串行服务接收的并行请求 P50/P95 为63.137/120.793ms，24 样本均低于150ms。CPU 同输入 serial P50/P95 为1119.820/1589.790ms；CPU FP32 与 CUDA SDK BF16 精度路径不同，不能把此结果称纯设备单变量实验。

CUDA packed 对照阶段原生进程退出 `-1073740791`，报告不完整，原因 unknown；原失败回执随包保留，未宣称 packed 通过。当前 F15 的12次较长上下文全部超过150ms，因此**真实整图的150ms决策目标仍未达成**。

早先 GPU 编码工具链案例是 `testVersion/model_turn`，不属于这次 F15 图：孙悟空主支非法模型提案 JSON 失败、影子通过；鹈鹕主/影子/交付通过。原始失败和成功记录见 `gpu/`，不能把孙悟空写成完成，也不能以这两个工具链案例替代其对应整图验收。

## 当前边界与复现

这是明确手动接线的公开测试 fixture，未证明默认 Desktop 已接齐所有 adapter，未做物理语音、真实用户账号业务操作、CW06 影子资源准入/F22 同次反事实、其余27图或通用自主编码完成。全部缺口仍见 [逐图审计](../../WORKFLOW_COMPLETENESS_AUDIT_20261016.md)。没有改变架构定案或微调模型。

协作者使用仓库手动 runner 和受信 stdin 配置同一精确版本即可复现；入站/内部凭据由各自安全宿主注入，不从本包取得。模型请求会消耗既有云额度，应按各自授权运行。SWR 长期登录已在本机以 DPAPI 与 Docker Desktop 系统凭据库验证；包中不含 AK/SK、口令、DPAPI 文件或数据库。

`public-files.json` 给出本目录除清单自身之外的逐文件 SHA256；原报告和图片字节不做重写或格式化。

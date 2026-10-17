# 第一版可测试镜像与本机接线

> 历史适用范围（2026-10-15 补注）：下文保留原日期、固定版本及当时的测试/失败记录。后续当前模型、本机 Laya、镜像发布与有限验收以 [当前详细设计](../design/CURRENT_DESIGN_20261015.md)、[V3 实测](TEST_IMAGE_V3.md) 及 [协作者接线](COLLABORATOR_WIRING_PACKAGE.md) 为准；历史“当前/未发布/未验/双人批准”等表述不覆盖后续事实或现行协作规则。


这是实验测试版，不是最终架构或生产验收。Laya 服务与权重在本机；镜像承载既有 28 工作流模板、185 节点、候选准备、模型角色调用和平台适配。本机继续使用现有 TaskRuntime、Policy、ToolGateway、Evidence。目录和工具注册不能证明 28 条业务链已经跑通。

## 产物与来源

- 目标 Linux ARM64，端口 8080，健康检查 /ping，调用 /invocations。
- 镜像标签 personal-agent:test-v1-local-laya。
- 构建与启动证据在 docs/competition/evidence/test-image-v1-20261015/。
- 本地归档为 .cache/agentarts-image/test-v1-local-laya.tar；用 docker load --input 导入。
- 可复建镜像上下文为 .cache/agentarts-image/test-v1-build-context.zip；本机接线和测试源码包为 .cache/agentarts-image/test-v1-source-20261015.zip（不含凭据、依赖、Python 或权重）。源码包解压后安装/构建仓库依赖，再按本文配置本机测试。
- 以证据中的 Git 基线、未提交源码清单和上下文逐文件 SHA256 为准，不能用 Git HEAD 代替整个工作树。
- 本轮不推送镜像、不替换华为部署，不把本地容器当 AgentArts 实测。

## 构建与启动

使用 Node 24.15.x、npm 11.12.x 和 Docker：

~~~powershell
npm ci
npm run build:owned-agent
node apps/agentarts-runtime/scripts/image-context.mjs
# 填入上一命令输出的 context：
docker build --platform linux/arm64 --tag personal-agent:test-v1-local-laya <context>
docker save --output .cache/agentarts-image/test-v1-local-laya.tar personal-agent:test-v1-local-laya
~~~

生成器只导出 allowlist workspace 及生产依赖，不导出仓库根目录、.env、Python 环境或模型权重。

在本机受保护且 Git 忽略的 .cache/first-test-image.env 中配置实际值，不能把密钥放进 Git 或 Evidence：

~~~dotenv
PA_AGENT_MODEL_BASE_URL=https://api.modelarts-maas.com/openai/v1
PA_AGENT_MODEL=deepseek-v4-flash
PA_AGENT_MODEL_API_KEY=<本机安全注入的 MaaS Key>
PA_AGENT_WSS_AUTH_TOKEN=<至少32字符的随机token>
PA_AGENT_TEST_VERSION=1
~~~

各角色可独立覆盖 PA_AGENT_FAST_*、PA_AGENT_WORLD_*、PA_AGENT_PLAN_*、PA_AGENT_REVIEW_* 的 BASE_URL/MODEL/API_KEY 或 KEY_FILE。自接模型也由可信启动配置提供，调用请求不能自带 URL 或 Key。不支持的原生思考参数不能冒称已启用。

~~~powershell
docker run --detach --name personal-agent-test-v1 --publish 127.0.0.1:44173:8080 --env-file .cache/first-test-image.env personal-agent:test-v1-local-laya
Invoke-RestMethod http://127.0.0.1:44173/ping
~~~

PA_AGENT_TEST_VERSION 默认关闭，仅本测试版设为 1。原 /invocations、WSS、签名 checkpoint、HostBridge 和授权链保留原用途。

## 调用

本机 PA_AGENT_WSS_AUTH_TOKEN 环境变量与镜像内 token 对应：

~~~powershell
$paHeaders=@{'x-pa-agent-token'='Bearer '+$env:PA_AGENT_WSS_AUTH_TOKEN}
$paQuery=@{testVersion=1;operation='capabilities'} | ConvertTo-Json -Compress
Invoke-RestMethod http://127.0.0.1:44173/invocations -Method Post -Headers $paHeaders -ContentType application/json -Body (@{query=$paQuery}|ConvertTo-Json -Compress)
~~~

HTTP 返回事件数组，message.data.text 才是内部 JSON。

| 操作 | 输入 | 实际作用 |
| --- | --- | --- |
| capabilities | testVersion=1, operation=capabilities | 读取真实配置的模型角色、身份及本机边界 |
| model_turn | 加 modelRef、messages，可选 maxOutputTokens | 经 ModelGateway 调用预配置角色，返回身份/用量/耗时，不执行本机工具 |
| 原 catalog/advance | 原 workflowVersion=1.0.0 信封 | 保留全部设计模板和原签名回执续跑通道 |

本测试入口没有绕过 Policy 的命令执行接口。文件、邮件、记忆及工具回执仍由可信本机宿主产生。

## 鹈鹕入口

tests/manual/agentarts/run-pelican-test-version.ps1 提供：镜像模型生成候选 → 本机判断或升级 DeepSeek → 两个独立工作区读文件/补丁/验证/增量修复 → 当前有效结果比较 → 原生产 CAS 补丁工具单次写回。它复用既有 runAgent 与 Runtime 工具任务，不新建产品调度器。

配置示例：

~~~json
{
  "image":{"url":"http://127.0.0.1:44173/invocations","modelRef":"plan","tokenEnv":"PA_AGENT_WSS_AUTH_TOKEN"},
  "localLaya":{"modelPath":"<本机 multilingual 权重目录>","port":44174,"device":"cuda","torchThreads":1},
  "modelRevision":"<实际 checkpoint revision>",
  "python":"<本机 Python 路径>",
  "browserPath":"C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  "powerShellPath":"C:/Program Files/PowerShell/7/pwsh.exe",
  "maxSteps":16,
  "deadline":"<本次原期限 ISO 时间>"
}
~~~

步骤数只是调用示例，不是新增产品上限。CPU 路径按机器显式配置；GPU 依赖使用既有 pythonModulePath 注入，不修改系统 Python。

~~~powershell
pwsh -File tests/manual/agentarts/run-pelican-test-version.ps1 -ConfigPath .cache/pelican-config.json -Live
~~~

入口会产生实际模型费用。模型凭据只在镜像；本机只持有镜像 token。云容器内 127.0.0.1 不代表用户电脑：本入口由本机调用本机 Laya，再沿既有工具/回执端口连接镜像。

本机须具备构建后的 workspace、Laya SDK/权重/Python、Playwright/已安装 Edge。缺依赖明确报错，不自动安装或偷偷回退 Fake。

新判断点没有独立验收时记 unvalidated_decision_site 并交 DeepSeek，结果记 decided_by=deepseek，不反复强迫过同一 Laya 门槛。真实测试/读回证明的完全相同案例可以复用，版本或验证文件变化立即失效。这是经验复用，不是权重训练或证明泛化。

pelican-browser-selftest.mjs 单独使用明确正负夹具检查真实 SMIL 运动。正夹具由测试代码准备，不是 Agent 修复成果；通过此项不能宣称主/影子闭环成功。

## 实际接线边界

- 邮件/研究/通知状态组合见 [本地接线表](TEST_VERSION_LOCAL_WIRING.md)。无账号配置为 unavailable；工具注入不等于分类、通知投递、草稿读回已经完成。
- 任务分派复用 Runtime 既有父子任务、模型配置、工具目录和检查点；主控通知/决定的状态以对应测试证据为准。
- 尚无领域训练，不能宣传 Laya 学会了新任务，不能靠放宽门槛或强行降低升级比例伪造提升。
- 真实 MaaS、GPU、完整动画修复、真实邮箱、平台 Trace/评估和华为部署分别看回执。
- 复用生产 Runtime/模型/工具链、现有 ImapFlow/Nodemailer、OpenAlex、Laya SDK、Playwright，没有另外引入 Agent 框架、邮件后端、记忆库或调度器。

## 手工测试包与实验限制

下列是离线接口/实际本机文件及 SQLite 行为测试，模型使用显式 Fake，不计入真实 MaaS 或 Laya 质量验收：

~~~powershell
node --test --test-isolation=none tests/manual/agentarts/pelican-test-version.test.mjs tests/manual/agentarts/test-version-business.test.mjs tests/manual/agentarts/test-version-delegation.test.mjs
~~~

任务分派适配在 test-version-delegation.mjs，复用 createRuntimeSubagentDispatchTool，主控与子任务通过持久父子绑定读实际状态、Evidence 和报告。childTools 注入子任务原工具范围，parentTools 注入主任务原工具范围；模型由原 getModelGateway 提供。通知报告、请求模型主控建议和请求用户授权是不同概念，模型建议不能签发权限。尚未据此声称所有桌面/语音消费端已接通。

HTTP model_turn 是无持久幂等记录的文本模型请求，同一个请求重发会重新调用模型；断线/超时不能盲重试。WSS 仍保留既有有界传输去重，业务状态与结果核实仍归本机 TaskRuntime。maxOutputTokens 由调用方显式提供或交实际 Provider 默认处理，测试入口没有冒称统一模型预算已配置。

本机 adaptive selector 已写 intent 但未取得完成回执时，同 requestId 保守返回 RESULT_UNKNOWN，不能冒充已核实恢复或重新执行。当前还没有该模型意图的自动核实接口。复核候选 owned-review 或显式 abstainIds 即使出现在已验证站点也必须升级；初始化失败会释放已启动的本机服务。

构建证据保留全量 check 与后续局部回归的时间关系；后补两个内部适配修正由 18 项相关测试复验，不将补丁前的全量 check 说成在同一最终快照重复运行过。

## 2026-10-15 真实专项测试

第五轮报告 `.cache/pelican-test-version-5WrrrR/report.json` 已达到 `verified_main_shadow_and_delivery`，脱敏汇总见 [live-test-results.json](evidence/test-image-v1-20261015/live-test-results.json)。本轮沿本地 ARM64 镜像 `/invocations` 调用真实 MaaS `deepseek-v4-flash`，本机 GPU Laya 与现有 Runtime/Policy/ToolGateway/Evidence、SQLite、编码工具和 Edge SMIL 验证共同执行。未部署华为平台、未发布镜像、架构仍为实验状态。

总耗时 167.886 秒，main 49.251 秒、shadow 37.057 秒。两个隔离分支均先真实观察 `passed=false`，最终结构与实际浏览器运动均 `passed=true`；三个运动部件的矩阵均变化，JS errors 为零、几何保留。主任务均 `succeeded`。两个合格结果比较后，shadow 的已验证 SHA `60459cf294de2bfda7a3bc6676cbf25e626af7aef5ff43cd990e1be065530147` 经一次原 CAS apply 写回受控 user-workspace 夹具，未触碰用户原工作区。13 条已确认工具任务为读取 2、预览 2、分支/交付 apply 3、验证 6；初始及最终 Evidence 引用见汇总。

真实 MaaS 成功返回 15 次：候选规划 1、升级裁决 3、分支执行 11，累计调用墙钟 143.406 秒。Provider 报告用量为输入 49,580、输出 8,406、合计 57,986 tokens；这不是费用账单。main 曾真实返回缺 `kind` 的提案，经严格拒绝反馈后，模型下一轮补全合法提案并最终通过，并非只有离线纠错夹具。

本机 Laya 为 CUDA、bf16、Torch intraop 线程 1；三次输入为 2,315/2,262/1,840 tokens，端到端为 305.80/163.46/223.84 ms，均未达到 150 ms。三处未验收判断站点都以 `unvalidated_decision_site` 升级，由 DeepSeek 实际裁决；随后完全相同且有文件/Evidence 读回的案例复用 1 次 `verified_experience`。本轮证明本机真实调用与该专项链闭环，未证明 Laya 独立裁决质量、泛化能力或新训练成果。

资源为测试进程树的实际 PID 采样，Node 最大采样 RSS 350,326,784 bytes，主要 Python 进程最大采样 RSS 1,744,351,232 bytes，进程峰值计数 2,788,319,232 bytes；OS 线程峰值分别 18/12，不能把 Torch intraop=1 说成进程只有一个线程。未采 GPU 显存、未做同任务 Codex 公平对照，不能宣称资源相同或更省。

前四轮原报告仍保留：`s6w6zY`（真实错误最初被断言遮蔽）、`IJrmdT`（模型 version 字段/歧义预览反馈问题）、`TLWsdA`（缺恢复 binding 被拒）、`fp0OVx`（main 非法 JSON，shadow 真实成功且单次交付，整体 partial）。它们不是第五轮全通过结果，也未被覆盖。

恢复端口绑定真实 root/recovery/pwsh 身份，并核验新测试 recovery 受保护 ACL；本轮审批只覆盖明确授权的隔离公开夹具。没有据此证明所有崩溃恢复场景、28 条业务链、真实邮箱/通知/语音或平台 Trace/评估完成。

被测文件 SHA 与报告/启动/资源文件 SHA 均列于脱敏汇总。第五轮发生在后补 `maxTokens` 预算保护之前，运行未传该参数；之后的预算回归与最终全仓检查分别记录，不能称同一最终源码哈希已重跑真实模型。测试 host 改动位于镜像 allowlist 外，镜像 ID 与 tar SHA 保持原值，不重新构建。

最终 `npm run check` exit 0，37 个 TAP 汇总共 3,166 tests：3,148 pass、18 skipped、0 fail、0 cancelled。日志 `.cache/test-version-final-check.log` SHA256 `57ac0b767372faa97a4466c5963d47be9022ec30182648c4979b6f595d05fd00`。最终手工包为 22/22（鹈鹕 11、业务 4、分派 7），日志 `.cache/test-version-final-manual-check.log` SHA256 `cab382ba4d621f675187968b41e215092c7812585645a8b4bef6055ff6e4cace`，真实模型调用 0；预算模块 25 项是受影响子集，不另行加总。

后补预算保护后的 agents 源码 SHA 为 `7266ddf8f4685e4cfe231fe87fd13ddcf89fc94ec00e90f1affdf030d275660b`，dist SHA 为 `6d4aa128461b058ec288fe8804d02a7a92af06b707ddb7a5824fd10cc18eb7b5`；真实第五轮所用旧 SHA 单独保留于汇总，未对最终 agents SHA 再调用真实模型。协调者将立即更新源码 ZIP；更新前 test-kit 旧 sourceZip 哈希仅为历史产物。

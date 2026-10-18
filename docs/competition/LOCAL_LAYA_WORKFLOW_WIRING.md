# 本机 Laya 与镜像工作流接线

> 2026-10-16 当前生成清单为152项（111 host、41 guard），旧148为历史数量。
> [实物完整性审计](WORKFLOW_COMPLETENESS_AUDIT_20261016.md)明确图/引擎、节点接口注册与真实整图三种状态；
> 早期孙悟空/鹈鹕工具循环不走F15 advance，不能据此宣布所有图完成。
> 后续已真实上传V4并在AgentArts精确版本完成固定鹈鹕F15主/独立隔离整图，见[云端证据](evidence/cloud-f15-v4-20261016/README.md)；其余27图仍待验，完整输入150ms仍未达。

## 当前接线与真实边界（2026-10-15）

各MOD负责人自己完成实现、公开契约、实际调用方接线、必要测试、Evidence及文档；新具体分工见 [接线总包](COLLABORATOR_WIRING_PACKAGE.md)，逐MOD输入输出/调用方/命令/缺口见 [全MOD清单](../modules/CURRENT_MOD_WIRING_HANDOFF.md)。根composition协调共享入口，不替全部模块代接代验。

最新 [完整实测](evidence/test-image-v3-20261015/full-workflow-results.json) 与 [发布回执](evidence/test-image-v3-20261015/owned-release.json) 已证明ARM64镜像上传SWR、云精确版本目录与日志读回，以及同版镜像本机Docker+本机Runtime/Laya+AgentArts新代理的孙悟空/鹈鹕主影子和单次CAS，共41条Evidence。不是远端Runtime两条全链，不是28真实业务全部通过；各分支父succeeded，协调锚点created。鹈鹕首次partial失败保留。

本机Laya完整输入182–618ms未达150ms，未校准站点均实际升级DeepSeek；本轮主影子串行，日常机会/收益开关仍需真实消费验证。DeepSeek经AA代理，底层平台MaaS来源如实记录，无客户端直接fallback；语音百炼沿用公开端口，SIS经AA流式桥仍未验。新增接口仍provisional，缺provider能力unavailable；不改变Core wire冻结范围。

下文按原轮次保留具体接口/试验记录；其中“未发布”“模型未跑”“主影子未通过”只适用于其早期阶段，当前事实以上述回执为准。旧fixture不能扩展为真实账号、物理设备或平台服务验收。


> 历史阶段说明（2026-10-15）：以下两行保留当时“先测试，再决定架构”的原记录；2026-10-17 Owner 已确定本机 Laya 方案。外部参赛资格和真实验收仍须另核。
> Owner 最新要求：先测试，再决定架构。本文及现有代码仅描述实验候选实现，未据此确认最终架构；
> 本轮不提交架构定稿、不发布镜像，保留原始结果供选择。

早期实现目标：`huawei_ict_agentarts`，工作分支 `codex/laya-owned-runtime`。原“镜像暂不发布”已被后续Owner授权与SWR实际回执更新。
Owner 当前决定为 **本机 Laya + 镜像内 28 工作流 + 串行推进**。不以历史镜像内嵌 Laya 的记录代表本版。

## 协作者先读哪里

[完整机器可读接线清单](workflow-wiring.json)包含 28 项功能的全部节点、输入、输出、依赖、
条件、资源、能力需求、工具名称及宿主适配器。它从生产模板生成，不是另一个手写流程副本。
当前清单中的 152 个宿主/条件条目（111 host、41 guard）是可追踪的节点绑定，不是 152 套独立业务实现；
协作者按 capability 复用既有宿主和连接器，只在声明的节点入口绑定准确 Schema。

镜像保留原图的全部节点、依赖、条件、恢复边、模型分工、selected 汇合标记，以及各功能的
summary、decisionPoints、designNotes 和 acceptance。模型分工是设计意图，实际模型及原生思考深度
仍由可信配置和已发布 ModelGateway 能力决定；保留一个模型名字不等于该厂商接入已经验证。
`npm run check:workflows --workspace=@personal-agent/agentarts` 核对生产数据与原图的完整投影。
catalog 的 `designCoverage` 返回投影 SHA256、模板版本和逐图摘要，可与接线清单比对，不能用它声明业务通过。

根目录执行 `node scripts/agentarts/export-workflow-wiring.mjs` 重新导出。
先执行 `npm run build:owned-agent`，使用仓库指定 Node/npm 版本。

## 真实调用顺序

1. 本地受信宿主启动一个 Laya 实例，只监听 `127.0.0.1`，随机 Bearer，不转发端口。
2. 将 `createWorkflowDecisionTool({selector})` 注册到现有 Runtime Application。
3. 本地将经过权限过滤的 `{name, version, inputSchema}` 目录发给镜像的 workflow advance。
4. 镜像制备原候选并封入 checkpoint，发出 `decision.choose_candidate` 提案。
5. 本地使用 `OwnedWorkflowHostBridge.submit()`；原 Policy/ToolGateway 产生执行记录和 Evidence。
6. `readReceipt()` 取得已确认结果，带原 checkpoint 发回镜像。`selectedId` 必须属于原封存候选。
7. 镜像根据选择发出业务工具提案；本地真实执行，再交回业务回执。模型选择不代替授权。
8. 宿主读写、条件检查采用相同通道。重复读取原 operation 不重复执行；未知结果先核实。

所有流程状态归本地 TaskRuntime；镜像 `settled` 是图状态，不自行宣称本地任务成功。
最终还需检查输出、工具 Evidence 和实际读回。`unknown`、`unavailable` 不作为完成。

本机组合可直接导入 `@personal-agent/agentarts-runtime/local-laya` 的
`createLocalWorkflowDecisionHost({python,modelPath,port,device,torchThreads,pythonModulePath,signal,onDecision})`。
它返回 `{tool, snapshot, stop}`；将 tool 注入现有 Runtime Application，主流程和影子共享该实例。
随机内部 Bearer 不返回 UI。由组合宿主管理启动和停止，不在后台重复拉起模型或切换到云端判断。

隔离影子使用 `mode:'isolated'` 和来源版本 snapshot，主机同时提供 HostBridge.assertIsolation，
核实 taskId 实际绑定到独立文件根、恢复目录、Runtime 状态和相应凭据。
单独传 namespace 不授予隔离权限；没有该真实宿主时不执行。主/影子 operationId 包含命名空间，
签名绑定完整 proposal；不能把影子判断或执行回执用于主流程。

## 四类接口

| 接口 | 输入 | 输出 | 实现方 |
| --- | --- | --- | --- |
| `decision.choose_candidate` 1.0.0 | context、候选 id/description、requestId；deadline/signal 由 Runtime 注入 | `{selectedId}` | zemeng，本机 Laya |
| 已有业务工具 | 原公开 inputSchema | 原生产工具 outputSchema / Evidence | 按 MODULE_ASSIGNMENTS，复用现有实现 |
| `workflow.host.fXX_nXX` 1.0.0 | 该节点候选中的 arguments；接线方提供准确 Schema | 节点要求的真实宿主结果 | 知识/记忆 goo122；业务连接器 Potatos498；桌面/语音/架构 zemeng |
| `workflow.guard.fXX_nXX` 1.0.0 | workflowId、nodeId、input、predecessorOutputs、predecessorStates | `{state:'selected'|'skipped'|'unknown'}` | 该条件的真实来源宿主 |

`createOwnedWorkflowAdapter()` 帮助生成与图节点一致的工具描述、校验与执行包装。
接线方必须提供真实 execute、准确输入输出 Schema、requiredScopes 和实际 sideEffect。
read 节点只能注册 read；write 节点按实际选择 local_write 或 external_write，仍由原 Policy 控制。
没有真实观测的 guard 返回 unknown；没有实现的 adapter 不注册。封装函数不会自动安装 MCP、
创建知识库、消费用户授权或生成平台 Trace。平台/自制 MCP 与 Skill 仍经现有宿主端口接线。

## 镜像启动

```
npm run build:owned-agent
npm run image:context --workspace=@personal-agent/agentarts-runtime
docker build --platform linux/arm64 -t personal-agent:local-laya-serial <上一步返回的context>
```

构建不需要权重、Python wheels、API Key。镜像运行时由受信宿主设置：

- `PA_AGENT_HOST_MODE=agentarts`、`PA_AGENT_LAYA_MODE=local`（Dockerfile 已设）；
- `PA_AGENT_MODEL_BASE_URL`、`PA_AGENT_MODEL`、模型凭据：沿用既有国内 MaaS/ModelGateway 配置；
- `PA_AGENT_WSS_AUTH_TOKEN` 与独立的 receipt/checkpoint 密钥，沿用现有安全注入方式；
- 本地 HostBridge 与镜像必须使用对应 receipt key。密钥不得进入网页、模型提示或 Git。

端口仍为 8080，`/ping`、`/invocations`、`/ws` 不变。
catalog query 为 `{"workflowVersion":"1.0.0","operation":"catalog"}`，返回全部工作流及 adapterRequirements；
指定 workflowId 可只读该图。协作者按选中工作流公布目录，不把所有无关工具塞入一个任务。
当前模板版本为 `2026.10.15.2`；增加设计语义字段后摘要随版本变化，旧 checkpoint 不在新版重放。

本地验证可用 `standalone-validation`；它不是 AgentArts 失败后的自动回退。
`tests/manual/agentarts/owned-workflow-live.mjs` 读取 stdin 配置，新增 localLaya：
`{python, modelPath, port, torchThreads, device, pythonModulePath}`。全部是可信本机配置，不发云端。
CPU/GPU 选择必须和实际依赖相符，不能把缺少 CUDA 自动伪装为 GPU 成功。

## 延迟验收

`tests/manual/agentarts/local-laya-benchmark.mjs` 使用公开固定输入测试本机实际配置：
串行、并发提交、显式合批；输出原始样本与 P50/P95，冷启动单列。
150 ms 指完整 warm 本地 selector/HTTP/模型判断目标，不包括云端候选生成与业务工具执行。
不能把四项总耗时除四后冒充每项可见延迟，也不以缓存命中代替真实推理。

输入配置通过 stdin：`{python,modelPath,port,threads:[2,4,6,8],rounds:5,device:'cpu'}`；
GPU 实测使用 `device:'cuda'` 和已安装 CUDA Torch 的独立 pythonModulePath。
本轮不人为设置云端 CPU/内存配额。性能通过与模型语义质量通过分别验收。

当前 CPU 默认仍为两线程；八线程仅属历史对照，不设为生产默认。
低占用路径优先测试本机 GPU、一至两个 CPU 计算线程，不复制多份模型争抢资源。
GPU 的默认 CPU 计算线程为一；进程中用于驱动、I/O 的空闲系统线程单独统计，不能混作 CPU 计算占用。
CUDA 路径保留原权重，但 SDK 默认启用 BF16 autocast，不能称为 FP32 计算；
authenticated health 和本地 snapshot 分别报告实际设备、线程配置与 autocast 状态。

F15/F20 已给出明确源文件路径时，代码直接绑定已发布 reader Schema，省去一轮通用模型制备；
仍交给本机 Laya 选择，不把参数绑定冒充模型成功。源文件读取阶段的判断不重复携带下游完整 SVG、
补丁 Schema 和初始检查正文，而保留其摘要引用及完整原输入绑定；生成与检查补丁时保留原始资料。
这不是截断模型输入或用摘要替换必须阅读的源码。

`tests/manual/agentarts/pelican-repair-live.mjs` 使用同一故障 SVG 分别运行完整 F15 主图和隔离影子：
首次确认动画未启动，随后真实读取、模型生成增量补丁、本地 Laya 判断、实际预览/应用、
检查、读回和持久化 Evidence。全部输出限制在新建的公开测试目录，主/影子分别保存回执。
结构检查与浏览器真实播放分开记录，未观察播放时不能把字段或截图当作动画已运行。

## 2026-10-15 本轮真实结果

[脱敏证据](evidence/local-laya-workflows-20261015.json)记录了以下彼此独立的结论：

- 当前 `npm run check` 退出码 0：3,137 项测试，3,119 通过、18 跳过、0 失败。
  Python 28 项在与全仓检查同时运行时出现 2 项时序失败；未改变断言，等全仓检查结束后单独重跑，28 项全部通过。
  这说明存在负载下的时序敏感性，不能把单独通过解释为高负载鲁棒性已经证明。

- 本机 ARM64 容器实际生产入口 `/ping` 为 200，逐图调用 `/invocations` 读回 28 图、185 节点、148 个接线条目。
  这次仅目录验证，不调用真实模型或业务工具，不作为华为部署证据。镜像未发布。
- 鹈鹕主图与隔离影子均在 F15_N01 被 Laya 选为 review，首次故障 SVG 保持原样。
  原完整上下文的两次判断为 211 / 286 ms；源读取阶段投影和直接参数绑定后为 146 / 108 ms。
  后一失败路径主图＋影子共 774 ms，不是成功完成修复的延迟，不能据此宣称整个工作流低于 150 ms。
- 更短的读取问题正反／选项换序检查为 4/8；该组 41–92 ms，但始终偏向第二个匿名选项。
  紧凑事实版本仍为 4/8。直接调用未修改的原厂 SDK 时，语义标签会影响选择，但错误路径反例仍未区分；
  stock BF16 autocast 和单独 FP32 对照都未解决该错误。尚不能归结为唯一 SDK 缺陷或宣称基础模型普遍随机。
- 一实例、一个 Torch CPU 计算线程；观察到进程 RSS 约 1.7 GB，峰值约 2.8 GB，
  Torch 显存分配约 1.3 GB，驱动/context 另计。没有同任务的 Codex 资源对照，不能承诺占用一样。

补充的严格同输入对照使用 [公开原始判断输入](../../tests/manual/agentarts/fixtures/pelican-source-read-decision.json)：
2 轮 × 正反／候选换序 4 场景，编码长度 1177–1180 tokens；两边原始输入与权重清单 SHA256 一致。
CPU 两线程 FP32 为 P50 2659 ms、P95/最大 2802 ms；GPU 加一个 CPU 计算线程、SDK 默认 BF16
为 P50 45 ms、P95/最大 115 ms。两边均 4/8，均未通过该窄场景质量检查。
两种配置的精度不同，因此这是实际默认配置比较，不把全部差异归因为硬件。
模型启动分别约 10.2 秒和 12.6 秒，另列且不计入 warm 判断；8 次样本不能作为 P95 SLA。

只复现这个公开判断而不调用 MaaS／业务工具：将
`{"localLaya":{"python":"<本地Python绝对路径>","modelPath":"<multilingual绝对路径>","port":44174,"device":"cpu","torchThreads":2}}`
通过 stdin 传入 `node tests/manual/agentarts/pelican-laya-probes.mjs`。
GPU 对照设置 `device:"cuda"`、`torchThreads:1`，并按本机环境提供独立 CUDA Torch 的 pythonModulePath；
一次仅运行一个实例。不传 sourceRun 时读取上述公开原始输入。

150 ms 目标在上述部分 warm 样本达到，完整工作流及决策质量仍未通过。
不交换候选顺序、覆盖 review 或手工补丁伪造端到端成功；保持 Owner 选择的本机 Laya，
将任务适配/训练与独立质量验收作为明确未完成项，而不是悄悄切换第二决策模型。

重跑实际镜像目录验证：将 `{docker,image,output}` 通过 stdin 交给
`tests/manual/agentarts/local-image-catalog-smoke.mjs`。它启动真实 ARM64 生产入口，
逐图读回并与当前构建的设计摘要比对；只创建并删除自己的临时容器，不发布镜像。

## 已实现与未验收的边界

- 生产图编排、串行暂停恢复、本地判断阶段、外部宿主与条件接口已编码。
- 明确 Fake 的 28 图完整推进回归用于证明接线和状态机，不证明真实业务结果。
- 真实 Laya/MaaS、实际工具与持久化 Evidence 按当次回执记录；不自动替换 review。
- 未接线的邮箱、Wiki、平台知识库/MCP、语音、评估/日志等不因图已存在而标记完成。
- 旧嵌入式 checkpoint 与新执行配置不兼容；在旧版本核实在途任务，禁止换配置重放未知写入。
- SWR/AgentArts 本版发布仍暂停；PR、main 集成、云上运行与本机验收分别报告。

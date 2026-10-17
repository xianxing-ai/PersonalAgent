# PersonalAgent 决策模型核查与训练可行性

核查日期：2026-10-15。研究分支 `codex/architecture-page-revisions`。只读研究与报告交付；该研究阶段没有安装、下载权重、推理、训练、真实 API 调用、提交或发布。此后由主工作包提交本报告，不改变研究阶段的操作范围。没有设计或实现用户暂缓的最小修复算法。外部资料以发布者页面为准，搜索引擎抓取时间不冒充发布日；未验证的账号资格、国内网络和硬件兼容性保留为未知。公开投影以仓库相对路径代替开发机私人前缀。

## 结论

1. 当前 Laya multilingual 322M 属于正确的非英语 checkpoint 类别，但中文覆盖和类型正确不能证明本项目裁决可靠。上游明确承认该 checkpoint 出厂未校准、过度自信；温度校准不能改变 argmax，不能修复现有选择错误。
2. 阿里百炼确有官方 `decision-model-preview` 和北京地域 System One API，并非只有第三方传闻。它是国内托管专用决策候选；账号是否已获访问权限、平台条款、实时可达性和本项目质量尚未验证。文档未建立它与某个 Jev checkpoint 权重相同的证明。
3. Jev 是 TypeSafe 官方托管产品；Kev、Vega 都有名称歧义。已识别真实权重项目、通用模型包装器及不同同名项目，不能用名字直接替换。
4. 保留 Laya 并开展领域微调有上游路径，最先缺的是独立标注与测试集，而非训练命令。当前 0.3.20 不能被当成具备最新训练 CLI 的版本；不建议本轮隐式升级。此报告不决定最终模型与架构。

## 可引用核查矩阵

| 对象 | 已核官方事实 | 国内/华为与部署边界 | 本项目仍未知 |
| --- | --- | --- | --- |
| Laya multilingual | `convaiinnovations/laya-multilingual`，mmBERT-base 322M，Apache-2.0；文本/JSON state 加 choice/score/noul；默认1024、可设8192。模型卡含 zh。英文 root 为421M，typed-decisions 为另一个英文421M checkpoint。[模型卡](https://huggingface.co/convaiinnovations/laya-multilingual/raw/main/README.md) | 可本地自托管；已有本机 CUDA 证据。ARM64 容器可装载不等于 Ascend NPU 已适配。 | 本项目中文裁决质量、校准与150ms目标；没有独立引擎对照。 |
| TypeSafe Jev | 官方 Models 页：Jev1.14.0 于2026-10-14可用，1.13仍列出；`jev-latest`当日仍指1.13，`jev-preview`指1.14。64k/request、32k/question；`/v1/systemone`托管。[Models](https://docs.typesafe.ai/models) | 没有查到官方公开可下载权重或中国大陆地域承诺。国外服务不列为本轮优先落地推荐。 | 国内实际可达性、数据区域、账号权限、中文项目质量；厂商速度不是本机速度。 |
| 百炼 decision-model-preview | 官方 API 页更新2026-10-15：choice/noul/score，state 可 String/Object/Array，Bearer DASHSCOPE_API_KEY；北京地址为 `https://{WorkspaceId}.cn-beijing.maas.aliyuncs.com/compatible-mode/v1/systemone`，另有新加坡。[API](https://help.aliyun.com/zh/model-studio/decision-model-api) | 官方北京地域服务是可证国内入口；它仍是外部云调用，不能代替 AgentArts 比赛主编排。 | 当前工作空间是否开通、真实 API 读回、质量和网络尾延迟。协议兼容不证明与 Jev 权重同源。 |
| 百炼模型能力/费用 | 官方模型页更新2026-10-10：65536输入，最大输出0；暂不支持微调/Function Calling/批量推理；北京/新加坡限时免费，1200 RPM、200万TPM。[模型信息](https://help.aliyun.com/en/model-studio/decision-model-preview) | 限时免费不是永久成本承诺；未发现官方公开权重下载。页面的“Structured Outputs不支持”指通用能力表，不否定其专用typed API。 | 账号实际限额及促销时效以控制台为准。本轮未开户、未调用。 |
| Kev：jaredpalmer/kev | 真实决策权重家族，0.8B/4B/9B/27B，Qwen3.5/3.8基座；System One接口、choice/noul/score，LoRA与head训练、留出温度校准；项目Apache-2.0。[仓库](https://github.com/jaredpalmer/kev) | 自托管可避免国外API依赖；README有CUDA/MLX路径。不是中国厂商官方产品，也未证实Ascend支持。 | 每个checkpoint许可与revision、中文任务、8GB显存完整输入和并发表现；未下载。 |
| Kev：arjun988/Kev | NotJev:Kev 是通用模型控制层，BYO Ollama/OpenAI兼容后端；作者明确训练为None，智能来自后端。不是上述Kev权重。[仓库](https://github.com/arjun988/Kev) | 可接国内模型，但只是接口/读出策略；不能由System One外形推断单前向或已校准。 | 后端语义可靠性、logprob/约束解码路径与实际端到端耗时。 |
| Vega：NandhaKishorM/vegaml | Laya作者另一项目：冻结Qwen3.5 0.8B/4B＋小engine，choice/score/boolean、拒答与conformal集合；当前接口把noul改名boolean。[仓库](https://github.com/NandhaKishorM/vegaml) | 公开自托管；不是原Laya同一模型或直接兼容替换。没有官方Ascend验收证据。 | 项目中文集、分布漂移下校准、adapter泛化、RTL/CUDA/ARM64等实际适配。作者benchmark不等于项目验收。 |
| Vega：Decision-2.0-Vega-27B | vLLM Semantic Router的另一模型，模型卡Apache-2.0、Qwen3.8-27B adapter；同家族Kai0.6B为Qwen3-0.6B-Base，8192上下文，choice/noul/score。[Vega卡](https://huggingface.co/vllm-sr/Decision-2.0-Vega-27B/raw/main/README.md) [Kai卡](https://huggingface.co/vllm-sr/Decision-2.0-Kai-0.6B) | 可自托管的专用决策候选；中国基座不等于中国厂商提供该决策头。27B不适合直接假定RTX4060单卡可用；Kai可列轻量待测项。 | 中文独立集、同资源延迟、Ascend决策head/内核适配。 |

另有安全厂商 Vega 使用 Jev 的[案例](https://vega.io/blog/jev-closed-up-to-a-third-of-our-triage-agents-alerts)，不是一个可下载的“Vega决策模型”。

## 当前 Laya 的任务匹配与证据边界

本地已读 `docs/competition/evidence/laya-ablation-20261015/README.md`、summary与manifest：592次真实SDK调用是相关样本/变体，不是592个独立业务任务；selector HTTP、raw HTTP、同实例SDK三路输入、编码和答案相同，均4/8。它排除了这组本地路径的映射差异，三路仍共用原SDK，不能进一步归因具体神经层。语义正控7/8表明不能把精确文件名比较失败泛化为所有语义判断失效。冻结边界的新文件名留出仍40/80，不能将探索性阈值当上线校准。

另读实施树 `docs/competition/evidence/test-image-v1-20261015/live-test-results.json`：真实专项主/影子/CAS交付通过，同时明确 `layaAutonomousDecisionQualityVerified=false`、`laya150msTargetPassed=false`、`trainingPerformed=false`；该文件不是AgentArts部署证明。

上游当前模型卡说明multilingual没有拟合温度，置信度系统性偏高；官方报告校准ECE可改善，但这是其数据上的报告，不能套用于本项目。state应是可阅读业务事实，questions含明确instructions和每选项criteria；一请求多个typed问题不是聊天消息序列，也不提供生成推理链。头部与state预算应分别审计，不能仅看总窗口。本地完整窗口对照已经做过，不能继续把当前失败简单归咎默认1024截断。[模型卡](https://huggingface.co/convaiinnovations/laya-multilingual/raw/main/README.md)

中文证据并不只有“100+语言”：上游纳入的Feishu式中文诊断为64个人工智能辅助合成场景，旧revision的multilingual choice20/64；其作者明确不是独立盲标或当前main评分。另有18条中文短指令诊断，choice与四noul路径出现不同结果。这些说明语言覆盖不能推出每种问题形态可靠，也不能代替本项目独立集。[中文工作场景](https://github.com/NandhaKishorM/laya/blob/main/research/benchmarks/feishu_zh/README.md) [短命令](https://github.com/NandhaKishorM/laya/blob/main/research/benchmarks/zh_short_commands/README.md)

## 国内替代的可证范围

最接近原语的国内托管候选是上述百炼专用决策API。可本地运行的专用候选是Laya、Kev权重、vegaml及Decision2系列；“国产Qwen基座”不等于整个项目有华为认证或国内权重镜像。

通用API可保留盘古、DeepSeek、千问作为不同性质的比较候选：

- 华为官方有盘古文本对话的OpenAI式V2入口；但查到的“结构化数据预测”是特征表回归/分类，不是自由文本typed决策模型，不能拿它冒充Jev替代。[华为API参考](https://support.huaweicloud.com/api-pangulm/pangulm_05_0104.html)
- 华为官方Ascend-vLLM最佳实践列出Qwen3-8B/32B与reasoning解析器，证明特定通用模型有华为适配资料；不能外推到Kev/vegaml/Decision2自定义head与算子。[华为指导](https://support.huaweicloud.com/bestpractice-modelarts/modelarts_llm_infer_5910024.html)
- 千问官方提供JSON Object/JSON Schema输出。它是生成式输出约束；语法/类型符合不能证明语义正确或置信度已校准。[千问结构化输出](https://help.aliyun.com/zh/model-studio/qwen-structured-output)
- DeepSeek官方JSON Output及Responses API文档列出JSON与Schema模式；这也是通用模型API，不是“不生成文本的专用决策权重”。本项目已存在的真实DeepSeek链与新候选质量评测应分开记录。[JSON](https://api-docs.deepseek.com/guides/json_mode/) [Responses](https://api-docs.deepseek.com/api/create-response/)

本轮没有证明某个国内通用API在相同请求/网络下比Laya更快或更准，没有更换provider。

## 保留 Laya 时的训练与校准可行性

上游最新文档有JSONL `{state,questions,expected}` 硬标签或 `{state,questions,gold}` 软分布，也有CSV分类入口；完整微调和冻结encoder只训head两条路径。`laya-train`是较新版本功能，single-device脚本也晚于本机0.3.20；版本升级须另作兼容性验证，不能从最新文档推断本机已有。[训练文档](https://raw.githubusercontent.com/NandhaKishorM/laya/main/docs/finetune.md) [发布记录](https://github.com/NandhaKishorM/laya/releases)

| 层次 | 实际改变 | 成本与前置条件 | 能证明什么 |
| --- | --- | --- | --- |
| 经验复用 | 将已核实案例/事实摘要放入后续输入或检索结果，不改权重 | 需要脱敏、来源、适用范围、过期与冲突规则；增加token与检索开销 | 可能改善上下文，不等于模型已学习；每次仍需评测 |
| 温度/拒答校准 | 拟合概率或风险门槛，不改encoder/head | 必须独立校准集，不能复用测试集调门槛；覆盖问题类型、选项数量、语言与任务分布 | 温度缩放保持argmax；可改变可信覆盖率，不能凭空提升准确率 |
| 仅head训练 | 冻结encoder，训练决策head | 显存/计算较低；仍需标签、训练版本与独立测试 | 是真实权重训练；上游提醒收益通常小于全量微调 |
| 全量领域微调 | encoder＋head | 更高显存、optimizer/activation/检查点成本；需要正确领域目标与稳定预算 | 可以改变判别能力，也可能过拟合/遗忘；需重测全部拟上线任务 |

上游训练示例使用双T4、混合精度与gradient checkpointing，报告约3万问题四epoch需4–5小时。这是示例，不是RTX4060预算；更不能把“16GB系统内存”当16GB显存。实际成本应按显存容量、真实序列长度、问题数、microbatch/累积、更新数、存盘空间估算；本轮没有训练测量，不能报价固定小时或承诺可容纳。若教师分布来自付费模型，标签生成费另计；现有调用授权不能自动扩大成新训练调用授权。

需要三个不重叠集合：训练、校准、最终测试；按来源/目标/模板族分组切分，不能随机拆同一任务的文件名或顺序变体制造独立性。标签需由独立标注者依据冻结rubric判定，分歧保留或仲裁；模型自己的“完成”不能作gold。已有失败样本适合作诊断/训练候选，但被反复查看后不应再当盲测。中文与英文、否定/撤销/条件、无充分证据、输入内恶意指令、长状态、选项置换均需明确分层。

离线结果需同时列accuracy/macro-F1、错放行率与漏升率、Brier/NLL/ECE、risk-coverage、各切片样本数和区间。不存在一个通用“校准10条即可上线”：上游少于10项不拟合只是软件最低保护。若风险定义为独立样本中的错误自动放行，观察n次零错时单侧95%上界约为 `1-0.05^(1/n)`；要声称低于1%，约需299个相关分布的独立零错样本。它不是本次预设样本配额，也不覆盖分布漂移。

## 待授权后的测试项目（本轮均未执行）

1. 固定算法、业务问题与可接受风险后，先冻结同一份独立中文业务集和输入协议；不在此报告决定最小修复。
2. 保留原revision和0.3.20基线，任何SDK升级/训练checkpoint独立目录、单因素对照、可回退清单。
3. 如选择百炼，先核对北京工作空间模型可见性、Key权限与数据地域，再用脱敏合成样本做真实读回；不把文档存在当账号已开通。
4. 如选择本地新权重，先做许可、实际存储/显存、ARM64/CUDA/Ascend所需算子核对，再另获下载/推理授权；不默认开启trust_remote_code。
5. 对所有候选采用相同真实输入长度、问题/选项数、并发、warm/cold、精度与设备条件，记录p50/p95/p99、最大值、显存和端到端拆分。原严格消融有旁路重复编码，不能作为150ms性能基准。模型卡22ms/33ms及云端宣传都不能套成本机100/150ms承诺。

## 研究方法与限制

使用agent-reach官方路由：doctor、Exa网页搜索，官方发布者页面由web交叉读取。Jina读取本次未返回可用内容，未据其作结论。搜索只用于定位；社区聚合页没有作为模型真实性/性能依据。agent-reach v1.5.0检查更新失败（网络失败已重试3次），没有安装更新。

未获取账号密钥、未核实访问资格、未下载模型或执行仓库代码。报告只新增本文件；其他未跟踪证据与协作者改动保留。

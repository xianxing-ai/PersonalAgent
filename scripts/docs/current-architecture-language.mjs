// Current documentation language only; historical execution receipts stay unchanged.
export const replacements = [
  [
    "统一语义裁决由自有ARM64镜像内Laya承担；国内MaaS为执行模型，",
    "当前实验由本机Laya提供有限候选判断，仅资格验证通过的站点可直接决定；资格不足、不确定或复杂问题升级原受信teacher。国内执行模型经AgentArts调用，"
  ],
  [
    "独立节点按真实依赖并行，影子/历史评估默认后台。",
    "模板依赖由自有ARM64镜像串行推进；并行和机会影子尚需实际验收，架构未最终定型。"
  ],
  [
    "唯一全局语义决策为自有ARM64镜像内Laya，国内MaaS为执行候选，责任图/并行/后台影子按当前设计；旧DeepSeek全局决策、Laya本机部署和双人本机阅读不作为现行要求。",
    "当前实验为本机Laya有限候选判断，资格不足升级原受信teacher，国内执行模型经AgentArts调用；自有ARM64镜像串行编排，架构未最终定型。历史部署方案不覆盖当前决定，模板数量不等于业务验收；旧双人本机阅读不作为现行要求。"
  ],
  [
    "镜像内调用Laya决策服务并用国内MaaS执行模型完成任务",
    "串行推进工作流模板，Laya服务和权重留在本机，国内执行模型经AgentArts调用"
  ],
  [
    "当前主架构已按28功能方案统一；唯一全局语义决策模型为镜像内Laya，multilingual typed-choice权重及服务随自有ARM64镜像部署。执行模型候选优先华为支持的国产MaaS模型。模型可配置，不新增白名单或审批限制。主架构定稿与生产重构完成是不同状态。",
    "当前实验包含28功能模板，架构未最终定型。Laya multilingual服务与权重在本机，仅资格验证通过的站点可直接决定；资格不足、不确定或复杂问题升级原受信teacher。国内执行模型经AgentArts调用，模型可配置；模板目录不等于28项业务验收。"
  ],
  [
    "Laya迁入镜像按2026-10-14用户修订",
    "2026-10-14镜像内Laya方案保留为历史；2026-10-16修订为本机Laya/受信teacher与镜像串行编排，架构未最终定型"
  ],
  [
    "唯一全局语义决策采用镜像内Laya multilingual typed-choice服务；权重与服务部署在自有ARM64镜像，国内MaaS模型为执行候选。一个生效配置负责所有最终语义取舍，模型池生成候选。",
    "当前实验为本机Laya multilingual有限choice，只有通过独立任务资格验证的站点可直接决定；资格不足、不确定或复杂问题升级原受信teacher。国内执行模型经AgentArts调用；架构未最终定型。"
  ],
  [
    "镜像装全部28功能编排代码、Laya服务与固定权重、SDK及执行模型配置引用；Laya在镜像内推理，通用执行模型通过国内MaaS推理，本机不加载Laya权重。",
    "自有ARM64镜像承载28项模板及依赖/条件/串行推进逻辑；Laya服务与固定权重留在本机，镜像不包含Laya权重、Python或PyTorch。国内执行模型经AgentArts调用；模板目录不等于业务验收。"
  ],
  [
    "Laya现有端口与服务为待迁入镜像的实现基础，旧fast/world/plan/review收敛最终裁决入口",
    "Laya复用现有本机宿主/端口，资格不足升级原受信teacher；旧fast/world/plan/review保留实际候选与校验职责"
  ],
  [
    "唯一Laya语义决策服务和typed-choice权重位于自有ARM64镜像",
    "Laya有限choice服务和权重留在本机，资格不足升级受信teacher"
  ],
  [
    "镜像内生产接线、真实加载及28功能消费待验收",
    "Desktop长期驻留、站点领域资格及28项业务消费分别待验收"
  ],
  [
    "Laya权重在云端镜像，本机不加载；MaaS执行模型、独立判断合批/并行/缓存减少阻塞",
    "Laya权重在本机；国内执行模型经AgentArts，自有镜像串行推进；机会并行/影子与长期资源占用另验"
  ],
  [
    "唯一决策采用自有ARM64镜像内Laya服务/权重；执行候选优先国产MaaS模型",
    "本机Laya只有资格验证通过的站点可直接决定；资格不足升级受信teacher，国内执行模型经AgentArts调用"
  ],
  [
    "Laya权重置于云端镜像，本机不加载；执行调用国内MaaS",
    "Laya权重留在本机，长期资源占用待验；国内执行调用经AgentArts"
  ],
  [
    "2026-10-14用户确认Laya服务和权重移入自有镜像，",
    "2026-10-14的镜像内Laya方案已由2026-10-16本机Laya/受信teacher与镜像串行编排修订；架构未最终定型，"
  ],
  [
    "全部28业务编排以及Laya multilingual typed-choice服务和固定版本权重装入自有ARM64镜像；Laya在镜像内部调用，不在Windows客户端加载。通用执行模型通过国内MaaS调用。模型资产取得、ARM64 Python/PyTorch兼容、实际加载和服务健康需分别验证，源码存在不代表镜像可运行。",
    "全部28功能模板在自有ARM64镜像串行推进；Laya multilingual服务和固定权重留在本机，镜像不包含Laya权重、Python或PyTorch。国内执行模型经AgentArts调用。站点领域资格、Desktop长期驻留、全部业务消费分别验收，模板数量不代表业务完成。"
  ],
  [
    "2026-10-14用户确认唯一全局语义决策采用Laya multilingual typed-choice，服务与权重迁入自有ARM64镜像，内部通过现有LayaInferencePort调用。",
    "当前实验为本机Laya multilingual typed-choice，使用原LayaInferencePort与单实例宿主。资格不足、不确定或复杂问题升级原受信teacher；架构未最终定型。"
  ],
  [
    "现有本机适配保持兼容，迁移后由镜像内部服务消费",
    "现有本机适配与单实例宿主保留，镜像通过原宿主请求与回执消费判断结果"
  ],
  [
    "自有镜像包含全部28业务编排、Laya权重/服务与可信配置适配，Laya内部推理；ModelGateway通过国内Inference Target调用执行模型",
    "自有镜像包含全部28模板与串行推进逻辑和可信配置适配；Laya在本机，资格不足升级受信teacher；ModelGateway经AgentArts调用国内执行模型"
  ],
  [
    "唯一Laya typed-choice服务和权重也在镜像内；通用执行模型经现有ModelGateway使用国内MaaS",
    "Laya typed-choice服务和权重留在本机，资格不足升级原受信teacher；国内执行模型经AgentArts与现有ModelGateway调用"
  ],
  [
    "Laya只监听镜像内部loopback，不暴露未鉴权推理端口。构建阶段取得固定模型资产并验证摘要；运行不依赖联网自动下载。",
    "Laya由本机受信宿主管理，只接受现有鉴权端口；镜像不包含Laya权重、Python或PyTorch。模型资产版本与本机生命周期单独记录。"
  ],
  [
    "Laya ARM64权重加载、镜像内调用",
    "本机Laya领域资格、Desktop长期驻留与设备休眠恢复"
  ],
  [
    "Laya服务/权重从本机迁入镜像；现有LayaInferencePort、typed_choice与batch-server.py保持兼容。国内MaaS为执行候选，不代替Laya最终语义选择。",
    "Laya服务/权重留在本机，复用现有LayaInferencePort、typed_choice与batch-server.py；资格不足升级原受信teacher。国内执行模型经AgentArts调用，架构未最终定型。"
  ],
  [
    "将现有LayaInferencePort、typed_choice与batch-server迁入自有ARM64镜像内服务，统一责任、记忆/上下文、分派、恢复与影子语义建议",
    "保留现有本机LayaInferencePort、typed_choice与batch-server单实例宿主；仅资格验证通过的站点可直接决定，其他升级原受信teacher，消费责任、记忆/上下文、分派、恢复与影子语义建议"
  ],
  [
    "镜像内Laya服务生命周期与28编排composition",
    "28模板与串行编排composition；Laya宿主生命周期在本机"
  ],
  [
    "迁入镜像后保持loopback内部调用",
    "留在本机受信宿主，保留鉴权与生命周期管理"
  ],
  [
    "镜像内同一Laya typed-choice配置",
    "本机Laya有限choice/资格不足升级原受信teacher"
  ],
  [
    "镜像内唯一决策和完整责任循环待实施",
    "本机Laya/teacher领域资格与完整责任循环待验收"
  ],
  [
    "镜像内Laya唯一决策服务",
    "本机Laya/受信teacher判断链"
  ],
  [
    "Laya镜像内加载/调用和Inference Target执行接线未验收",
    "本机Laya领域资格和AgentArts执行模型接线分别验收"
  ],
  [
    "镜像内唯一决策",
    "本机Laya/受信teacher判断链"
  ],
  [
    "Laya镜像/28编排/平台发布",
    "本机Laya宿主/镜像串行编排/平台发布"
  ],
  [
    "Laya权重/服务迁入ARM64镜像并接统一建议端口",
    "本机Laya宿主与受信teacher接原建议端口"
  ],
  [
    "Laya镜像加载、状态/取消及真实推理验收",
    "本机Laya领域资格、生命周期/取消及实际消费验收"
  ],
  [
    "真实依赖并行执行",
    "依赖图串行推进（机会并行另验）"
  ],
  [
    "真实依赖并行",
    "依赖图串行推进（机会并行另验）"
  ],
  [
    "依赖图并行执行",
    "依赖图串行推进"
  ],
  [
    "依赖并行、模型分派",
    "依赖串行推进、模型分派"
  ],
  [
    "架构定稿",
    "当前架构实验（未定型）"
  ],
  [
    "## 1. 比赛与最终技术路线",
    "## 1. 比赛与当前实验路线"
  ]
];
replacements.push(...[
  [
    "状态：accepted（产品设计，实施待交付） · 日期：2026-10-14",
    "状态：superseded（2026-10-16实验修订，架构未最终定型） · 原日期：2026-10-14"
  ],
  [
    "2026-10-14用户确认Laya服务和权重移入镜像。",
    "2026-10-14的镜像内Laya方案作为历史保留；2026-10-16已修订为本机Laya、资格不足升级原受信teacher与镜像串行编排。"
  ],
  [
    "同一运行只有一个生效最终语义决策配置，唯一决策为自有ARM64镜像内Laya multilingual typed-choice服务与权重。国内MaaS执行模型池产生候选，ModelGateway统一执行模型入口",
    "当前实验为本机Laya multilingual有限候选判断，仅资格验证通过的站点可直接决定；资格不足、不确定或复杂问题升级原受信teacher。国内执行模型经AgentArts调用，ModelGateway统一执行模型入口"
  ],
  [
    "替代旧常驻提案中Laya在本机推理及后来DeepSeek为全局决策的部分；",
    "原镜像内Laya部署与无资格门禁的唯一决策结论已被本机Laya/受信teacher实验修订，不再作为当前要求；"
  ],
  [
    "复用LayaInferencePort和scripts/laya/batch-server.py，typed-choice服务/权重迁入自有镜像；fast/world/plan/review保留兼容并逐包收敛最终裁决入口；不在文档PR删除生产实现或扩公共枚举。Laya镜像内权重减少本机资源负担，但占云端CPU/内存，ARM64包支持、加载时间、并发队列和真实关键路径待测试；执行API仍受网络影响。",
    "复用本机LayaInferencePort和scripts/laya/batch-server.py；镜像不包含Laya权重、Python或PyTorch。fast/world/plan/review保留实际职责，不由文档改动生产实现或公共枚举。领域资格、Desktop长期驻留、设备休眠恢复、本机CPU/内存与真实关键路径分别待验；执行API仍受网络影响。"
  ],
  [
    "## 3. 第一阶段：Laya镜像内真实闭环",
    "## 3. 第一阶段：本机Laya与原受信teacher闭环"
  ],
  [
    "1. 固定模型版本和资产摘要，在构建阶段取得权重/配置/tokenizer；确定国内可达资产来源、许可和ARM64依赖，不在启动时下载。",
    "1. 在本机受信宿主固定Laya版本与资产摘要，独立管理权重/配置/tokenizer；ARM64工作流镜像不包含Laya权重、Python或PyTorch。"
  ],
  [
    "2. 复用batch-server的loopback接口和LayaInferencePort，镜像入口管理Python子进程生命周期与内部凭据，健康检查区分进程在线、模型加载、可推理；任何一项失败不得报ready。",
    "2. 复用本机batch-server与LayaInferencePort，由原受信宿主管理单实例生命周期与鉴权；进程在线、模型加载、领域资格和可直接决定分别记录，资格不足升级原受信teacher。"
  ],
  [
    "5. ARM64构建与本机Fake/结构检查分别记录，实际模型加载及Huawei调用另记录；不是镜像内安装成功就宣布完成。",
    "5. ARM64工作流镜像、独立本机Laya、实际AgentArts调用、Desktop消费和业务工具分别记录；模型加载或模板目录不能证明全部业务完成。"
  ],
  [
    "内部Laya服务/权重加载、28模板映射",
    "本机Laya宿主与原受信teacher、28模板串行映射"
  ],
  [
    "ARM64加载真实模型、模板/依赖/取消/未知夹具",
    "本机Laya领域资格、镜像模板/依赖/取消/未知夹具"
  ],
  [
    "唯一全局决策采用镜像内Laya multilingual typed-choice服务/权重。",
    "当前实验为本机Laya multilingual有限choice，仅资格验证通过的站点可直接决定；资格不足、不确定或复杂问题升级原受信teacher，架构未最终定型。"
  ],
  [
    "第一交付：Laya服务/权重ARM64镜像生命周期、loopback调用、健康/启动错误、候选Schema/revision校验，保留现有runtime端口。接着映射全部28模板、并行/分支汇合、责任/语音及按需影子；",
    "第一交付：本机Laya单实例宿主、原受信teacher、健康/启动错误、候选Schema/revision和领域资格校验，保留原runtime端口。接着映射全部28模板的串行推进/条件汇合、责任/语音及按需影子；"
  ],
  [
    "验收：ARM64模型真实加载、choice输出/非法候选/取消/busy/迟到隔离；",
    "验收：本机模型真实加载、领域资格、teacher升级、choice输出/非法候选/取消/busy/迟到隔离；"
  ],
  [
    "Laya ARM64加载与镜像调用待验证",
    "本机Laya领域资格与宿主消费待验证"
  ],
  [
    "ARM64加载与镜像调用待验证",
    "本机Laya领域资格与宿主消费待验证"
  ],
  [
    "镜像内Laya虽持有可部署权重",
    "本机Laya持有固定权重"
  ],
  [
    "本轮已授权开始Laya镜像实现与Huawei部署",
    "本轮文档只修正当前实验叙事；本机Laya与工作流镜像/Huawei部署分别交付"
  ],
  [
    "最新确认采用Laya multilingual作为唯一全局语义裁决，Python服务和权重移入自有ARM64镜像，通过镜像内回环调用。",
    "当前实验采用本机Laya multilingual有限choice，仅资格验证通过的站点可直接决定；资格不足、不确定或复杂问题升级原受信teacher，架构未最终定型。"
  ],
  [
    "Laya按用户确认随镜像部署，运行时从预装权重加载，不依赖海外下载。",
    "Laya服务与权重留在本机，ARM64镜像不包含Laya权重、Python或PyTorch。"
  ],
  [
    "唯一全局语义决策配置",
    "原本机Laya/受信teacher判断链"
  ],
  [
    "Laya镜像内唯一决策",
    "本机Laya/受信teacher与串行图实验"
  ],
  [
    "旧Laya本机/DeepSeek全局决策/SVG设计包按历史阅读",
    "旧镜像内Laya/无资格门禁决策/SVG设计包按历史阅读"
  ],
  [
    "镜像内决策与平台适配",
    "本机判断与AgentArts平台适配"
  ],
  [
    "ModelGateway统一国内MaaS执行调用",
    "ModelGateway经AgentArts统一国内执行模型调用"
  ]
]);
export function currentArchitectureLanguage(text) {
  for (const [before, after] of replacements) text = text.replaceAll(before, after);
  text = text.replaceAll('# ADR-0024：统一决策、责任图与后台影子架构', '# 历史架构方案（原ADR-0024）：统一决策、责任图与后台影子');
  text = text.replaceAll('绑定Laya本机Laya/受信teacher判断链', '绑定本机Laya/受信teacher判断链');
  for (const before of ['唯一主决策配置', '唯一主模型', '唯一决策模型']) text = text.replaceAll(before, '原受信判断链');
  text = text.replaceAll('全部28业务Workflow在自有ARM64镜像执行', '当前28功能模板及依赖/条件由自有ARM64镜像串行推进，模板不等于业务验收');
  text = text.replaceAll('全部28业务Workflow迁入自有ARM64镜像', '28功能模板及串行推进逻辑由自有ARM64镜像承载');
  text = text.replaceAll('唯一模型参与', '原受信判断链参与').replaceAll('由唯一模型建议', '由原受信判断链建议');
  text = text.replaceAll('唯一模型语义建议', '受信语义判断建议').replaceAll('最终语义裁决唯一', '判断绑定本机Laya领域资格与原受信teacher');
  return text;
}

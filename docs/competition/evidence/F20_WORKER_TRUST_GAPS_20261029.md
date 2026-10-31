# F20 worker 生产接线缺口（2026-10-29）

目标 profile：`huawei_ict_agentarts`。本记录为源码审查结果，不是图执行或真实服务验收。

## 2026-10-31 接管修复进展

后续生产接线采用原 `coding.repair.trial` 与隔离宿主，增加独立 F20 原图/子任务绑定，不借用 H1 身份。固定 `f20-typescript-sample` recipe 使用仓库已锁定 TypeScript 5.9.3，不读取项目 tsconfig 或执行样本；只接受选定 TypeScript 契约及直接绑定该契约的显式类型对象示例，JSON Schema 案例仍 unavailable。编译器、标准库与检查入口固定在隔离工作区外并检查内容身份，试验仍沿原 deadline/cancel 和授权链。此 recipe 是新增窄能力，旧 node-check 案例不自动迁移、不提升为候选验证；完整生产组合与真实图验收完成前仍保留未验状态。

- 新增公开 `@personal-agent/contracts/f20-candidate` v1：只允许有界 `docMarkdown`、`sampleSnippet` 和版本，不接受模型提供路径、recipe、授权或源版本；Schema 与类型由现有生成器生成。
- F20_N03 与 Runtime 工具目录现在使用现有 `coding.repair.trial`。N02 的原始本地选择回执必须唯一、非 abstain，候选值通过公开 Schema；trial 参数只能创建宿主从原 `codeFile` 派生的隔离样本路径，内容必须逐字等于选中候选，recipe 必须等于原案例配置，禁止额外 patch/来源/父 trial。旧 `workspace.run_allowed_command` 不能充当候选验证。
- completion 要求原 trial 子任务、候选、隔离 session、两份来源、可信 baseline/recipe fingerprint、完整 artifact 与每项 required verification 的原 run Evidence 一致。新增样本之外的源快照不得改变；比对内容元数据而非会被工具投影移除的明文。`additionalSourceTaskIds` 只允许原先已绑定的读取任务。
- 初始数据、节点回执、完成结果的出机许可及 frontier 均须明确返回 `true`，异步拒绝不会当作允许。
- 本地验证使用显式合成镜像、候选和 trial 结果；实际 Runtime、Policy、原 HostBridge 子任务与审批恢复参与执行。它不证明真实 TypeScript 候选检查或真实 AgentArts 服务可用。
- 本轮构建通过；六个受影响测试文件共 53/53 通过，无跳过，包括替换样本在 trial 前拒绝、出机/frontier 显式拒绝、未知结果不重放、原来源核实后继续及 Schema 边界。完整集成 CI 待接线增量整合后验证。

### 同日生产提供者增量

- Runtime 新增只读 F20 binding/context 消费入口，从原 `competition-loop.pending`、图记录、HostBridge 父子关系、实际 N02 选择及 N03 Gateway allow/started 原记录验证身份。仅 F20 原始 `host-tool-*` trial 可进入专用候选上下文；H1 原路径保留，F20 不能借它发布或采用样本。
- Desktop 原 `harnessRepairHost` 路由 F20 到同一隔离实现的独立 journal，唯一 required recipe 为 `f20-typescript-sample`。实际编译入口固定在工作区外，固定 TypeScript 5.9.3 与标准库内容身份；禁用项目配置、样本执行、类型断言、any、spread 和忽略错误，要求直接使用所选 TypeScript 契约的显式类型对象示例。原样本路径仍由宿主派生，失败不转换为成功。TypeScript 使用既有锁定版本，现在也是 Desktop 生产依赖，无版本升级或新下载。
- `native-execution-host` 将 trial 列入必须准备的原生执行操作；只读支持目录由 Main 固定注入、逐次核对目录身份，不能通过模型参数选择，仍保留原写目录、可执行白名单与禁止网络策略。没有 PSEC 准备或原 native-execution 许可时不降级为普通进程。实际 PSEC 中编译器执行尚未完成服务级验收。
- N02/N04 沿现有 ModelGateway/Laya 本地判断链，均读取原两份本机来源，N02 明示尚未检查样本；N04 还绑定 N02 原候选及 N03 原确认 trial，非 abstain 候选不能替换原文档。完成前核对 typed 本地模型回执的实际 context digest、原 task/run/参数及选择，额外复核完整源快照与已准备依赖 fingerprint。模型判断仍不等于独立真人签名、事实正确性证明或发布授权。
- 初始数据在两份来源经各自 Policy 读取后才申请原子任务的出机回执；初始、节点结果与完成状态均消费原授权问题的各自固定投影。来源变化、替换结果、撤销、reviewer/deployment 变化均拒绝；镜像适配器在异步凭据返回后及 WSS 发送前重检 F20 来源与配置。
- Main 实际创建 F20 ports，AgentArts composition 仅在已固定 image 且 ports 完整时注入专用 worker；案例、TypeScript recipe、本机判断或原授权未准备好时目录不可用。现有 node-check、JSON Schema 案例不自动迁移为已验证 TypeScript 案例。
- 工作区设置新增「API 文档检查」实际入口，仅提交案例标识、文档模板和固定 recipe，三份文件仍由原生选择器确认，不接收 Renderer 路径或授权。设置与模型稍后就绪时会重新检查 availability，不把配置保存当图验收。

本地证据：124/124 受影响 Runtime/Desktop 回归通过，后续包含镜像发送边界与新提供者的定向集为 114/114；包含旧 driver 的 F20 fixture 迁移且保留原审批等待、unknown 不重放与取消断言。另有真实 Node/TypeScript 隔离样本检查、源字段/类型/any/ts-ignore/伪契约及额外未检查对象拒绝；生产端口与原生路径范围测试 6/6；架构 3/3；新增原出口许可与来源/依赖漂移用例 1/1；最终 N02/N04 改动 Runtime 10/10；设置入口 8/8。实际 Electron `test:workspace-smoke` exit 0（合成应用状态，主题/工作区/窗口及原生截图）。真实 workspace host→隔离创建→编译→verification 读回用例通过，并确认原工作区不存在样本、发布被拒绝。该用例的 Runtime/授权/版本元数据显式合成；原 Runtime 身份及 typed review 则由独立实际 Runtime 用例验证。首次较深测试目录触发 Windows 子进程 `ENOTCONN`，已去掉重复 sourceDigest 目录层（摘要仍进入配置绑定），改用外部独立短 TEMP 后真编译通过，未重放业务调用。最终整合检查由集成工作树执行。

**仍未完成**：固定 AgentArts 部署上的 F20 整图真实调用、该版本下实际本机 Laya 判断与 Windows PSEC 内候选编译的联合验收、真实文档站点/版本差异及写回验收。未知 trial 保留原记录且不重放；现有 H1 原生 reconciliation 固定在其 journal，F20 的专用只读恢复路由仍需后续接线，不能宣称 unknown 已核实或可自动继续。当前只交付验证后未发布的文档候选，不能据此标记 F20 整图或 #531 已完成/可合并。下文保留 2026-10-29 审查原记录，工具映射和候选格式的当前进展以本节为准。

## 现有能力

- `apps/desktop/electron/f20-case-config-host.js` 将用户原生选择的案例加密保存，核对工作区、固定 recipe 和源路径；`resolveInput` 的 `sourceVersion` 绑定配置，并非源文件内容的摘要。
- `apps/desktop/electron/workspace-config-host.js` 暴露 `resolveF20Case` 和受工作区授权约束的 `workspace.run_allowed_command`；`node-check` 仅检查配置的原代码文件。
- `apps/runtime/src/application/owned-workflow-worker-capability.ts` 复用 Runtime、Policy、HostBridge 和原有任务，预读两份源文件、消费图回执；配置缺失时不注册 worker。`verifyCompletion` 必须独立绑定当前源、实际候选和检查结果；仅 exit code 为零不满足该约束。
- `packages/coding-tools/src/harness-trials.ts` 的 `coding.repair.trial` 已提供 baseline、patch、recipe 绑定的隔离验证和本地回执；`apps/runtime/src/application/harness-candidates.ts` 检查原始 Runtime 执行和 Evidence。它们当前消费已有 H1 trusted binding，尚不是 F20 adapter。

## 不能直接注入的原因

F20 N02 的设计输出为 `docMarkdown`，N03 要求检查 `sampleSnippet` 可编译且不包含契约外字段；当前固定命令只有 `{recipeId}`，没有候选片段或摘要参数，执行的是原工作区命令。源码中的 `sampleSnippet`、`typeCheckPassed` 和 `noPhantomFields` 目前仅见于图设计数据，没有发现将模型候选与两份实际源及类型检查结果绑定的现成公开实现。现有 Synthetic 测试的回调不能作为生产验证器。

因此即使案例已配置，也不得仅凭配置、旧代码检查 exit code、图状态或模型候选宣称 F20 通过。`ownedWorkflowWorker` 在完整受信 frontier、数据出境授权及候选检查均未具备时继续不注入；缺项应显式 unavailable。

## 可继续的实现方向

1. 为 F20 N02 定义受限候选格式，并将候选与原始选择回执、两份 HostBridge 读取结果及原始配置绑定；对源变化和候选替换 fail closed。
2. 将候选示例转换成有精确 baseline 和受限路径的隔离 patch，复用 `coding.repair.trial` 或等价的现有隔离检查宿主，走原 Policy/ToolGateway。校验绑定的 recipe 确实针对该候选与选定契约执行，不能把原代码的检查结果冒充候选检查。
3. 在 N03/N04 frontier 与 completion 校验原始 task、operation、参数、source/candidate digest 和确认回执，保留未知结果及取消语义；只对受信范围的数据使用已有 export authorization。
4. 生产注入及真实配置前，补齐替换候选、源漂移、越界、缺检查、未知结果和授权撤销的定向测试；分别记录 Synthetic 与真实服务证据。

## 接口和代码改动边界

- `packages/agentarts/src/owned-workflow-templates.ts` 的 F20_N03 当前发布 `workspace.run_allowed_command`；要验证隔离候选，需要改为公开的候选检查适配，并同步处理 graph adapter requirements 和对应测试。不能由 Runtime 偷换同名工具参数语义。
- `packages/agentarts/src/owned-workflows.ts` 中 `decision.choose_candidate` 的原始 `arguments.context` 含 `workflowId`、`nodeId`、`candidateValues`，本地 `selectedId` 指向其中一个值。参考 `apps/runtime/src/application/coding-repair-frontier.ts` 的 `selected()`：从原始绑定 operation、确认证据和唯一 selectedId 读取 N02，拒绝 abstain、重复 ID 和非当前图候选；不读取单独的云节点状态作为权威。
- 候选输出需要受限、可确定映射到实际示例文件的结构；至少保留 docMarkdown、sampleSnippet、目标路径和内容摘要，并由宿主而非模型指定可写临时目标、允许的 recipe 和源快照。该结构尚未由当前公共契约定义，跨包公开前应补 Schema/生成类型及兼容说明。
- `createHarnessCandidateTrialTool` 使用 `readBinding(context,candidateId)` 获取 `HarnessCandidateContext`（`binding`、`baseline`、`recipes`、`selectionPolicy`），再验证 `coding.repair.trial` 的 `candidateId`、`patches`、`recipeIds`，最终返回 `HarnessCandidateTrial`（`binding`、`session`、`checkReadback`）。F20 需要真实构造这些上下文：原 task/workspace、snapshot ID、input/configuration digest、workflow/runtime version、recipe fingerprint、受限 patch 及可检查该示例的 recipe。当前仅有的 `node-check` 指向原代码，不能证明这个前提。
- `apps/runtime/src/application/owned-workflow-worker-capability.ts` 的 `RuntimeOwnedWorkflowWorkerOptions.verifyCompletion` 当前接收 `read`、`check`、`sourceReads` 和 graph；需明确提供原 `coding.repair.trial` HostToolTaskReadback，按 `packages/contracts/src/harness-candidates.ts` 解析并验证 candidate/patch 摘要、baseline、session、所有 required verification 的状态及原始 Evidence，二次检查当前源和授权。`additionalSourceTaskIds` 不能引入未绑定源。
- Desktop 接线还需真实 image binding、有效 `assertCurrent`、经现有授权问题宿主的初始/回执/完成 export authorization，以及上述 guard、trial、completion；必须全部满足后才把 `ownedWorkflowWorker` 传入 `createRuntimeApplication`。

本轮未改生产代码、未运行 F20 测试，也未验证真实 AgentArts 或外部服务。

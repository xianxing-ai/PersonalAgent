# F03 计划与原效果接线方案（2026-10-31）

Competition Profile，基线 `d5e67c8a` 加 F24 原知识写入恢复。以下是本轮实现方案，不是已完成验收。

## 最小纵向次序

1. 原计划：复用当前 Goal cognition 的原 review/candidate、`selectProjectedRepairScope`、`submitLocalRepair`、`cognition.commit_repair`、原 SQLite CoordinationStore。先把当前 Desktop 内部的原计划回执核验提为 Runtime 只读公共端口，并让原实际调用方消费；它必须验证原 review、candidate、ToolGateway 执行、完整 CAS 后快照及当前节点版本。随后 F03 N03/N04 消费同一原回执，不增加第二套计划执行循环。
2. 原执行：复用 business bridge 已有 graph → host → business task/run/descriptor/inputDigest 持久链。增加受信原 Goal/Plan 调用方提供的原 `NodeRef`、原图 revision 与来源 Fact refs 的绑定；模型不能填写。没有映射的历史任务保持 unavailable，不追填。
3. 原因果：只以实际 `FactProjectionReceipt.links` 和 `CompletedFactImpact.report.causes` 连接原计划依赖与当前变更，随后以原执行映射连接具体效果。KnowledgeWriteProjection 当前只有 source/path/operation，不能把完成标志当 Fact revision 证明；需要真实 revalidate 结果给出精确旧/新版本读回。
4. 首个实际效果只选已有真实 journal/readback/finalize 的 `knowledge.apply_note_patch`。未知先复用 F24 原 run 读回，不写入、不复活期限。补偿是独立新操作及参数摘要；原正向许可不自动成为补偿许可。

## 授权及兼容边界

- 不放宽 `readWorkflowBusinessToolSource` 的 confirmed 语义。需要历史 unknown 身份时单独提供只读执行证明，返回明确状态，不生成 confirmed receipt。
- `Policy.authorize` 会消费一次性许可，N08 不能用它试探。现 `prepareHostToolTask` 尚未冻结参数/建立审批；`finalizeHostToolTask` 会 dispatch，不能充当纯检查。优先调查/复用原 deferred 路径；如果缺失，沿现 Runtime/ToolGateway 增加最小审批分离端口，不新建授权层。
- 计划 CAS 更新不等于外部回滚；缺原因果或 effect reader 时不提交补偿。没有实际调度/效果证据的 F03 整图不能注册为已完成能力。
- 新增内部绑定保持旧记录可读；原记录缺字段时只返回 unavailable，不能清库、迁移补造或重放历史操作。公共导出与 Main 最终组合由集成树串行完成。

## 验收目标

原计划全快照读回、历史输入替换/版本漂移拒绝；原图/会话/node/run/参数替换拒绝；同对象新动作与补偿不混淆；原 unknown 零重写；取消/期限/配置变更停止；已有事实和实际效果保留；原 SQLite 重开和重复请求不重复执行。真实文件、云模型、AgentArts、业务账号和独立审核分别记录。

## 已交付增量 A：原计划只读回执

`RuntimeApplication.readF03PlanRepairReceipt({taskId,sourceTaskId,reviewTaskId,graphNamespace})` 复用原 local repair intent、原 Goal review/candidate、原 `local-repair-<taskId>` ToolGateway run 与完整 CAS 后快照。缺少或被替换的原证明返回 unavailable；只读接口不执行、续跑、签发或消费许可。返回不可变原节点版本与 `graphUpdateVerified`：目标被后续版本替换时保留已发生的历史效果，但当前核实标志为 false；无关节点更新不影响原目标核实。Desktop Goal 实际调用方已改为消费该端口，移除其重复的私有回执核验。

本地验证：Runtime build 通过；`reviewed-local-repair`、Desktop `goal-cognition-host` 和 `goal-cognition-empty-projection` 共 69/69 通过。使用实际 Runtime/SQLite/Policy/ToolGateway/CAS 与显式 Synthetic 模型，覆盖审批前无回执、原数据库重开、来源/候选/intent/结果/命名空间替换、无关及目标后续版本、重复读取零执行，并回归原桌面 Goal 消费链。此增量不证明 F03 原因果、外部补偿、整图或 AgentArts 真实验收完成。

## 已交付增量 B1：原知识写入的 Fact 观察回执

现有 `createTrustedKnowledgeTools` → `createKnowledgeWriteProjection` → Desktop `privateMemory.revalidateSource` 实际链保存原 task/run/argumentsDigest/operationId、写入前后 SHA 及真实 `revalidateWikiFact` 返回的 previous/current Fact refs、原引文摘要和来源版本。Desktop 在原受信 Wiki lease 内前后读回同一路径的来源 SHA；后来独立写入已替换原内容时不给出该原操作的读回。Runtime 校验来源、版本、状态、重复 Fact 与额外字段后，把回执存入原 projection checkpoint。原 unknown 写入不进入该投影，已知写入结果与投影失败保持分离；原写入最终核实路径也传递实际 current SHA。

回执覆盖范围明确为 `observed_active_heads`：它证明本次观察的 Fact 变化，不单独证明完整原因果链或“没有其他效果”。已撤回头、历史缺记录、进程在 Fact 提交后但回执保存前中断，均不补造归因。后续消费者还须连接原 Plan 执行映射、原依赖版本、实际 Fact projection links / impact causes 并读回当前版本。原来源较早版本的 Fact 也保留其真实 `sourceRevision`，不能仅因同一路径就归给本次写入。

兼容：原 void provider 与旧 checkpoint 可继续恢复，但没有 `factReadback` 时不得声称 Fact 证据已验证；没有数据库时不创建或导入私人 Fact。新数据仅为原 checkpoint 的可选字段，没有数据库迁移、清库、额外写入重试或新的云端字段。

本地验证：Runtime build；13/13 原工具/投影测试（实际 ToolGateway/Policy、显式 Synthetic writer/provider）；27/27 Desktop Wiki 来源与 F24 恢复回归，其中 Wiki 版本测试读取独立临时目录中的实际合成文件及 SQLite，F24 同时回归实际受控文件 journal。无私人知识库、真实模型或云端验收声明。

## 增量 B2：用户选择原 Plan 后的新执行任务（2026-11-01）

在既有持续目标控件列出当前 Plan，用户点击明确版本后由原生确认显示将发送的 Plan 摘要与实际部署；确认不替代后续任何工具卡。Renderer 只提交 Plan ref / expectedGraphRevision。Goal 宿主固定 namespace，Main 固定当前 conversation、点击 command 与部署身份；确认后再次校验来源及部署。原 Plan、传递依赖 NodeRef、现有 Fact 投影映射及实际当前 Fact 版本在 Runtime 受理前冻结；无映射/原来源 reader 时不可用，不读取同会话历史猜测来源。

使用原 `submitTaskWithCheckpoint` 与 `dispatchAcceptedTextTask`，从原 Competition prepare/send 回调进入 AgentArts、私人消费检查与委派。仅 Plan 摘要进入新任务 goal，Fact 正文默认留本机。后续执行与审批恢复沿原 parent 关系核对冻结来源，business bridge 仅从受信 root 读取来源摘要；没有绑定的历史任务不追填。源版本失效、撤回、部署变更或取消阻止新执行；这些检查不加到原 unknown 效果的只读 reconciliation API，不抹除历史效果。新增 FactProjectionStore 只读查询复用原表，不新增数据库或调度器。Main 的 IPC 分支与实际原生确认由集成树串行接入。

已实现 Runtime `previewPlanExecution`、`submitPlanExecutionTask`、`readPlanExecutionTask` 与 `readPlanExecutionBinding`，Goal 宿主 `executePlan` 和既有持续目标控件 `goal.plan.execute` 消费。每个 namespace / Plan id / revision 只绑定一个原任务；并发点击、丢失回执、Renderer 重开和 SQLite 重开都读取同一原任务，不再 dispatch。重新执行必须明确创建新 Plan 版本。已有任务查询不要求仍有效的 Plan、期限或部署；当前状态与原任务 id 在 UI 显示，unknown 明确为等待原结果核实。

公共 Fact 当前头复核复用 `SqliteMemoryHost.readPublicFactHead` 和固定 namespace 的 `CompetitionFactHost.readCurrentPublicFact`。同步读取实际最新头，拒绝 private，遵守原 erasure intent，不能回退到旧 active 版本。`createPlanExecutionFactReader` 只接受本机显式绑定的 `{memoryNamespace,facts}`；未配置/私人来源保持 unavailable。异步 Fact provider 明确拒绝，确保原 `beforeSend` 在凭据读取之后及原 Policy 执行前都能同步复核来源；无额外传输层、授权层、数据库迁移或配置回填。

Main 最小接线：向 Competition Application 注入 `planExecution:{readCurrentFact:createPlanExecutionFactReader(readFixedFactHosts)}`；在既有 Goal IPC 白名单中接 `goal.plan.execute` → `goalHost.executePlan(payload,{conversationId,deadline,signal,confirm})`。`confirm` 的原生窗口必须展示并绑定实际当前部署/版本、将发送的 `summary`、原 Plan ref 与 `sourceDigest`，并复用既有 privateConsumption / source / preparation 回调；不得用恒真确认或新云调用替代。Runtime 受理与工具执行仍走原链。集成树负责公共类型出口及 Main/Preload/实际原生窗口验证。

验证使用实际 SQLite、Runtime、ToolGateway、Policy、Fact 投影与 AgentArts 适配器；模型、凭据、原生确认和网络均显式 Synthetic。最终发送回归在 `authorizationProvider.read` 内更新真实 Fact 当前头，随后原 beforeSend 拒绝且 HTTP/工具执行均为 0。覆盖未 drain 的 Fact 更新、Plan/部署漂移、取消、并发受理、未知结果重启零重放、原身份污染、独立工具审批与缺映射拒绝。F24 原未知受控文件读回单独回归；不声称已完成真实 AgentArts、真人确认、完整 F03 原因果/补偿或整图验收。

本地结果：Memory / Runtime workspace build、两个 Desktop 修改模块的语法检查及 `npm run check:architecture`（3/3）通过；Plan / 原任务委派 / business bridge / Fact projection / public Fact host / Memory SQLite / AgentArts / Goal UI / F24 共 283/283 定向回归通过、0 跳过。F24 文件案例使用已有 PowerShell 宿主和独立临时目录，实际读取受控文件 journal，丢失确认仍为显式 Synthetic。最终整仓 `npm run check` 和 Main 原生窗口 smoke 由集成树在公共出口/IPC 接线后执行。

### B2 根 Main 消费（2026-11-01）

根接入实际 proactive host 的固定 `${namespace}:proactive-public` Fact 只读口，公开
PlanExecutionOptions/Selection/Source 类型；没有为私人来源补替身。既有 `desktop.invoke`
路由中的 `goal.plan.execute` 仅允许正式 Competition 的原 panel/workspace 窗口，绑定原对话、
应用实例和执行期限。原生确认展示摘要、Plan 版本、固定 Runtime/deployment/gateway、来源摘要
和依赖数量；取消、窗口关闭、切换对话或部署变化都拒绝新受理，后续仍走原 privateConsumption
和 prepare/send。已有原任务只返回读回，不重新确认、dispatch 或移到新对话。

根 build 通过；Plan source/实际原生授权消费组 20 项中 19 通过，唯一失败为 Main 测试夹具未提供
新增 developmentJobHelper 绑定；更新夹具后 Main/Plan 定向 7/7 通过。没有放宽产品断言；普通
沙箱的 F20 rename EPERM 在授权环境原测试通过。日志 `.cache/integration-plan-native-caller.log`
与 `.cache/integration-plan-native-main-tests-authorized.log`。实际窗口确认仍未目视验收，不能把
执行 Main 回调的 Fake dialog 当作真人批准或云整图证据。

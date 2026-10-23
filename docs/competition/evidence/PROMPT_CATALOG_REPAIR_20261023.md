# 提示词与工具目录有界修复（2026-10-23）

Profile：`huawei_ict_agentarts`；基线 `ad1a045e1ec65f9ef280125d9df78b9cb63b4e51`，
工作树 `.worktrees/prompt-catalog-20261023`。本包仅拥有 AgentArts 提示词与 Runtime 工具目录。

清单 #4 的源码事实已确认：`safeSchema` 原先完全移除参数 description。
这不能单独证明真实模型某次误判的唯一原因。修复仅公开参数与数组元素说明，
每项最多160个 Unicode 字符，去控制及双向控制字符；根 metadata 继续不公开。
说明是数据，提示词明确其不能改变任务、系统指令或授权。

仍使用原64工具上限、24KiB限制；40工具是本次预算回归夹具。目录加入说明后超预算时，仅移除说明；不删字段、
required、范围、enum 或工具。结构仍超限则明确失败。冻结目录复核接受同一结构的
无说明降级，结构变化仍拒绝。`description` 同名业务参数不会被误删。
通过实际 prepare → parseCoordinationAvailableTools → assertSelectionCurrent →
assertProposal 路径测试；40工具降级后仍通过本地参数校验，结构变更拒绝。

清单 #14 补充明确创建/修改/保存文件应使用真实工具和必要读回，生成代码文本不是落盘。
保留10月22日已做的审批简化，模型不另索文字确认，Runtime/Policy负责实际授权。
版本 `owned-1.10`。能力自知提示消费原 goal/context 内的宿主 capabilityStatus：
available、registered、unavailable分别说明当前就绪、注册、未确认可用；
checked_on_invocation不是拒绝或批准。未有具体配置/权限依据时不猜原因。
宿主自知数据装配由另一个工作包完成，本包不新增wire或执行入口。

## Gemini 历史原文

核对 #485 merge `d4f94b9d`，第二父为原提交 `0713d90f`。
原 manifest `JARVIS_EXACT_PROMPT_PREPARATION_20261021.json` 完整保留，
其中原 Markdown SHA256 仍为
`ade6a1068cbe00e141d71288102be14ccdc901a542f17042bfec1e08dbf0dca3`。
原附件不在本工作树，不能宣称重新计算其原始字节哈希。

本次仅修改已有 PROMPT_VERSION、TASK_ACTION_PROMPT 声明并新增能力规则。
boundary、FAST 表达式及其风格尾段、CONTINUATION_REPLY_PROMPT 无本次改动。
既有三项 JARVIS 字节 SHA256 测试通过。与 #485 的逐声明比较显示：
manifest 八项其他提示中七项仍一致，CONTEXT_INTEGRITY_PROMPT 在本轮基线前已变化；
boundary 亦在10月22日简化中变化，CONTINUATION_REPLY_PROMPT仍与#485一致。
不回滚这些已授权历史修复，不将当前全文冒称原文件逐字相同。
Desktop voice/mail 与 Runtime subagent 原声明由对应owner负责，本包未触碰。

## 本机验证与限制

本树独立 `npm ci --ignore-scripts`，无依赖版本修改；环境 Node24.19.0 / npm11.9.0，
与仓库声明的24.15.x /11.12.x存在版本差异，安装输出有对应EBADENGINE提示。
全量 `npm run build` 通过，Runtime/AgentArts typecheck通过。
四个定向测试文件共56项通过；新增能力metadata边界测试后提示专有5项通过。
整个 Runtime + AgentArts 回归共1373项，1366通过、0失败、7个既有F15集成项跳过。
该回归含本地实际工具执行与原授权恢复测试，但不把跳过项计为验收通过。
`git diff --check`通过。

测试中的模型、宿主回执明确为Fake或本地夹具；不能证明真实模型行为已改变，
也不代表AgentArts服务、真实账号、审批卡UI或ARM64镜像验收。
无重模型/云凭据调用，无镜像构建、推送或部署。

## 与并行 PR 的普通合并兼容核对

只读核对组合源码 `d0f328a1800d5c4b19c636d6c8961f1dc1655088`，通过
`git merge-tree --write-tree <组合SHA> <PR-head>` 检查；仅生成临时Git对象，
没有把下列PR合入实际交付分支。2026-10-23 GitHub读取的三个PR均仍OPEN：

| PR | 核对的完整 head | 结果 |
| --- | --- | --- |
| #503 | `06a0848ffa7d4ce84bb1f4454f3179eb0efd3eb4` | exit 1；`apps/runtime/src/application/coordination.ts` 三处文本冲突 |
| #507 | `cc340ffc7e0e868f44d7a817043546e45d636dd4` | exit 0；无文本冲突 |
| #509 | `6853c87ce92da3ce3e46d92f4c74e32142972628` | exit 0；无文本冲突 |

#503 的未来最小 resolution 需要保留双方语义，而不是选整侧覆盖：

1. 顶部 coordination 导入同时保留 #503 的 `AgentArtsBeforeInvokeError` 与本包的
   `formatAgentArtsFailureDetail`，保留其他既有导入。
2. `markCompetitionCloudUnknown` 同时保留 #503 要求的 `export` 与本包
   `safeSuffix = ''` 可选参数；unknown 状态仍保留安全诊断后缀、不引入重试。
3. `exchange` 的 catch 同时保留 #503 的 `competition-coordination-failure`
   checkpoint（调用 `coordinationFailureDiagnostic`）与本包的 `detail`/`suffix`
   计算及后续透传。诊断写入不能替代原请求身份/terminal/unknown回执判断。

上述只是未执行的后续合并配方；不宣称 #503 兼容通过，也不将文本无冲突
冒充组合运行验证。后续源码/head变化须重新核对，并在真正合并时验证其调用方。

最终源码冻结为 `85431361bc40033635a4632e79cf8974e0c81e48` 后，再对上述三个完整head
运行同一普通merge-tree检查：#503仍为同一文件三处冲突，#507/#509仍exit 0。
本次仍未实际合入这些PR。对最终error增量 `1457c9c690e16050809bd449cf2e8384c218809a`
的独立定向复核，读取实际protocol Schema的13种Error.code，逐项验证read/write经
toolFailure与Desktop两次投影保留code/cause、排除原始私密文本；read保留合法
retryable/retryAfterMs，write始终RESULT_UNKNOWN、retryable=false且无retryAfterMs。
最终组合的上述关键源码与该增量逐文件diff为空；完整pin check由唯一组合树另行执行。

## 统一检查暴露的消费回归与后续修复

上述854组合随后实际统一pin check失败，不能将前面的定向通过解释为完整检查通过。
安全Schema错误的新格式使Agents原精确匹配漏掉合法提案修复，修复
`f6191ec37e1133e6daf75cf2eb3f427742d5a9ac`仅接受锚定全文的安全keyword/field格式，
保留原预算；工具执行侧错误不触发模型重写。独立提案修复定向25项通过。

能力诊断曾为未选择环境封装的输入追加/前置文本，实际破坏历史JSON、主动Goal固定
prefix后的JSON解析，以及原goal作为Todo title的消费。修复
`87925a02f8b66967d7922170f51ee692adad4f1d`仅在已有readRequestContext实际返回
非空环境字符串时加入原envelope；无hooks、历史hooks、返回undefined与teacher路径
保持原格式。实际Main普通会话callback的能力提示到模型正向测试继续保留。

继续审查enabled环境路径又实证：描述Schema漂移后，诊断采样在原发送guard之前抛错，
使已确认本地写入的子任务从waiting_reconciliation变成failed，并多出父汇总发送。
修复 `b47011095325b39b4af9e8f35712f6eda04e993a` 将catalog解析与describe一同纳入
可选诊断try，失败只产read_failed，实际权限/结构拒绝仍交原final guard与hold处理。
独立最小复现env=false/true均2项通过：发送仍1次、原目录不变、唯一真实执行记录仍为
confirmed/allow/started，子任务保持waiting_reconciliation。未放宽原断言或授权。
最终组合完整pin check仍须以整合工作树后续实际完成结果为准。

## 最后只读收尾

源码冻结 `c276adf38de15e8c84c1941fd5defd68cb2a3b03` 与本包已交付 `65023f27`
的 `packages/agentarts/src/prompts.ts` 逐文件diff为空：后续集成没有再修改JARVIS、
FAST、continuation字面；这不改变前文对#485之后已授权历史差异的说明。
本轮未操作main；远端跟踪 `origin/main` 仍为基线 `ad1a045e1ec65f9ef280125d9df78b9cb63b4e51`。

最后异常对象映射互审覆盖 `c90f2357` 与 `a2b40a1f`：云端安全诊断formatter在
访问异常对象失败时返回无附加detail；Gateway/UI仅读取自有data descriptor，
不执行accessor或复制其抛出的私密文本，Gateway另拒绝Proxy诊断分类。
可选诊断失败不能替代原写入unknown语义；合法typed read的验证后重试元数据继续保留。
本次收尾只读源码，不重复执行检查；统一pincheck与ARM验证由唯一镜像工作包执行。

在该最终冻结SHA上再次对上表三个完整PR head执行普通merge-tree：#503仍为同一
coordination.ts三处文本冲突，#507/#509仍exit 0。前述最小resolution配方仍适用；
没有实际合入三个PR，也不将文本检查解释成CI通过、真实云调用或部署成功。

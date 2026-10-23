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

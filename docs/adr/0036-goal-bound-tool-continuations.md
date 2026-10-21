# 0036 绑定原目标与初始目录的子任务工具续接

状态：proposed，2026-10-21。Profile：`huawei_ict_agentarts`。

默认 Desktop 公开鹈鹕验收暴露旧续接的限制：工具结果送回云端后，旧协议及提示只允许
汇总该结果，不能完成仍需预览、应用和检查的用户目标。不得把单次读取或父子任务的
`succeeded` 当作修复完成。

在既有 `continuationContext: 'goal'` 显式选择下，已验证的实际子 worker 可以携带
`continuation`、原 `goal`、初始 `availableTools` 及已有 `priorContinuations`，继续提出一个
必要工具动作。普通父对话的委派结果保持汇总路径，防止循环派发。旧 receipt-only、
goal-without-catalog、repair 专用协议与旧配置 hash 保持原语义；repairContext 不与工具目录混用。

目录保存于原 Runtime 检查点，不因新工具注册或 readiness 变化扩容。审批可以推进原任务
revision；每次续发前仍重新检查同版本描述、Schema、readiness、worker、任务期限及原目录。
凭据读取后的最终校验覆盖 HTTPS 与 WSS。来源撤权、目录漂移、取消或 unknown 都不能
通过重建请求绕过，未知写入仍先核实。64 项/24576 UTF-8 字节目录、1.1 MB 总请求及
现有步骤、token、deadline 预算不增加。

AgentArts owned 提示版本为 `owned-1.8`：只有带原目标及目录的续接可继续提案；已确认
命令回执不提前结束更大的用户目标。工具结果仍是不可信数据，目录不是授权，所有提案
继续由原 Runtime/Policy/ToolGateway 检查与执行。

本变更没有新数据库或依赖，也不自动发布新云版本或修改用户的部署 pin。旧部署对新形状
的支持需要独立验证；当前源码及显式 Fake 多步回归不能算新协议已在真实云端部署验收。

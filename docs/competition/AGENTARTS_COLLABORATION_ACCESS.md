# AgentArts 协作接入核查

核查时间：2026-10-15 15:36 UTC；目标为当前 Competition Profile、西南-贵阳一租户。本文使用 collaborator-A/B，真实账号映射仅保存在项目忽略缓存，不包含密码、密钥或私人账号标识。

## 当前结果

两位协作者尚未加入、未发出邀请、未验证实际访问。此次仅执行官方文档及控制台只读核查，没有创建用户、赋予权限、修改现有策略、购买席位或更改运行中服务。

用户已明确同等权限的边界：仅 PersonalAgent 的 AgentArts 项目及关联资源，包含查看、编辑、部署、调用、调试、日志和评估管理，不包括全云账号、其他项目或 IAM 管理。当前操作者确属 IAM 预置 `admin` 组，授权记录为所有操作权限；该组超出上述边界，不作为协作者授权方案。

| 检查项 | 实际观察 | 可证明的边界 |
| --- | --- | --- |
| 目标身份 | 用户提供两个账号名称形式的标识 | 不能仅凭名称前缀断言是主账号或 IAM 用户；当前登录成员也有同类前缀，平台类型却显示 IAM 用户 |
| 当前租户 IAM | 旧版与新版目录均显示总计 2 名用户：管理员映射用户、现有服务用户 | collaborator-A/B 不在当前租户 IAM 用户目录；不证明其在华为云不存在 |
| AgentArts 成员许可 | 页面显示“成员数量 2”“已许可 1”“待分配许可 0”“已禁止 0”，列表仅当前登录成员 | 有席位机制；不能把页面数量或无待分配记录解释为两位已获得许可。两人新增是否超套餐须按实际席位再核实 |
| 可见入口 | 成员许可提供 IAM 用户管理、许可管理；智能体管理提供单智能体/工作流/多智能体 | 未发现当前区域按外部账号名邀请为低权限开发者的表单；未提交邀请 |

“成员数量 2”的具体计量含义未由当前页面文字或已核文档解释清楚，本轮不将其定性为已存在用户数或套餐可许可上限。实际可增加人数、当前适用套餐及新增席位价格均未验证；IAM 目录的 2 名用户是另一独立统计，不与该数值混同。

## 官方机制与地域差异

现版文档说明 AgentArts 按租户隔离资源，创建的 IAM 用户还需获得相应权限。成员首次登录后才进入许可列表并占用可用席位。成员许可不是跨账号邀请入口。[成员与权限控制](https://support.huaweicloud.com/resources-members-agentarts/agentarts_15_0002.html)、[IAM 授权](https://support.huaweicloud.com/resources-members-agentarts/agentarts_15_0003.html)、[许可管理](https://support.huaweicloud.com/resources-members-agentarts/agentarts_15_0004.html)。

上述三份现版页面标注更新时间均为 2026-09-14；实际控制台核查区域为西南-贵阳一（cn-southwest-2），不能直接采用其他区域或旧套餐的成员数、价格。

华北-北京四旧版文档存在团队空间和开发工程师角色，但添加成员的前提是已在该租户创建 IAM 用户。该文档不能证明当前西南租户可直接邀请外部账号；本次没有切换区域、迁移资产或创建空间。[团队空间成员](https://support.huaweicloud.com/usermanual-agentarts0/agentarts_05_0216.html)。

## 最少继续条件

1. 确认两位协作者的账号类型与归属租户；当前名称不足以作为本租户 IAM 身份。不要在聊天中提供密码、密钥或登录验证码。
2. 如采用本租户身份，需要为两位建立可独立登录且由本人认领的 IAM 身份，并通过安全流程完成初始凭据；这不是把同名外部华为账号直接转换为子用户。具体缺项是可验证的本租户 IAM 身份，或用于正式入驻、本人认领的接收身份；不能用现有两个外部名称创建同名用户后宣称已关联本人。项目范围已明确，无需再询问是否授予全云管理员。
3. 在新增两位之前核准实际席位；若要求新增付费套餐，需具体授权，不能以当前核查替代购买许可。
4. 身份与权限就绪后，由协作者本人登录；再读回成员许可和实际开发资源访问结果。保存用户、授权或邀请记录均不等于对方已实际访问。

## 项目范围授权接线

目标 Runtime 为 `9a65747e-05f0-475c-a2dc-f24dd3ed87ae`，版本为 `arm64-local-v3-244ca434`。这里的“PersonalAgent 项目”是用户定义的资源集合，尚未证实等同于平台可直接授权的独立团队空间或 IAM 项目；不能把区域级授权自动写成只覆盖该项目。

官方 IAM 入门示例使用 `AgentArtsFullAccessPolicy`、`AgentIdentityFullAccessPolicy` 并列出网络及委托依赖，不能直接当作上述资源集合的最小权限。运行时授权参考则明确列出 `agentarts:runtime:showCoreRuntime`、`updateCoreRuntime`、`listCoreRuntimeVersions` 及 RuntimeEndpoint 操作的资源类型，部分操作支持资源标签条件；这为资源级自定义策略提供依据，尚不是已验证的完整策略。[运行时授权参考](https://support.huaweicloud.com/api-agentarts/Permission2.html)、[更新运行时及依赖](https://support.huaweicloud.com/api-agentarts/UpdateCoreRuntime.html)。

最小执行路线是先认领两位本租户身份，再按当前绑定分别核定 Runtime/Endpoint、模型代理及身份、评估对象、日志和镜像仓库的资源范围，生成专用用户组与自定义策略。保留现有部署委托，不复制全云 admin；`iam:agencies:pass` 等部署依赖也须限定现有委托，而不是授予 IAM 管理。当前 defaultgw 与日志流存在共享资源，不能把共享网关编辑或整个日志流读取声称为只影响/只展示 PersonalAgent。各服务精确 URN、列表操作可否限域、评估和共享日志的完整隔离能力仍待核实；本轮不保存猜测策略、不授予全资源权限。[观测授权参考](https://support.huaweicloud.com/api-agentarts/Permission3.html)、[评估授权参考](https://support.huaweicloud.com/api-agentarts/Permission4.html)。

运行时调用还受数据面入站鉴权约束。控制面 IAM 授权不代表已有 Runtime APIKey/WSS 凭据可直接共享；需按现有入站机制为协作者建立合规访问，随后以本人会话验证调用，不公开或复制当前宿主密钥。[运行时调用](https://support.huaweicloud.com/api-agentarts/InvokeRuntime.html)。

脱敏证据：[agentarts-collaboration-access-20261015.json](evidence/agentarts-collaboration-access-20261015.json)。本轮未产生权限或数据迁移，也没有改动模型、代理、Runtime、SWR 或现有 IAM 策略。

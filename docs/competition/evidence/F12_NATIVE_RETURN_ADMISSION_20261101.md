# F12 可信归来提交入口

当前 `task.submit` 只提交自然语言目标，不能保证一次明确的归来按钮请求选择 F12 及原通知项。本增量在原 Runtime 增加仅供受信 Main 使用的 `submitF12ReturnDigestTask`：原子绑定固定 F12 工具、精确参数、原对话/期限、配置和幂等键；沿原强制 user-work 子任务与 Competition 循环提出第一次固定提案。随后仍由原 configured worker、原图、Policy、出口卡和真实宿主执行。Main 不写 competition-loop，不创建新执行器、调度器或数据库，不把指令 JSON 交模型猜测。

只有原按钮 control 成功、原来源标记复核后才提交；每个原通知 scope 单独一项任务，选取原 `on_return` 摘要的有效未读项。重复命令只读原任务；请求或配置替换拒绝，未知不换键重提。完成摘要仅允许原图的确认回执，模型不能跳过图、换图或追加工具。旧普通任务、原 wire Schema 与数据库迁移不变；新增检查点仅属于新入口任务。

Main 已在原可信 panel/admin 的 `control(return)` 成功后读回当前 session/revision，交同一个来源 provider 和固定提交控制器；原 return 命令 checkpoint 冻结每个通知 scope 的选择与期限。重复按钮请求沿公开只读方法返回原任务，不重采队列后换键。原图仍按 Policy 校验来源/未读/策略，旧 control 变更后拒绝。归来控制已确认但摘要准入未确认时，界面分别显示其状态，不能把受理当摘要完成。

实际双 Engine、SQLite、Runtime、Policy、原 F12 端口、原 Main 分支和 UI 定向共 116/116 通过，零跳过（`.cache/integration-f12-native-main-chain.log`）；AgentArts/Runtime 构建通过。覆盖固定图先于云摘要、准确多 scope 入队、重复读回、参数/期限替换、缺按钮标记、云尝试换图、来源变化、原审批拒绝及普通子任务兼容。初轮新入口跳过了普通首次云调用的配置绑定，原 continuation 正确拒绝；现像原 F15 路径一样在 Runtime 首提案前保存原 Competition 配置，不允许换部署。失败保留在诊断日志，不放宽缺配置检查。

图 image/候选/审批响应与按钮动作均为显式 Fixture，未证明真人按钮操作、AgentArts 平台部署或物理语音完成。完整最新 check、固定云整图及真实设备缺口仍保留。

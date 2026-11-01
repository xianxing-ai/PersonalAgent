# F25 原账户与数据范围接线（2026-11-01）

Profile：`huawei_ict_agentarts`。隔离工作树 `.worktrees/pr531-f25`，基线 `7d7dd062`。本包接入已有 AgentArts 加密账户与 Knowledge 来源，不新增账户库、授权层或执行循环。

## 实际链与边界

`workflow.f25.configure_data_scope@1.0.0` 请求为 `{}`，只消费本机设置中已暂存的原账户/来源范围提案。原 F25 图推进 N01 输入 → N02 有限候选 → N03 实际出站目录检查 → N04 保存与读回。N02 只能选择受信提案的允许/禁止分类，模型不能提供命令、凭据、源路径、查询词或新的权限。

设置暂存并不修改 Knowledge 权限。N04 经原 ToolGateway/Policy 后调用原 `KnowledgeSourceConfig.configure`；需要公开目录或写入许可时仍进入原 `knowledge.configure` AuthorizationIntent/Question。既有写权限、目录、sourceId 保留，不借图授权增加权限。原期限/取消贯穿此确认，确认后、实际修改前同步复核。原配置保存使旧租约失效；随后精确读回源 revision 和实际范围，未知保存保留原尝试，不重做。

N03 直接读取真实 Knowledge host 的 displayName、允许笔记路径和公开查询构成的原目录载荷，并读取原 dataLevel/cloudExportAllowed，不接受模型 `testPayloadContainsPrivate:false` 为证明。载荷只在本机检查，N03 checkpoint 继续仅保存摘要和结论。初始/N01、判断、host 回执和最终结果只携带引用、digest、数量、分类与状态；查询词、文件名、根路径和凭据不发云。

本包新增 provisional 结果 Schema，版本由 worker `configurationVersion:'f25-original-knowledge-scope-v1'` 及两个原节点 descriptor 公布。`saved:true` 表示原配置实际保存且读回匹配；`pingConnected:'unverified'`、`capabilityTested:'unverified'`、`accountActive:'unverified'` 明确不代表做过探测。`privateDataBlocked` 仅描述当前被选来源的范围，不能当作整个系统或所有账户的隐私证明。此工厂不宣称其他连接器账户或真实 AgentArts 联通已验收。

## Main 固定 API

文件 `apps/desktop/electron/f25-configuration-host.js`：

```js
const configuration = createDesktopF25Configuration({
  userData, safeStorage,
  getAgentArtsConfig: () => agentArtsConfig,
  getKnowledgeSourceConfig: () => knowledgeSourceConfig
});
const f25 = createDesktopF25WorkflowWorkerPorts({
  getApplication: () => runtimeApplication,
  configuration,
  authorizeExport: request => authorizeOwnedWorkflowExport(request)
});
```

- 工厂返回 `{tools,configuredWorkflowWorkerPorts,unavailable}`；2 tools：`workflow.host.f25_n03/n04`；1 worker：`workflow.f25.configure_data_scope`。使用同一个 owned image；有限判断继续用既有 `decision.choose_candidate` 和 configured-workflow 原卡准备。不要重复注册旧可选 N03。
- 原 admin-only 设置入口调用 `configuration.configure({expectedRevision,dataLevel:'private'|'public',cloudExportAllowed,publicQueries})`。只暂存，PUBLIC 且开启导出时需要非空查询列表，最多 16 条，每条 128 字。模型/普通工具不接受这些参数。
- `snapshot()` 为 `{configured,revision,stage:'selected'|'saved',sourceId,dataLevel,cloudExportAllowed,accountConfigured,pingConnected:'unverified',capabilityTested:'unverified'}`，未配置 revision 为 0。不返回路径或查询词。退出调用 `close()`。
- `authorizeExport` 复用原精确出口确认，收到原 `{taskId,workflowId:'F25',stage,value,deadline,signal,...}`，不得提供恒真生产替身。
- **必要现有回调窄接点**：创建 KnowledgeSourceConfig 时，`confirmPermissions` 接收第二个可选 `control` 参数：

```js
confirmPermissions: async (details, control = {}) => {
  const {isCurrent, ...payload} = details;
  return confirmApplicationAuthorization('knowledge.configure', payload, {
    scope: {sourceId: details.sourceId, configRevision: details.configRevision},
    summary: /* 保留原摘要 */, isCurrent, ...control
  });
}
```

`control` 只有原 `deadline/signal`，不能进入 payload；它令原 pending Intent 随 N04 取消/超时停止。旧 `configure(input)` 和一参数 confirmPermissions 调用兼容。新的 `configure(input,{assertCurrent,deadline,signal})` 不签发授权。

AgentArtsConfig 的 `readCredentialReference()` 返回随机不透明引用，不从凭据派生。原 version 1 envelope 可选新增 `reference`，旧文件和旧读取方兼容；新保存保留此引用，账户/目的地重新配置产生新引用。旧文件首次在内存产生引用，未重新保存前跨重启会要求重新选择 F25 提案，拒绝采用过期绑定。Knowledge 新增 `readDataScopeConfiguration()` 只读原实际范围，F25 不根据 UI 猜测权限。

## 唯一必要用例

`npm run build` 通过；三份 Desktop 模块语法检查及 `git diff --check` 通过。没有重跑根已有 N03 两项或完整 suite。

`node --test apps/desktop/test/f25-configuration-workflow.test.mjs`：1/1 通过、0 跳过，核心用例 1395ms。真实文件/知识源、AgentArts 配置宿主、Engine、原 Intent/Question、Runtime、Policy、SQLite。验证设置暂存不改变源；实际图经过 N03/N04；原独立知识范围 Intent 收到相同期限/取消信号；源 revision 只增加一次；实际保存仍不把账号状态标为已测；所有导出及镜像请求不含私有文件名、查询词和账户凭据；N03 checkpoint 不含载荷正文。日志 `.cache/build-f25.log`、`.cache/test-f25.log`。

safeStorage 加密、账户凭据、候选/选择器、用户批准和出口确认均明确 Fixture；未做网络请求或真实人类批准。本包不修改 Main/UI；组合、实际 UI 与真实平台验收由根工作包继续，不据此将 #531 标为完成。

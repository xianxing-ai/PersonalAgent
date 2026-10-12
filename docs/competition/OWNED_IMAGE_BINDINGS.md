# 自有镜像：8 个 Workflow 与 3 个 Controller 绑定

日期：2026-10-12；Profile `huawei_ict_agentarts`；本分支接口为 provisional。
源码绑定、镜像构建/发布和真实华为部署是分别验收的结果。决定见 [ADR-0015](../adr/0015-owned-workflow-controller-bindings.md)。

## 已发布预览与使用入口（2026-10-12）

镜像源码固定为 `0dae0ff5c1553b855825a29934b22270b675bb48`，仍在
[PR #317](https://github.com/zemeng5208/PersonalAgent/pull/317) 中，尚未合并。
后续文档提交不改变这个镜像的源码版本。
[GitHub 预览 Release](https://github.com/zemeng5208/PersonalAgent/releases/tag/agentarts-preview-0dae0ff5)
提供 AMD64/ARM64 离线 tar、该源码版本的设计与接口包、`SHA256SUMS.txt` 和 `VERIFICATION.json`。
所有五个附件均已读回 uploaded 状态，并核对大小及 SHA256。

优先按固定多架构索引拉取，Docker 按本机架构选择镜像：

```powershell
docker pull ghcr.io/zemeng5208/personal-agent-owned@sha256:82b7d1b0ac808ad89d2197b98871fd334084c88de9f56c016ffe29a75bd632dc
```

网络不便时下载对应架构 tar，先用 `Get-FileHash -Algorithm SHA256` 与 Release 校验文件比对，
再执行 `docker load -i <对应架构的tar路径>`。运行配置见
[Runtime README](../../apps/agentarts-runtime/README.md)；真实模型入口、模型名和宿主凭据由部署方注入，
不会随镜像提供。华为部署使用 ARM64，部署流程仍单独验收。

- [预览发布 Actions](https://github.com/zemeng5208/PersonalAgent/actions/runs/38248749031) 已成功；
  [源码 PR Foundation](https://github.com/zemeng5208/PersonalAgent/actions/runs/38248819016) 已成功。
- 源码的根 `npm run check`：2878 项，2860 通过、18 跳过、0 失败；Node24.15.0/npm11.12.1。
- 本地构建镜像与按固定 digest 拉取的发布镜像分别在 AMD64/ARM64 上运行
  `apps/agentarts-runtime/test/bindings.test.mjs`，四次均 9/9，非 root UID1000，`--network none`。
  测试使用实际编排核心和显式 Fake 模型；它证明绑定与边界行为，不证明真实 Provider 可用。
- 双架构镜像均读回相同源码 revision 和目录 SHA256：
  `7666fd39dc5e59eed5a9f3e4fe3beaa3d4e6fd4e143f7d39c042dda154364c24`。
- 匿名配置读取 GHCR 索引和 AMD64 拉取已通过。ARM64 首次匿名层下载发生网络超时，
  随后固定 digest 的注册表拉取及容器测试成功；保留原失败记录，不将首次拉取记为成功。
- 原云资源完整语义等价、真实 Huawei deployment、公网 WSS、真实模型/工具、trace、用量、费用和评估仍未验证。
  预览发布不满足整个 MOD 的完成条件，也不替代 goo122 与 Potatos498 当前 head 的本机阅读和审批。

## 绑定目录

目录由 `packages/agentarts/src/bindings.ts` 编译进入镜像中的 agentarts/dist，
不在启动时读取私密 Studio 导出。`getOwnedBindings()` 返回 id/name/type/roles/origin/requirements。

| 类型 | ID | 名称 | 实际调用 |
| --- | --- | --- | --- |
| workflow | `71f3004f-faba-4487-9e6f-996194ec2b3c` | PA-MVP-快速工具与答复 | fast；普通回答、目录约束提案、confirmed 总结 |
| workflow | `b74bbcd0-b8f6-4a73-b436-0676f952ac9a` | PA-MVP-确定性意图 | 明确检查/构建/测试意图的零模型提案及命令回执总结 |
| workflow | `7d06153e-6262-4679-86ae-1914b38e11f3` | PA-世界状态影响分析 | 单次 world，返回重新校验的角色报告 |
| workflow | `ed2363d9-b770-4ce5-a988-9bf0903466f7` | PA-计划最小修复 | 重验 World 后单次 plan |
| workflow | `65236810-db21-41cb-928b-39af691c4cfa` | PA-计划最小修复_1 | 重验 World 后单次 plan，沿原初始/继续输入语义 |
| workflow | `998031d7-ec28-40ed-83e6-96667f22ff51` | PA-证据安全审查 | 重验 World/Plan 后单次 review 与候选一致性检查 |
| workflow | `8004735c-cac6-4c09-9691-1a93233475ac` | PA-证据安全审查_1 | 独立绑定调用同一受限 review 实现 |
| workflow | `81bc9eb8-cf6a-4869-a1a2-e3b446349447` | PA-MVP-受限主路由 | 原完整路由；普通 fast，修复 world→plan→review |
| controller | `32d4d44c-eade-4f3f-8f76-209c74609e79` | PersonalAgent持续认知协调器 | 仅合法修复输入，固定链，KEEP/RECHECK 提前停止 |
| controller | `2f5d361c-bd85-4d2f-9903-bb35d4f55afa` | PersonalAgent持续认知协调器_1 | 普通/修复的固定主路由，只执行一次 |
| controller | `ae641e4a-1524-4435-a132-c58fb13e288d` | PersonalAgent-MVP协调器 | 新增 owned 主路由；原云导出为空绑定，origin 为 new-owned-binding |

共享实现不意味着原提示词、历史、模型配置或平台原生 Controller 已逐字/行为等价。
原始导出和迁移不足继续见 [迁移矩阵](../modules/AGENTARTS-OWNED-IMAGE-PARITY.md)。

## HTTP/WS 发现与调用

`GET /bindings` 需要配置的 WSS/宿主凭据（`PA_AGENT_WSS_AUTH_TOKEN` 缺省继承 `PA_AGENT_INBOUND_TOKEN`）：
`X-PA-Agent-Token: Bearer <独立宿主凭据>`。未配置不会开放目录。
不返回模型端点、密钥、私人来源、工具账号或部署中的个人数据。

绑定调用通过原 `POST /invocations` 的 `query` 字符串传入；
WS 沿原 invoke 信封的 `payload.query` 传入同一 JSON 文本。原身份、payloadDigest、
deadline、认证、共享并发、取消和未知结果规则保持。没有独立重试执行链。

镜像专用信封：

```json
{
  "bindingVersion": "1.0.0",
  "type": "workflow",
  "id": "71f3004f-faba-4487-9e6f-996194ec2b3c",
  "query": "你好"
}
```

HTTP 外层是 `{query: JSON.stringify(上面的信封)}`。使用标准 JSON 序列化，
不要手工拼接用户内容。普通旧 query 不需要此信封。
只使用目录中的精确 ID/type；未知版本、资源、字段和非法前置报告明确拒绝。

包调用示例（变量中的控制信息由可信宿主提供）：

```javascript
const result = await orchestrator.invokeWorkflow({
  ...invocation,
  workflowId: '71f3004f-faba-4487-9e6f-996194ec2b3c'
});
const controlled = await orchestrator.invokeController({
  ...invocation,
  controllerId: '2f5d361c-bd85-4d2f-9903-bb35d4f55afa'
});
```

World 输入必须是原 `parseAgentInput/repairInput` 支持的来源投影；普通聊天不能伪装来源。
Plan 的信封增加 `world`，Review 增加 `world` 和 `plan`，值为前阶段 `result.value`，
不是完整响应 wrapper。各阶段按当前调用的宿主投影重新核验来源、范围和版本。
KEEP/RECHECK 不允许绕过条件进入确定修复。
前置报告的 JSON 字符上限沿用核心的16,000 UTF-16单位；总请求仍受UTF-8字节限额。
中文报告按相同字符预算传递，不因UTF-8编码占用更大而在下一阶段额外拒绝。

## 结果隔离与默认 Controller

每次显式绑定结果为：

```json
{
  "bindingVersion": "1.0.0",
  "binding": {"id": "资源ID", "name": "资源名", "type": "workflow", "origin": "migrated"},
  "verification": "unverified",
  "result": {"kind": "application_result", "value": {"kind": "text", "text": "答复"}}
}
```

World/Plan 的 result 是 `{kind:'role_report',role:'world'|'plan',value:报告}`。
这些报告不能进入旧 CoordinationResult 执行链，也不能成为授权或 Evidence。
Review/Controller 的 application_result.value 仍是原 text/tool_proposal/repair_candidate1.0 子集，
需要本地 Runtime 的独立解析、Policy、预览、CAS、执行和读回。

受信启动可配置 `PA_AGENT_DEFAULT_CONTROLLER_ID` 为目录中的 Controller ID。
普通旧调用通过该固定 Controller，并仅将 application_result 解包供旧客户端消费；
未配置保留现有路由。非法默认 ID 必须启动失败。
所有 role 仍通过当前 ModelGateway；模型端点、模型名和凭据由运行时注入，不写入镜像。

## 所有本机工具的接入方式

镜像不建立第二套连接器注册表。所有已公布工具经当前宿主 `availableTools` 目录接入，
逐字 name/version 和 inputSchema 校验，包括受限工作区、知识、MCP/Skills、业务和委派工具。
目录上限沿用 64 项及 24,576 UTF-8 bytes，初始 query 上限沿用现有解析器；超限明确失败，
不截断目录、不把未公布能力伪装成可用。

确定性意图只识别明确单一检查/构建/测试：优先使用目录中的空参数
workspace.node_check/npm_build/npm_test 封装，或 Schema 明确允许的 run_allowed_command recipeId。
参数不符合当前 Schema、目录缺失、复合/含糊意图均不猜测工具。执行和外发仍由本机授权。
confirmed 命令回执只消费原 recipeId/exitCode/passed 摘要，不要求或上传 stdout/stderr。

## 明确保留的接入条件

- 本机 TaskRuntime、私人 Wiki/数据库、授权和凭据不迁入云镜像。
- 平台 History、Studio 插件私有状态及外部账号配置需要对应公开端口和用户授权。
- 删除计划、新节点、新工具动作超出现有候选1.0；绑定入口不会开放这些操作。
- 云实例回执仍是内存级，restartRecovery:false；未知副作用仍须本机核实。
- 本轮测试/容器结果、发布 source SHA/digest 与真实 Huawei 验收分别记录，不相互代替。

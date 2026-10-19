> 2026-10-18 归档范围：historical_claim / not_reverified。下文评分与验证结论属于原固定版本的历史自述；本轮未重跑旧 runner，不代表当前 Competition、真实云/设备或 24 例现行可运行。个人绝对路径已脱敏、历史源码链接已版本化；不是原字节副本。当前 Competition 不调用 Laya。详见 [归档说明](README.md)。

# 自有镜像 Workflow 与 Controller 调用方式及验收矩阵

> 文档位置：`docs/modules/OWNED-IMAGE-BINDING-ACCEPTANCE-MATRIX.md`
> 目标分支：`codex/agentarts-owned-image`
> 源码基线：`origin/main@e86bac53` · 当前 HEAD：`0dae0ff5c1553b855825a29934b22270b675bb48`
> 关联规范：[ADR-0015](https://github.com/zemeng5208/PersonalAgent/blob/0dae0ff5c1553b855825a29934b22270b675bb48/docs/adr/0015-owned-workflow-controller-bindings.md) · [绑定接口规范](https://github.com/zemeng5208/PersonalAgent/blob/0dae0ff5c1553b855825a29934b22270b675bb48/docs/competition/OWNED_IMAGE_BINDINGS.md) · [迁移清单](https://github.com/zemeng5208/PersonalAgent/blob/0dae0ff5c1553b855825a29934b22270b675bb48/docs/modules/AGENTARTS-OWNED-IMAGE-MIGRATION.md) · [迁移差距矩阵](https://github.com/zemeng5208/PersonalAgent/blob/0dae0ff5c1553b855825a29934b22270b675bb48/docs/modules/AGENTARTS-OWNED-IMAGE-PARITY.md)

---

## 1. 协作基线与四层验证边界核对

### 1.1 分支与 HEAD 基线记录
- **项目路径**：`historical-worktrees/agentarts-owned-image`
- **目标分支**：`codex/agentarts-owned-image`
- **同步基线**：`origin/main@e86bac53`
- **本轮绑定源码 HEAD**：`0dae0ff5c1553b855825a29934b22270b675bb48`（提交信息：`feat(agentarts): bind all owned workflows and controllers`）
- **协作者保护与约束执行**：本工作树处于多人协作状态，严格保留他人未提交修改与历史记录。本文档为本轮唯一可编辑文件，严禁修改生产代码、生成类型、锁文件或其他历史文档，不执行提交、推送或分支合并。

### 1.2 证据链与四层验证边界（严禁互相替代）
1. **源码可调用（Source-callable）**：✅ **已通过**。`packages/agentarts` 与 `apps/agentarts-runtime` 核心实现已完成，通过 `node:test` 单元测试与集成测试（涵盖全部 11 个资源的真实核心 HTTP 分派、内部报告隔离校验及边界测试）。
2. **镜像包含（Image-included）**：
   - **本地离线容器验证**：✅ **已通过**。在本地 Linux 容器环境中，基于源码 `0dae0ff5` 生成的 allowlist 上下文构建 AMD64 与 ARM64 双架构镜像；在 `--network none` 隔离环境下运行生产入口离线合成 TLS 回环检查（`test/production-transport.mjs`），两架构均实现 **9/9 请求通过**（健康检查、认证拦截、普通答复、工具提案、confirmed 续答、World→Plan→Review 认知链、非法模型输出校验、脱敏提供者错误拦截、期限与安全退出）。运行用户严格限定为非 root 用户 `node`（UID 1000），OCI revision 与源码 HEAD 一致。
   - **发布镜像独立容器验证**：🔄 **验证中（In Progress）**。GitHub Actions (`owned-image-preview.yml`) 构建的多架构预览镜像已向 GitHub Packages (GHCR) 发布（标签 `ghcr.io/zemeng5208/personal-agent-owned:sha-0dae0ff5c1553b855825a29934b22270b675bb48`）；但对该远端发布镜像的独立匿名拉取、载入及容器内黑盒验证尚在进行中，**不提前标记为通过**。
3. **平台部署（Platform-deployed）**：⚠️ **待验（Pending）**。华为云 SWR 导入、AgentArts 托管运行时创建、前缀网关路由映射与公网 WSS Upgrade 协议握手仍待实际环境验收。
4. **真实工具闭环（Real tool closed-loop）**：⚠️ **待验（Pending）**。接入真实付费大模型（如 `deepseek-v4-flash`）、真实环境工具命令执行、本地 Policy 审批与 SQLite 持久化及 ExecutionEvidence 真实读回仍待业务链路验收。

---

## 2. 凭据继承体系与协议信封规范

### 2.1 凭据继承机制核对
根据 [`apps/agentarts-runtime/src/server.mjs`](https://github.com/zemeng5208/PersonalAgent/blob/0dae0ff5c1553b855825a29934b22270b675bb48/apps/agentarts-runtime/src/server.mjs#L25) 与 [`apps/agentarts-runtime/README.md`](https://github.com/zemeng5208/PersonalAgent/blob/0dae0ff5c1553b855825a29934b22270b675bb48/apps/agentarts-runtime/README.md#L27-L29)：
```javascript
export function createAgentServer({orchestrator, mode, authToken, wssAuthToken = authToken, ...})
```
- **配置项定义**：
  - `PA_AGENT_INBOUND_TOKEN`：外部平台入站 Token（至少 32 字符，用于平台 HTTPS 调用）。
  - `PA_AGENT_WSS_AUTH_TOKEN`：可信宿主注入的入站 WSS、状态查询及绑定专属 Token（至少 32 字符）。
- **继承与可用性规则**：
  1. **显式配置双 Token**：当 `PA_AGENT_WSS_AUTH_TOKEN` 与 `PA_AGENT_INBOUND_TOKEN` 均配置且值不同时，绑定专属发现接口（`GET /bindings`）、WebSocket Upgrade（`GET /ws`）及显式绑定调用必须使用 `PA_AGENT_WSS_AUTH_TOKEN`（请求头 `X-PA-Agent-Token: Bearer $PA_AGENT_WSS_AUTH_TOKEN`）。仅携带外部平台 token 会被严格拦截（`401 UNAUTHORIZED`）。
  2. **单 Token 自动继承**：当**未设置** `PA_AGENT_WSS_AUTH_TOKEN`，但配置了 `PA_AGENT_INBOUND_TOKEN` 时，`wssAuthToken` 会**自动缺省继承** `authToken`（即 `PA_AGENT_INBOUND_TOKEN`）。此时客户端提供 `X-PA-Agent-Token: Bearer $PA_AGENT_INBOUND_TOKEN` 或 `Authorization: Bearer $PA_AGENT_INBOUND_TOKEN` 即可正常访问 `/bindings`、`/ws` 及显式绑定。
  3. **双 Token 均缺失**：**只有当两者都缺失时**，`wssAuthToken` 才为 `undefined`。此时 `/bindings` 返回 `503 UNSUPPORTED_CAPABILITY`，`/ws` 返回 `503 Service Unavailable`，显式绑定调用返回 `401 UNAUTHORIZED`（错误信息：`Owned binding credential required`）。

### 2.2 统一调用信封与白名单限制
镜像专用信封作为外层 `payload.query` 传入：
```json
{
  "bindingVersion": "1.0.0",
  "type": "workflow",
  "id": "71f3004f-faba-4487-9e6f-996194ec2b3c",
  "query": "{\"goal\":\"...\"}"
}
```
- **白名单限制**：字段仅允许 `['bindingVersion', 'type', 'id', 'query', 'world', 'plan']`，传入任何额外字段（如 `grant: true`）直接抛出 `400 INVALID_ARGUMENT`。
- **版本限制**：`bindingVersion` 必须等于 `"1.0.0"`，否则抛出 `400 INVALID_ARGUMENT`。
- **字符与字节双重限额**：
  - 前置报告：`world` 与 `plan` 在核心层经 `reportCopy` 施行 `JSON.stringify(report).length <= 16,000` UTF-16 字符限制（中文字符预算充裕，不因 UTF-8 编码字节膨胀而误拦截）。
  - 请求报文：外层整体请求体受 1,200,000 UTF-8 字节限制。

### 2.3 `application_result` 与 `role_report` 的本质区别
调用输出统一包装在信封中：
```json
{
  "bindingVersion": "1.0.0",
  "binding": { "id": "...", "name": "...", "type": "...", "origin": "..." },
  "verification": "unverified",
  "result": { ... }
}
```
内部 `result` 具有互斥的两种形态：
1. **`application_result`**：
   - 结构：`{"kind": "application_result", "value": AgentOutput}`，其中 `value.kind` 为 `text`、`tool_proposal` 或 `repair_candidate`（1.0 契约子集）。
   - 适用范围：所有 3 个 Controller，以及多角色/审查/快速工作流（W1, W2, W6, W7, W8）。
   - 语义：属于业务终态输出，但云端标记始终为 `unverified`，必须经过本地 Policy 审批、CAS 校验与实际执行读回。
2. **`role_report`**：
   - 结构：`{"kind": "role_report", "role": "world" | "plan", "value": ReportObject}`。
   - 适用范围：**严格限定于单阶段的 `world` 或 `plan` 工作流**（W3, W4, W5）。
   - 语义：**纯内部阶段性分析报告，绝非执行候选，绝无执行授权，严禁直接作为旧公共候选提交执行**。若默认 Controller 返回了 `role_report`，运行时会强制抛出 `EXTERNAL_FAILURE`（HTTP 502）。

---

## 3. 标准宿主投影与报告基线定义

为了保证调用示例完全符合 [`packages/agentarts/src/input.ts`](https://github.com/zemeng5208/PersonalAgent/blob/0dae0ff5c1553b855825a29934b22270b675bb48/packages/agentarts/src/input.ts) 与 [`packages/agentarts/src/index.ts`](https://github.com/zemeng5208/PersonalAgent/blob/0dae0ff5c1553b855825a29934b22270b675bb48/packages/agentarts/src/index.ts) 的解析规范，以下定义经过实际测试验证的标准投影与报告对象：

### 3.1 标准合法修复输入投影（Repair Input Projection）
```json
{
  "continuation": {
    "proposalId": "owned-plan-preview-1",
    "state": "confirmed",
    "result": {
      "repairContext": {
        "expectedGraphRevision": 7,
        "targets": [
          {
            "node": { "id": "plan-node-1", "revision": 2 },
            "requestedSummary": "根据事实调整准备时间",
            "requestedDependencies": [{ "id": "fact-node-1", "revision": 3 }]
          }
        ],
        "allowedDependencies": [{ "id": "fact-node-1", "revision": 3 }]
      }
    }
  }
}
```

### 3.2 标准合法前置 World 报告（Compact 格式）
根据 `index.ts` 源码，compact World 报告严格由 `disposition`、`affected`、`reason`、`missing_information` 四个键组成（**版本化 1.1 报告才使用 `recommended_disposition`，且绝不能包含 `disposition`**）：
```json
{
  "disposition": "REVISE",
  "affected": ["plan-node-1"],
  "reason": "已观察到事实依赖版本变更",
  "missing_information": []
}
```

### 3.3 标准合法前置 Plan 报告（Compact 格式）
根据 `index.ts` 源码，compact Plan 报告严格由 `disposition`、`changes`、`missing_information` 三个键组成：
```json
{
  "disposition": "REVISE",
  "changes": [
    {
      "node": { "id": "plan-node-1", "revision": 2 },
      "summary": "根据事实调整准备时间",
      "reason": "已观察到事实依赖版本变更",
      "dependencies": [{ "id": "fact-node-1", "revision": 3 }]
    }
  ],
  "missing_information": []
}
```

---

## 4. 8 个 Workflow 调用规范与验收清单

---

### W1: PA-MVP-快速工具与答复
- **资源 ID**：`71f3004f-faba-4487-9e6f-996194ec2b3c`
- **资源类型**：`workflow`
- **代码来源**：`migrated`
- **实际执行角色**：`fast`（提示词为 `FAST_PROMPT + DISPATCH_PROMPT` 或目标分析提示词）
- **必需输入**：普通输入（`ordinary_input`），支持自然语言文本、带工具目录的 `{goal, availableTools}`，或工具确认回执 `{continuation}`。
- **前置报告要求**：**严禁携带** `world` 或 `plan` 报告。
- **返回类型**：`application_result`（`value.kind` 为 `text` 或 `tool_proposal`）。

#### 调用示例（标准 JSON 序列化，无省略号）
- **HTTP 调用**：
  ```bash
  curl -X POST "http://$PA_AGENT_HOST:$PORT/invocations" \
    -H "Content-Type: application/json" \
    -H "X-PA-Agent-Token: Bearer $PA_AGENT_WSS_AUTH_TOKEN" \
    -H "X-HW-AgentArts-Session-Id: $PA_SESSION_ID" \
    -H "X-Request-Id: $PA_REQUEST_ID" \
    -H "X-PA-Deadline: $PA_DEADLINE" \
    -d '{"query":"{\"bindingVersion\":\"1.0.0\",\"type\":\"workflow\",\"id\":\"71f3004f-faba-4487-9e6f-996194ec2b3c\",\"query\":\"{\\\"goal\\\":\\\"测试工程\\\",\\\"availableTools\\\":[{\\\"name\\\":\\\"workspace.npm_test\\\",\\\"version\\\":\\\"1.0.0\\\",\\\"inputSchema\\\":{\\\"type\\\":\\\"object\\\",\\\"properties\\\":{},\\\"required\\\":[],\\\"additionalProperties\\\":false}}]}\"}"}'
  ```
- **WS 帧调用**：
  ```json
  {
    "protocolVersion": "0.1.0",
    "type": "invoke",
    "sessionId": "$PA_SESSION_ID",
    "requestId": "$PA_REQUEST_ID",
    "idempotencyKey": "$PA_IDEMPOTENCY_KEY",
    "payloadDigest": "$PA_PAYLOAD_SHA256",
    "deadline": "$PA_DEADLINE",
    "payload": {
      "query": "{\"bindingVersion\":\"1.0.0\",\"type\":\"workflow\",\"id\":\"71f3004f-faba-4487-9e6f-996194ec2b3c\",\"query\":\"{\\\"goal\\\":\\\"查询当前系统环境\\\",\\\"availableTools\\\":[]}\"}"
    }
  }
  ```

#### 验收用例
- **正常用例**：
  1. 初始自然语言请求：返回包含文本回答的 `application_result`。
  2. 带工具目录请求：模型在公布目录内返回严格匹配的 `tool_proposal`。
  3. 已确认执行回执：返回总结性 `text`。
- **失败用例**：
  1. 传入修复输入（`repair_input`）：拒绝并报错（`INVALID_ARGUMENT` / HTTP 400）。
  2. 携带 `world` 或 `plan` 报告：抛出 `Unexpected workflow role report`（HTTP 400）。
  3. 提案工具未在目录中公布：抛出 `UNSUPPORTED_CAPABILITY`（HTTP 503）。
  4. 模型输出包含伪造信任标记（如 `verification: verified`）：抛出 `EXTERNAL_FAILURE`（HTTP 502）。
- **已有测试覆盖**：
  - `packages/agentarts/test/bindings.test.mjs` -> `fast workflow makes only ordinary proposals and continuation answers`
  - `apps/agentarts-runtime/test/bindings.test.mjs` -> `all eight workflows and three controllers dispatch through actual core over HTTP`
- **未验证项**：真实大模型下的多轮对话上下文连贯性与复杂业务工具 Schema 解析。

---

### W2: PA-MVP-确定性意图
- **资源 ID**：`b74bbcd0-b8f6-4a73-b436-0676f952ac9a`
- **资源类型**：`workflow`
- **代码来源**：`migrated`
- **实际执行角色**：**零模型调用（纯核心代码路由）**。
- **必需输入**：单一支持的意图（“语法检查”、“构建”、“测试”），配合公布工具目录；或已确认的命令执行回执（`recipeId`: `node-check` / `npm-build` / `npm-test`）。
- **前置报告要求**：**严禁携带** `world` 或 `plan` 报告。
- **返回类型**：`application_result`（`value.kind` 为 `tool_proposal` 或 `text`）。

#### 调用示例（标准 JSON 序列化，无省略号）
- **HTTP 调用（命令工具提案）**：
  ```bash
  curl -X POST "http://$PA_AGENT_HOST:$PORT/invocations" \
    -H "Content-Type: application/json" \
    -H "X-PA-Agent-Token: Bearer $PA_AGENT_WSS_AUTH_TOKEN" \
    -H "X-HW-AgentArts-Session-Id: $PA_SESSION_ID" \
    -H "X-Request-Id: $PA_REQUEST_ID" \
    -H "X-PA-Deadline: $PA_DEADLINE" \
    -d '{"query":"{\"bindingVersion\":\"1.0.0\",\"type\":\"workflow\",\"id\":\"b74bbcd0-b8f6-4a73-b436-0676f952ac9a\",\"query\":\"{\\\"goal\\\":\\\"语法检查\\\",\\\"availableTools\\\":[{\\\"name\\\":\\\"workspace.node_check\\\",\\\"version\\\":\\\"1.0.0\\\",\\\"inputSchema\\\":{\\\"type\\\":\\\"object\\\",\\\"properties\\\":{},\\\"required\\\":[],\\\"additionalProperties\\\":false}}]}\"}"}'
  ```
- **WS 帧调用（已确认回执总结）**：
  ```json
  {
    "protocolVersion": "0.1.0",
    "type": "invoke",
    "sessionId": "$PA_SESSION_ID",
    "requestId": "$PA_REQUEST_ID",
    "idempotencyKey": "$PA_IDEMPOTENCY_KEY",
    "payloadDigest": "$PA_PAYLOAD_SHA256",
    "deadline": "$PA_DEADLINE",
    "payload": {
      "query": "{\"bindingVersion\":\"1.0.0\",\"type\":\"workflow\",\"id\":\"b74bbcd0-b8f6-4a73-b436-0676f952ac9a\",\"query\":\"{\\\"continuation\\\":{\\\"proposalId\\\":\\\"owned-check-1\\\",\\\"state\\\":\\\"confirmed\\\",\\\"result\\\":{\\\"recipeId\\\":\\\"node-check\\\",\\\"exitCode\\\":0,\\\"passed\\\":true}}}\"}"
    }
  }
  ```

#### 验收用例
- **正常用例**：
  1. 命中“语法检查”且公布对应空参工具：零模型生成以 `owned-` 开头且绑定 session/request 的 `tool_proposal`。
  2. 命中“测试”且公布受限 `workspace.run_allowed_command`（带 enum recipeId）：生成携带 `{recipeId: "npm-test"}` 的工具提案。
  3. 确认的命令回执：输出中文总结文本（“传入的已确认检查回执显示：语法检查通过，退出码 0。”）。
- **失败用例**：
  1. 意图模糊或复合意图（如“测试并构建”）：返回 `RECHECK` 纯文本，绝不猜测工具。
  2. 意图对应工具未公布或 Schema 扩充参数：返回 `RECHECK` 纯文本，不提出工具。
  3. 回执矛盾（`exitCode: 1` 却标 `passed: true`）：抛出 `INVALID_ARGUMENT`（HTTP 400）。
- **已有测试覆盖**：
  - `packages/agentarts/test/bindings.test.mjs` -> `deterministic intent proposes only published exact empty-argument wrappers, without any model`
  - `packages/agentarts/test/bindings.test.mjs` -> `deterministic confirmed failure is preserved...`
- **未验证项**：云镜像环境下真实命令执行链路（镜像内严禁直接执行宿主 Shell 命令）。

---

### W3: PA-世界状态影响分析
- **资源 ID**：`7d06153e-6262-4679-86ae-1914b38e11f3`
- **资源类型**：`workflow`
- **代码来源**：`migrated`
- **实际执行角色**：`world`（单角色执行，提示词为 `WORLD_PROMPT`）
- **必需输入**：合法修复输入（`repair_input`）。
- **前置报告要求**：**严禁携带** `world` 或 `plan` 报告。
- **返回类型**：**`role_report`**（`role: "world"`，值为经校验的 `WorldReport` 对象）。

#### 调用示例（标准 JSON 序列化，无省略号）
- **HTTP 调用**：
  ```bash
  curl -X POST "http://$PA_AGENT_HOST:$PORT/invocations" \
    -H "Content-Type: application/json" \
    -H "X-PA-Agent-Token: Bearer $PA_AGENT_WSS_AUTH_TOKEN" \
    -H "X-HW-AgentArts-Session-Id: $PA_SESSION_ID" \
    -H "X-Request-Id: $PA_REQUEST_ID" \
    -H "X-PA-Deadline: $PA_DEADLINE" \
    -d '{"query":"{\"bindingVersion\":\"1.0.0\",\"type\":\"workflow\",\"id\":\"7d06153e-6262-4679-86ae-1914b38e11f3\",\"query\":\"{\\\"continuation\\\":{\\\"proposalId\\\":\\\"owned-plan-preview-1\\\",\\\"state\\\":\\\"confirmed\\\",\\\"result\\\":{\\\"repairContext\\\":{\\\"expectedGraphRevision\\\":7,\\\"targets\\\":[{\\\"node\\\":{\\\"id\\\":\\\"plan-node-1\\\",\\\"revision\\\":2},\\\"requestedSummary\\\":\\\"根据事实调整准备时间\\\",\\\"requestedDependencies\\\":[{\\\"id\\\":\\\"fact-node-1\\\",\\\"revision\\\":3}]}],\\\"allowedDependencies\\\":[{\\\"id\\\":\\\"fact-node-1\\\",\\\"revision\\\":3}]}}}}\"}"}'
  ```
- **WS 帧调用**：
  ```json
  {
    "protocolVersion": "0.1.0",
    "type": "invoke",
    "sessionId": "$PA_SESSION_ID",
    "requestId": "$PA_REQUEST_ID",
    "idempotencyKey": "$PA_IDEMPOTENCY_KEY",
    "payloadDigest": "$PA_PAYLOAD_SHA256",
    "deadline": "$PA_DEADLINE",
    "payload": {
      "query": "{\"bindingVersion\":\"1.0.0\",\"type\":\"workflow\",\"id\":\"7d06153e-6262-4679-86ae-1914b38e11f3\",\"query\":\"{\\\"continuation\\\":{\\\"proposalId\\\":\\\"owned-plan-preview-1\\\",\\\"state\\\":\\\"confirmed\\\",\\\"result\\\":{\\\"repairContext\\\":{\\\"expectedGraphRevision\\\":7,\\\"targets\\\":[{\\\"node\\\":{\\\"id\\\":\\\"plan-node-1\\\",\\\"revision\\\":2},\\\"requestedSummary\\\":\\\"根据事实调整准备时间\\\",\\\"requestedDependencies\\\":[{\\\"id\\\":\\\"fact-node-1\\\",\\\"revision\\\":3}]}],\\\"allowedDependencies\\\":[{\\\"id\\\":\\\"fact-node-1\\\",\\\"revision\\\":3}]}}}}\"}"
    }
  }
  ```

#### 验收用例
- **正常用例**：
  1. 完整合法修复输入：单次调用 `world` 模型，返回经严格校验的 `role_report`。
- **失败用例**：
  1. 传入普通问答输入（非 repair）：抛出 `Repair input required by workflow`（HTTP 400）。
  2. 携带了 `world` 前置报告：抛出 `Unexpected workflow role report`（HTTP 400）。
  3. 模型输出中含有推断事实（`inferred`）却推荐 `REVISE`：抛出 `EXTERNAL_FAILURE`（HTTP 502）。
  4. 影响节点超出宿主 `targets` 范围：抛出 `EXTERNAL_FAILURE`（HTTP 502）。
- **已有测试覆盖**：
  - `packages/agentarts/test/bindings.test.mjs` -> `World workflow really calls one role and returns its entire validated report`
  - `apps/agentarts-runtime/test/bindings.test.mjs` -> `actual WS keeps role reports in binding wrappers and never produces an old executable candidate`
- **未验证项**：真实大模型生成千字级复杂因果图谱时的 JSON 结构稳定性与 token 极限消耗。

---

### W4: PA-计划最小修复
- **资源 ID**：`ed2363d9-b770-4ce5-a988-9bf0903466f7`
- **资源类型**：`workflow`
- **代码来源**：`migrated`
- **实际执行角色**：`plan`（提示词为 `PLAN_PROMPT`）
- **必需输入**：合法修复输入（`repair_input`）。
- **前置报告要求**：**必须提供 `world` 报告**（倾向必须为 `REVISE`）；**严禁携带** `plan` 报告。
- **返回类型**：**`role_report`**（`role: "plan"`，值为经校验的 `PlanReport` 对象）。

#### 调用示例（标准 JSON 序列化，无省略号）
- **HTTP 调用**：
  ```bash
  curl -X POST "http://$PA_AGENT_HOST:$PORT/invocations" \
    -H "Content-Type: application/json" \
    -H "X-PA-Agent-Token: Bearer $PA_AGENT_WSS_AUTH_TOKEN" \
    -H "X-HW-AgentArts-Session-Id: $PA_SESSION_ID" \
    -H "X-Request-Id: $PA_REQUEST_ID" \
    -H "X-PA-Deadline: $PA_DEADLINE" \
    -d '{"query":"{\"bindingVersion\":\"1.0.0\",\"type\":\"workflow\",\"id\":\"ed2363d9-b770-4ce5-a988-9bf0903466f7\",\"query\":\"{\\\"continuation\\\":{\\\"proposalId\\\":\\\"owned-plan-preview-1\\\",\\\"state\\\":\\\"confirmed\\\",\\\"result\\\":{\\\"repairContext\\\":{\\\"expectedGraphRevision\\\":7,\\\"targets\\\":[{\\\"node\\\":{\\\"id\\\":\\\"plan-node-1\\\",\\\"revision\\\":2},\\\"requestedSummary\\\":\\\"根据事实调整准备时间\\\",\\\"requestedDependencies\\\":[{\\\"id\\\":\\\"fact-node-1\\\",\\\"revision\\\":3}]}],\\\"allowedDependencies\\\":[{\\\"id\\\":\\\"fact-node-1\\\",\\\"revision\\\":3}]}}}}\",\"world\":{\"disposition\":\"REVISE\",\"affected\":[\"plan-node-1\"],\"reason\":\"已观察到事实依赖版本变更\",\"missing_information\":[]}}"}'
  ```
- **WS 帧调用**：
  ```json
  {
    "protocolVersion": "0.1.0",
    "type": "invoke",
    "sessionId": "$PA_SESSION_ID",
    "requestId": "$PA_REQUEST_ID",
    "idempotencyKey": "$PA_IDEMPOTENCY_KEY",
    "payloadDigest": "$PA_PAYLOAD_SHA256",
    "deadline": "$PA_DEADLINE",
    "payload": {
      "query": "{\"bindingVersion\":\"1.0.0\",\"type\":\"workflow\",\"id\":\"ed2363d9-b770-4ce5-a988-9bf0903466f7\",\"query\":\"{\\\"continuation\\\":{\\\"proposalId\\\":\\\"owned-plan-preview-1\\\",\\\"state\\\":\\\"confirmed\\\",\\\"result\\\":{\\\"repairContext\\\":{\\\"expectedGraphRevision\\\":7,\\\"targets\\\":[{\\\"node\\\":{\\\"id\\\":\\\"plan-node-1\\\",\\\"revision\\\":2},\\\"requestedSummary\\\":\\\"根据事实调整准备时间\\\",\\\"requestedDependencies\\\":[{\\\"id\\\":\\\"fact-node-1\\\",\\\"revision\\\":3}]}],\\\"allowedDependencies\\\":[{\\\"id\\\":\\\"fact-node-1\\\",\\\"revision\\\":3}]}}}}\",\"world\":{\"disposition\":\"REVISE\",\"affected\":[\"plan-node-1\"],\"reason\":\"已观察到事实依赖版本变更\",\"missing_information\":[]}}"
    }
  }
  ```

#### 验收用例
- **正常用例**：
  1. 提供合法 `repair_input` 与 `world(REVISE)`：重新核验 `world` 后单次调用 `plan`，返回包含步骤分类及依赖更新的 `role_report`。
- **失败用例**：
  1. 缺失 `world` 报告：抛出 `World report required by workflow`（HTTP 400）。
  2. 携带了 `plan` 报告：抛出 `Unexpected workflow role report`（HTTP 400）。
  3. `world` 报告建议为 `KEEP` 或 `RECHECK`：抛出 `World does not permit a repair proposal`（HTTP 400）。
  4. 传入陈旧或版本篡改的 `world`：抛出 `EXTERNAL_FAILURE`（HTTP 502）。
  5. 计划修订超出 `world.affected` 范围：抛出 `Plan exceeds world impact scope`（HTTP 502）。
  6. 计划包含当前候选契约不支持的操作（如步骤物理删除、自主创建下一步行动）：抛出 `UNSUPPORTED_CAPABILITY`（HTTP 503）。
- **已有测试覆盖**：
  - `packages/agentarts/test/bindings.test.mjs` -> `PA-计划最小修复 independently calls Plan once, revalidates supplied World, and returns complete report`
  - `apps/agentarts-runtime/test/bindings.test.mjs` -> `valid non-ASCII World reports retain the core JSON character budget through actual Plan dispatch`
- **未验证项**：极端多节点（>16 个目标步骤）在单次 Plan 提示词下的分类完备性。

---

### W5: PA-计划最小修复_1
- **资源 ID**：`65236810-db21-41cb-928b-39af691c4cfa`
- **资源类型**：`workflow`
- **代码来源**：`migrated`
- **实际执行角色**：`plan`（单角色执行，与 W4 共享底层受限 plan 逻辑，保留历史云资产独立绑定标识）
- **必需输入**：合法修复输入（`repair_input`）。
- **前置报告要求**：**必须提供 `world` 报告**；**严禁携带** `plan` 报告。
- **返回类型**：**`role_report`**（`role: "plan"`）。

#### 调用示例（标准 JSON 序列化，无省略号）
- **HTTP 调用**：
  ```bash
  curl -X POST "http://$PA_AGENT_HOST:$PORT/invocations" \
    -H "Content-Type: application/json" \
    -H "X-PA-Agent-Token: Bearer $PA_AGENT_WSS_AUTH_TOKEN" \
    -H "X-HW-AgentArts-Session-Id: $PA_SESSION_ID" \
    -H "X-Request-Id: $PA_REQUEST_ID" \
    -H "X-PA-Deadline: $PA_DEADLINE" \
    -d '{"query":"{\"bindingVersion\":\"1.0.0\",\"type\":\"workflow\",\"id\":\"65236810-db21-41cb-928b-39af691c4cfa\",\"query\":\"{\\\"continuation\\\":{\\\"proposalId\\\":\\\"owned-plan-preview-1\\\",\\\"state\\\":\\\"confirmed\\\",\\\"result\\\":{\\\"repairContext\\\":{\\\"expectedGraphRevision\\\":7,\\\"targets\\\":[{\\\"node\\\":{\\\"id\\\":\\\"plan-node-1\\\",\\\"revision\\\":2},\\\"requestedSummary\\\":\\\"根据事实调整准备时间\\\",\\\"requestedDependencies\\\":[{\\\"id\\\":\\\"fact-node-1\\\",\\\"revision\\\":3}]}],\\\"allowedDependencies\\\":[{\\\"id\\\":\\\"fact-node-1\\\",\\\"revision\\\":3}]}}}}\",\"world\":{\"disposition\":\"REVISE\",\"affected\":[\"plan-node-1\"],\"reason\":\"已观察到事实依赖版本变更\",\"missing_information\":[]}}"}'
  ```
- **测试覆盖**：`packages/agentarts/test/bindings.test.mjs` -> `PA-计划最小修复_1 independently calls Plan once...`
- **未验证项**：与历史 `_1` 原始提示词导出差异的逐字等价性评估。

---

### W6: PA-证据安全审查
- **资源 ID**：`998031d7-ec28-40ed-83e6-96667f22ff51`
- **资源类型**：`workflow`
- **代码来源**：`migrated`
- **实际执行角色**：`review`（提示词为 `REVIEW_PROMPT`）
- **必需输入**：合法修复输入（`repair_input`）。
- **前置报告要求**：**必须同时提供 `world` 报告与 `plan` 报告**（两者的 disposition 均须为 `REVISE`）。
- **返回类型**：**`application_result`**（返回最终可供核验的修复候选 `repair_candidate`）。

#### 调用示例（标准 JSON 序列化，无省略号）
- **HTTP 调用**：
  ```bash
  curl -X POST "http://$PA_AGENT_HOST:$PORT/invocations" \
    -H "Content-Type: application/json" \
    -H "X-PA-Agent-Token: Bearer $PA_AGENT_WSS_AUTH_TOKEN" \
    -H "X-HW-AgentArts-Session-Id: $PA_SESSION_ID" \
    -H "X-Request-Id: $PA_REQUEST_ID" \
    -H "X-PA-Deadline: $PA_DEADLINE" \
    -d '{"query":"{\"bindingVersion\":\"1.0.0\",\"type\":\"workflow\",\"id\":\"998031d7-ec28-40ed-83e6-96667f22ff51\",\"query\":\"{\\\"continuation\\\":{\\\"proposalId\\\":\\\"owned-plan-preview-1\\\",\\\"state\\\":\\\"confirmed\\\",\\\"result\\\":{\\\"repairContext\\\":{\\\"expectedGraphRevision\\\":7,\\\"targets\\\":[{\\\"node\\\":{\\\"id\\\":\\\"plan-node-1\\\",\\\"revision\\\":2},\\\"requestedSummary\\\":\\\"根据事实调整准备时间\\\",\\\"requestedDependencies\\\":[{\\\"id\\\":\\\"fact-node-1\\\",\\\"revision\\\":3}]}],\\\"allowedDependencies\\\":[{\\\"id\\\":\\\"fact-node-1\\\",\\\"revision\\\":3}]}}}}\",\"world\":{\"disposition\":\"REVISE\",\"affected\":[\"plan-node-1\"],\"reason\":\"已观察到事实依赖版本变更\",\"missing_information\":[]},\"plan\":{\"disposition\":\"REVISE\",\"changes\":[{\"node\":{\"id\":\"plan-node-1\",\"revision\":2},\"summary\":\"根据事实调整准备时间\",\"reason\":\"已观察到事实依赖版本变更\",\"dependencies\":[{\"id\":\"fact-node-1\",\"revision\":3}]}],\"missing_information\":[]}}"}'
  ```
- **WS 帧调用**：
  ```json
  {
    "protocolVersion": "0.1.0",
    "type": "invoke",
    "sessionId": "$PA_SESSION_ID",
    "requestId": "$PA_REQUEST_ID",
    "idempotencyKey": "$PA_IDEMPOTENCY_KEY",
    "payloadDigest": "$PA_PAYLOAD_SHA256",
    "deadline": "$PA_DEADLINE",
    "payload": {
      "query": "{\"bindingVersion\":\"1.0.0\",\"type\":\"workflow\",\"id\":\"998031d7-ec28-40ed-83e6-96667f22ff51\",\"query\":\"{\\\"continuation\\\":{\\\"proposalId\\\":\\\"owned-plan-preview-1\\\",\\\"state\\\":\\\"confirmed\\\",\\\"result\\\":{\\\"repairContext\\\":{\\\"expectedGraphRevision\\\":7,\\\"targets\\\":[{\\\"node\\\":{\\\"id\\\":\\\"plan-node-1\\\",\\\"revision\\\":2},\\\"requestedSummary\\\":\\\"根据事实调整准备时间\\\",\\\"requestedDependencies\\\":[{\\\"id\\\":\\\"fact-node-1\\\",\\\"revision\\\":3}]}],\\\"allowedDependencies\\\":[{\\\"id\\\":\\\"fact-node-1\\\",\\\"revision\\\":3}]}}}}\",\"world\":{\"disposition\":\"REVISE\",\"affected\":[\"plan-node-1\"],\"reason\":\"已观察到事实依赖版本变更\",\"missing_information\":[]},\"plan\":{\"disposition\":\"REVISE\",\"changes\":[{\"node\":{\"id\":\"plan-node-1\",\"revision\":2},\"summary\":\"根据事实调整准备时间\",\"reason\":\"已观察到事实依赖版本变更\",\"dependencies\":[{\"id\":\"fact-node-1\",\"revision\":3}]}],\"missing_information\":[]}}"
    }
  }
  ```

#### 验收用例
- **正常用例**：
  1. 完整输入 + 经核验的 `world` 与 `plan`：单次调用 `review` 模型，严格比对审查前后候选变更（summary/reason/dependencies/revision 一致性），返回合法 `repair_candidate`。
- **失败用例**：
  1. 缺失 `world` 或缺失 `plan`：抛出 `INVALID_ARGUMENT`（HTTP 400）。
  2. `plan` 报告 disposition 不为 `REVISE`：抛出 `Plan does not permit a repair candidate`（HTTP 400）。
  3. Review 模型擅自修改、扩充或删减计划变更项：抛出 `Review substituted the proposed plan`（HTTP 502）。
  4. 候选结果声称已获得授权（如带伪造 `authorizationRef`）：抛出 `EXTERNAL_FAILURE`（HTTP 502）。
- **已有测试覆盖**：
  - `packages/agentarts/test/bindings.test.mjs` -> `PA-证据安全审查 independently calls Review once and preserves fixed candidate semantics`
  - `packages/agentarts/test/bindings.test.mjs` -> `Review cannot substitute candidate summary, reason, revision, dependencies or add authority`
- **未验证项**：生成候选到达本地桌面后的交互式审批 UI 与用户同意闭环。

---

### W7: PA-证据安全审查_1
- **资源 ID**：`8004735c-cac6-4c09-9691-1a93233475ac`
- **资源类型**：`workflow`
- **代码来源**：`migrated`
- **实际执行角色**：`review`（与 W6 共享底层受限 review 实现，保留独立历史绑定）
- **必需输入**：合法修复输入（`repair_input`）。
- **前置报告要求**：**必须同时提供 `world` 报告与 `plan` 报告**。
- **返回类型**：**`application_result`**。

#### 调用示例（标准 JSON 序列化，无省略号）
- **HTTP 调用**：
  ```bash
  curl -X POST "http://$PA_AGENT_HOST:$PORT/invocations" \
    -H "Content-Type: application/json" \
    -H "X-PA-Agent-Token: Bearer $PA_AGENT_WSS_AUTH_TOKEN" \
    -H "X-HW-AgentArts-Session-Id: $PA_SESSION_ID" \
    -H "X-Request-Id: $PA_REQUEST_ID" \
    -H "X-PA-Deadline: $PA_DEADLINE" \
    -d '{"query":"{\"bindingVersion\":\"1.0.0\",\"type\":\"workflow\",\"id\":\"8004735c-cac6-4c09-9691-1a93233475ac\",\"query\":\"{\\\"continuation\\\":{\\\"proposalId\\\":\\\"owned-plan-preview-1\\\",\\\"state\\\":\\\"confirmed\\\",\\\"result\\\":{\\\"repairContext\\\":{\\\"expectedGraphRevision\\\":7,\\\"targets\\\":[{\\\"node\\\":{\\\"id\\\":\\\"plan-node-1\\\",\\\"revision\\\":2},\\\"requestedSummary\\\":\\\"根据事实调整准备时间\\\",\\\"requestedDependencies\\\":[{\\\"id\\\":\\\"fact-node-1\\\",\\\"revision\\\":3}]}],\\\"allowedDependencies\\\":[{\\\"id\\\":\\\"fact-node-1\\\",\\\"revision\\\":3}]}}}}\",\"world\":{\"disposition\":\"REVISE\",\"affected\":[\"plan-node-1\"],\"reason\":\"已观察到事实依赖版本变更\",\"missing_information\":[]},\"plan\":{\"disposition\":\"REVISE\",\"changes\":[{\"node\":{\"id\":\"plan-node-1\",\"revision\":2},\"summary\":\"根据事实调整准备时间\",\"reason\":\"已观察到事实依赖版本变更\",\"dependencies\":[{\"id\":\"fact-node-1\",\"revision\":3}]}],\"missing_information\":[]}}"}'
  ```
- **测试覆盖**：`packages/agentarts/test/bindings.test.mjs` -> `PA-证据安全审查_1 independently calls Review once...`
- **未验证项**：多协作者在不同分支上针对历史 `_1` 差异的对比回测。

---

### W8: PA-MVP-受限主路由
- **资源 ID**：`81bc9eb8-cf6a-4869-a1a2-e3b446349447`
- **资源类型**：`workflow`
- **代码来源**：`migrated`
- **实际执行角色**：完整路由流水线（`fast`、`world`、`plan`、`review`）
  - 普通请求：分派给 `fast`（或直接命中确定性回执）。
  - 修复请求：自动串行执行完整认知闭环 `world` -> `plan` -> `review`。
- **必需输入**：支持普通输入（`ordinary_input`）或合法修复输入（`repair_input`）。
- **前置报告要求**：**严禁外部传入 `world` 或 `plan` 报告**（流水线内部自闭环生成）。
- **返回类型**：**`application_result`**。

#### 调用示例（标准 JSON 序列化，无省略号）
- **HTTP 调用（修复链路）**：
  ```bash
  curl -X POST "http://$PA_AGENT_HOST:$PORT/invocations" \
    -H "Content-Type: application/json" \
    -H "X-PA-Agent-Token: Bearer $PA_AGENT_WSS_AUTH_TOKEN" \
    -H "X-HW-AgentArts-Session-Id: $PA_SESSION_ID" \
    -H "X-Request-Id: $PA_REQUEST_ID" \
    -H "X-PA-Deadline: $PA_DEADLINE" \
    -d '{"query":"{\"bindingVersion\":\"1.0.0\",\"type\":\"workflow\",\"id\":\"81bc9eb8-cf6a-4869-a1a2-e3b446349447\",\"query\":\"{\\\"continuation\\\":{\\\"proposalId\\\":\\\"owned-plan-preview-1\\\",\\\"state\\\":\\\"confirmed\\\",\\\"result\\\":{\\\"repairContext\\\":{\\\"expectedGraphRevision\\\":7,\\\"targets\\\":[{\\\"node\\\":{\\\"id\\\":\\\"plan-node-1\\\",\\\"revision\\\":2},\\\"requestedSummary\\\":\\\"根据事实调整准备时间\\\",\\\"requestedDependencies\\\":[{\\\"id\\\":\\\"fact-node-1\\\",\\\"revision\\\":3}]}],\\\"allowedDependencies\\\":[{\\\"id\\\":\\\"fact-node-1\\\",\\\"revision\\\":3}]}}}}\"}"}'
  ```
- **WS 帧调用（普通问答链路）**：
  ```json
  {
    "protocolVersion": "0.1.0",
    "type": "invoke",
    "sessionId": "$PA_SESSION_ID",
    "requestId": "$PA_REQUEST_ID",
    "idempotencyKey": "$PA_IDEMPOTENCY_KEY",
    "payloadDigest": "$PA_PAYLOAD_SHA256",
    "deadline": "$PA_DEADLINE",
    "payload": {
      "query": "{\"bindingVersion\":\"1.0.0\",\"type\":\"workflow\",\"id\":\"81bc9eb8-cf6a-4869-a1a2-e3b446349447\",\"query\":\"{\\\"goal\\\":\\\"总结工程当前任务状态\\\",\\\"availableTools\\\":[]}\"}"
    }
  }
  ```

#### 验收用例
- **正常用例**：
  1. 传入普通问答：调用单次 `fast`，返回答复文本。
  2. 传入合法修复输入：依次调用 `world`、`plan`、`review`，返回审查后的 `repair_candidate`。
  3. `world` 判定为 `KEEP`：流水线提前停止，返回文本（“KEEP：世界状态分析无需修复。”），不触发 plan 或 review。
- **失败用例**：
  1. 外部传入 `world` 或 `plan` 报告：抛出 `INVALID_ARGUMENT`（HTTP 400）。
  2. 过程中模型返回非 JSON 或严重超时：流水线阻断并返回对应标准错误码。
- **已有测试覆盖**：
  - `packages/agentarts/test/bindings.test.mjs` -> `router workflow dispatches complete repair exactly once`
  - `apps/agentarts-runtime/test/bindings.test.mjs` -> `all eight workflows and three controllers dispatch through actual core over HTTP`
- **未验证项**：多模型并发竞争及在真实云端部署网关下的网关级超时重试对主路由的影响。

---

## 5. 3 个 Controller 调用规范与验收清单

---

### C1: PersonalAgent-MVP协调器
- **资源 ID**：`ae641e4a-1524-4435-a132-c58fb13e288d`
- **资源类型**：`controller`
- **代码来源**：**`new-owned-binding`（明确标注：原云端导出为空绑定，本轮为新建 owned 绑定）**
- **实际执行角色**：`router`（覆盖 `fast`, `world`, `plan`, `review`）。接入受限主路由，支持普通问答分派与认知修复完整流水线。
- **必需输入**：支持普通输入（`ordinary_input`）或修复输入（`repair_input`）。
- **前置报告要求**：**严禁携带** `world` 或 `plan` 报告。
- **返回类型**：**`application_result`**。
- **默认 Controller 配置支持**：支持注入 `PA_AGENT_DEFAULT_CONTROLLER_ID`，旧调用模式下会自动解包其 `application_result.value` 返回。

#### 调用示例（标准 JSON 序列化，无省略号）
- **HTTP 调用**：
  ```bash
  curl -X POST "http://$PA_AGENT_HOST:$PORT/invocations" \
    -H "Content-Type: application/json" \
    -H "X-PA-Agent-Token: Bearer $PA_AGENT_WSS_AUTH_TOKEN" \
    -H "X-HW-AgentArts-Session-Id: $PA_SESSION_ID" \
    -H "X-Request-Id: $PA_REQUEST_ID" \
    -H "X-PA-Deadline: $PA_DEADLINE" \
    -d '{"query":"{\"bindingVersion\":\"1.0.0\",\"type\":\"controller\",\"id\":\"ae641e4a-1524-4435-a132-c58fb13e288d\",\"query\":\"{\\\"goal\\\":\\\"你好，请总结当前状态\\\",\\\"availableTools\\\":[]}\"}"}'
  ```
- **WS 帧调用**：
  ```json
  {
    "protocolVersion": "0.1.0",
    "type": "invoke",
    "sessionId": "$PA_SESSION_ID",
    "requestId": "$PA_REQUEST_ID",
    "idempotencyKey": "$PA_IDEMPOTENCY_KEY",
    "payloadDigest": "$PA_PAYLOAD_SHA256",
    "deadline": "$PA_DEADLINE",
    "payload": {
      "query": "{\"bindingVersion\":\"1.0.0\",\"type\":\"controller\",\"id\":\"ae641e4a-1524-4435-a132-c58fb13e288d\",\"query\":\"{\\\"continuation\\\":{\\\"proposalId\\\":\\\"owned-plan-preview-1\\\",\\\"state\\\":\\\"confirmed\\\",\\\"result\\\":{\\\"repairContext\\\":{\\\"expectedGraphRevision\\\":7,\\\"targets\\\":[{\\\"node\\\":{\\\"id\\\":\\\"plan-node-1\\\",\\\"revision\\\":2},\\\"requestedSummary\\\":\\\"根据事实调整准备时间\\\",\\\"requestedDependencies\\\":[{\\\"id\\\":\\\"fact-node-1\\\",\\\"revision\\\":3}]}],\\\"allowedDependencies\\\":[{\\\"id\\\":\\\"fact-node-1\\\",\\\"revision\\\":3}]}}}}\"}"
    }
  }
  ```

#### 验收用例
- **正常用例**：
  1. 普通问答请求：返回包装在 `application_result` 中的 text。
  2. 修复请求：执行单次完整修复链，返回合法 candidate。
  3. 配置为默认 Controller 后接受旧式调用：输出正常解包为旧数据结构。
- **失败用例**：
  1. 传入 `type: "workflow"` 试图越权：返回 `UNSUPPORTED_CAPABILITY`（HTTP 503）。
  2. 携带 `world` 或 `plan`：抛出 `INVALID_ARGUMENT`（HTTP 400）。
  3. 服务配置了不存在的默认 Controller ID：启动时立即崩溃退出，防止未受控上线。
- **已有测试覆盖**：
  - `packages/agentarts/test/bindings.test.mjs` -> `new owned MVP router accepts ordinary input while first cognition controller requires repair input`
  - `apps/agentarts-runtime/test/bindings.test.mjs` -> `trusted default controller preserves legacy HTTP and WS application output...`
- **未验证项**：AgentArts 控制台导入该控制器的原生编排图等价性。

---

### C2: PersonalAgent持续认知协调器
- **资源 ID**：`32d4d44c-eade-4f3f-8f76-209c74609e79`
- **资源类型**：`controller`
- **代码来源**：`migrated`
- **实际执行角色**：`repair`（严格限制在认知修复流：`world` -> `plan` -> `review`）
- **必需输入**：**必须为合法修复输入（`repair_input`）**。普通问答输入直接报 400 拦截！
- **前置报告要求**：**严禁携带** `world` 或 `plan` 报告（内部执行流水线）。
- **返回类型**：**`application_result`**。
- **去重保护**：原导出中的 9 次迭代或 Normal/Default 冗余分支被严格收敛为**单次确定性修复链**，杜绝重复分派。

#### 调用示例（标准 JSON 序列化，无省略号）
- **HTTP 调用**：
  ```bash
  curl -X POST "http://$PA_AGENT_HOST:$PORT/invocations" \
    -H "Content-Type: application/json" \
    -H "X-PA-Agent-Token: Bearer $PA_AGENT_WSS_AUTH_TOKEN" \
    -H "X-HW-AgentArts-Session-Id: $PA_SESSION_ID" \
    -H "X-Request-Id: $PA_REQUEST_ID" \
    -H "X-PA-Deadline: $PA_DEADLINE" \
    -d '{"query":"{\"bindingVersion\":\"1.0.0\",\"type\":\"controller\",\"id\":\"32d4d44c-eade-4f3f-8f76-209c74609e79\",\"query\":\"{\\\"continuation\\\":{\\\"proposalId\\\":\\\"owned-plan-preview-1\\\",\\\"state\\\":\\\"confirmed\\\",\\\"result\\\":{\\\"repairContext\\\":{\\\"expectedGraphRevision\\\":7,\\\"targets\\\":[{\\\"node\\\":{\\\"id\\\":\\\"plan-node-1\\\",\\\"revision\\\":2},\\\"requestedSummary\\\":\\\"根据事实调整准备时间\\\",\\\"requestedDependencies\\\":[{\\\"id\\\":\\\"fact-node-1\\\",\\\"revision\\\":3}]}],\\\"allowedDependencies\\\":[{\\\"id\\\":\\\"fact-node-1\\\",\\\"revision\\\":3}]}}}}\"}"}'
  ```
- **WS 帧调用**：
  ```json
  {
    "protocolVersion": "0.1.0",
    "type": "invoke",
    "sessionId": "$PA_SESSION_ID",
    "requestId": "$PA_REQUEST_ID",
    "idempotencyKey": "$PA_IDEMPOTENCY_KEY",
    "payloadDigest": "$PA_PAYLOAD_SHA256",
    "deadline": "$PA_DEADLINE",
    "payload": {
      "query": "{\"bindingVersion\":\"1.0.0\",\"type\":\"controller\",\"id\":\"32d4d44c-eade-4f3f-8f76-209c74609e79\",\"query\":\"{\\\"continuation\\\":{\\\"proposalId\\\":\\\"owned-plan-preview-1\\\",\\\"state\\\":\\\"confirmed\\\",\\\"result\\\":{\\\"repairContext\\\":{\\\"expectedGraphRevision\\\":7,\\\"targets\\\":[{\\\"node\\\":{\\\"id\\\":\\\"plan-node-1\\\",\\\"revision\\\":2},\\\"requestedSummary\\\":\\\"根据事实调整准备时间\\\",\\\"requestedDependencies\\\":[{\\\"id\\\":\\\"fact-node-1\\\",\\\"revision\\\":3}]}],\\\"allowedDependencies\\\":[{\\\"id\\\":\\\"fact-node-1\\\",\\\"revision\\\":3}]}}}}\"}"
    }
  }
  ```

#### 验收用例
- **正常用例**：
  1. 传入合法修复输入：依次回顾世界状态与计划，输出经过 Review 确认的 `repair_candidate`。
- **失败用例**：
  1. 传入普通问答输入（如 `"你好"`）：由于 `dispatch: "repair"` 强制检查，直接抛出 `Repair input required by cognition controller`（HTTP 400）。
  2. 携带 `world` 或 `plan`：抛出 `INVALID_ARGUMENT`（HTTP 400）。
- **已有测试覆盖**：
  - `packages/agentarts/test/bindings.test.mjs` -> `PersonalAgent持续认知协调器 binds one complete chain without duplicate default dispatch`
  - `packages/agentarts/test/bindings.test.mjs` -> `new owned MVP router accepts ordinary input while first cognition controller requires repair input`
- **未验证项**：本地持续事实投递在连续 24 小时运行下的真实内存开销与退化监测。

---

### C3: PersonalAgent持续认知协调器_1
- **资源 ID**：`2f5d361c-bd85-4d2f-9903-bb35d4f55afa`
- **资源类型**：`controller`
- **代码来源**：`migrated`
- **实际执行角色**：`router`（全主路由：`fast` / `world` -> `plan` -> `review`）
- **必需输入**：支持普通输入（`ordinary_input`）或修复输入（`repair_input`）。
- **前置报告要求**：**严禁携带** `world` 或 `plan` 报告。
- **返回类型**：**`application_result`**。
- **去重保护**：原导出中的 Normal/Default 双终止绑定均指向同一受限主路由，代码实现保证其仅作为单一确定性链条执行一次，不重复分派。

#### 调用示例（标准 JSON 序列化，无省略号）
- **HTTP 调用**：
  ```bash
  curl -X POST "http://$PA_AGENT_HOST:$PORT/invocations" \
    -H "Content-Type: application/json" \
    -H "X-PA-Agent-Token: Bearer $PA_AGENT_WSS_AUTH_TOKEN" \
    -H "X-HW-AgentArts-Session-Id: $PA_SESSION_ID" \
    -H "X-Request-Id: $PA_REQUEST_ID" \
    -H "X-PA-Deadline: $PA_DEADLINE" \
    -d '{"query":"{\"bindingVersion\":\"1.0.0\",\"type\":\"controller\",\"id\":\"2f5d361c-bd85-4d2f-9903-bb35d4f55afa\",\"query\":\"{\\\"continuation\\\":{\\\"proposalId\\\":\\\"owned-plan-preview-1\\\",\\\"state\\\":\\\"confirmed\\\",\\\"result\\\":{\\\"repairContext\\\":{\\\"expectedGraphRevision\\\":7,\\\"targets\\\":[{\\\"node\\\":{\\\"id\\\":\\\"plan-node-1\\\",\\\"revision\\\":2},\\\"requestedSummary\\\":\\\"根据事实调整准备时间\\\",\\\"requestedDependencies\\\":[{\\\"id\\\":\\\"fact-node-1\\\",\\\"revision\\\":3}]}],\\\"allowedDependencies\\\":[{\\\"id\\\":\\\"fact-node-1\\\",\\\"revision\\\":3}]}}}}\"}"}'
  ```
- **测试覆盖**：`packages/agentarts/test/bindings.test.mjs` -> `PersonalAgent持续认知协调器_1 binds one complete chain without duplicate default dispatch`
- **未验证项**：与平台端多智能体配置历史迁移的逐级审计确认。

---

## 6. 全资源综合验收矩阵汇总表

| 序号 | 资源 ID | 资源名称 | 类型 | Origin 标识 | 执行角色 | 前置报告要求 | 返回类型 | 源码可调用 | 镜像包含 (离线9/9) | 镜像包含 (发布验证) | 平台部署 | 真实工具闭环 | 已覆盖自动化测试 |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :---: | :---: | :---: | :---: | :---: | :--- |
| **W1** | `71f3004f-faba-4487-9e6f-996194ec2b3c` | PA-MVP-快速工具与答复 | workflow | migrated | `fast` | 无（禁带报告） | `application_result` | ✅ | ✅ (UID 1000) | 🔄 验证中 | ⚠️ 待验 | `fast workflow makes only ordinary proposals...` |
| **W2** | `b74bbcd0-b8f6-4a73-b436-0676f952ac9a` | PA-MVP-确定性意图 | workflow | migrated | 零模型 | 无（禁带报告） | `application_result` | ✅ | ✅ (UID 1000) | 🔄 验证中 | ⚠️ 待验 | `deterministic intent proposes only published...` |
| **W3** | `7d06153e-6262-4679-86ae-1914b38e11f3` | PA-世界状态影响分析 | workflow | migrated | `world` | 无（禁带报告） | `role_report` | ✅ | ✅ (UID 1000) | 🔄 验证中 | ⚠️ 待验 | `World workflow really calls one role...` |
| **W4** | `ed2363d9-b770-4ce5-a988-9bf0903466f7` | PA-计划最小修复 | workflow | migrated | `plan` | **必传 world**，禁 plan | `role_report` | ✅ | ✅ (UID 1000) | 🔄 验证中 | ⚠️ 待验 | `PA-计划最小修复 independently calls Plan...` |
| **W5** | `65236810-db21-41cb-928b-39af691c4cfa` | PA-计划最小修复_1 | workflow | migrated | `plan` | **必传 world**，禁 plan | `role_report` | ✅ | ✅ (UID 1000) | 🔄 验证中 | ⚠️ 待验 | `PA-计划最小修复_1 independently calls Plan...` |
| **W6** | `998031d7-ec28-40ed-83e6-96667f22ff51` | PA-证据安全审查 | workflow | migrated | `review` | **必传 world & plan** | `application_result` | ✅ | ✅ (UID 1000) | 🔄 验证中 | ⚠️ 待验 | `PA-证据安全审查 independently calls Review...` |
| **W7** | `8004735c-cac6-4c09-9691-1a93233475ac` | PA-证据安全审查_1 | workflow | migrated | `review` | **必传 world & plan** | `application_result` | ✅ | ✅ (UID 1000) | 🔄 验证中 | ⚠️ 待验 | `PA-证据安全审查_1 independently calls Review...` |
| **W8** | `81bc9eb8-cf6a-4869-a1a2-e3b446349447` | PA-MVP-受限主路由 | workflow | migrated | `fast/world/plan/review` | 无（内部闭环） | `application_result` | ✅ | ✅ (UID 1000) | 🔄 验证中 | ⚠️ 待验 | `router workflow dispatches complete repair...` |
| **C1** | `ae641e4a-1524-4435-a132-c58fb13e288d` | PersonalAgent-MVP协调器 | controller | **new-owned-binding** | `fast/world/plan/review` | 无（内部闭环） | `application_result` | ✅ | ✅ (UID 1000) | 🔄 验证中 | ⚠️ 待验 | `new owned MVP router accepts ordinary input...` |
| **C2** | `32d4d44c-eade-4f3f-8f76-209c74609e79` | PersonalAgent持续认知协调器 | controller | migrated | `world/plan/review` | 无（内部闭环） | `application_result` | ✅ | ✅ (UID 1000) | 🔄 验证中 | ⚠️ 待验 | `PersonalAgent持续认知协调器 binds one complete chain...` |
| **C3** | `2f5d361c-bd85-4d2f-9903-bb35d4f55afa` | PersonalAgent持续认知协调器_1 | controller | migrated | `fast/world/plan/review` | 无（内部闭环） | `application_result` | ✅ | ✅ (UID 1000) | 🔄 验证中 | ⚠️ 待验 | `PersonalAgent持续认知协调器_1 binds one complete chain...` |

---

## 7. 通用边界与故障注入矩阵

| 场景分类 | 注入行为 | 预期协议表现 | 拦截位置 | 依据规范 / 测试代码 |
| :--- | :--- | :--- | :--- | :--- |
| **双凭据缺失** | `PA_AGENT_WSS_AUTH_TOKEN` 与 `PA_AGENT_INBOUND_TOKEN` 均未配置时调用 `/bindings` | `503 UNSUPPORTED_CAPABILITY` | `server.mjs:85` | `disabled=await host(t,{wssAuthToken:undefined})` |
| **越权凭据** | 配置双 Token 时，仅用外部 `PA_AGENT_INBOUND_TOKEN` 访问内部绑定专属 `/bindings` | `401 UNAUTHORIZED` | `server.mjs:86` | `explicit bindings require the inner credential...` |
| **凭据自动继承** | 未配 `WSS_TOKEN` 但配置 `INBOUND_TOKEN`，用该 Token 访问 `/bindings` | `200 OK`（返回目录） | `server.mjs:25` | `createAgentServer({ wssAuthToken = authToken })` |
| **未知 ID** | 传入不在目录内的任意 UUID | `503 UNSUPPORTED_CAPABILITY` | `binding-dispatch.mjs:49` | `bad versions, unknown identities... fail before model calls` |
| **错版本** | 传入 `bindingVersion: "2.0.0"` | `400 INVALID_ARGUMENT` | `binding-dispatch.mjs:42` | `bad versions, unknown identities... fail before model calls` |
| **多余字段** | 信封内传入白名单外的额外字段（如 `grant: true`） | `400 INVALID_ARGUMENT` | `binding-dispatch.mjs:46` | `bad versions, unknown identities... fail before model calls` |
| **前置报告超限** | `world` 报告字符串超过 16,000 UTF-16 字符 | `400 INVALID_ARGUMENT` | `binding-dispatch.mjs:55` | `valid non-ASCII World reports retain the core JSON character budget...` |
| **缺失必需报告** | 调用 Plan 却未传 `world`，或调用 Review 却未传 `plan` | `400 INVALID_ARGUMENT` | `binding-dispatch.mjs:52` | `bad versions, unknown identities... fail before model calls` |
| **多余前置报告** | 调用 World 却传了 `world`，或调用 Controller 传了报告 | `400 INVALID_ARGUMENT` | `binding-dispatch.mjs:52` | `bad versions, unknown identities... fail before model calls` |
| **工具目录缺失** | 确定性意图请求但目录未公布对应工具 | 返回 `RECHECK` 纯文本，**绝不猜测工具** | `index.ts:89` | `deterministic finite recipe routing cannot guess capability...` |
| **非法命令回执** | 回执中 `exitCode` 与 `passed` 布尔值矛盾 | `400 INVALID_ARGUMENT` | `index.ts:403` | `deterministic confirmed failure is preserved...` |
| **候选审查篡改** | Review 模型私自篡改、改写或替换 Plan 变更项 | `502 EXTERNAL_FAILURE` | `index.ts:172` | `Review substituted the proposed plan` |
| **伪造权限背书** | 模型返回结果携带 `verification: "verified"` | `502 EXTERNAL_FAILURE` | `index.ts:148` | `Agent output includes a trust claim` |
| **请求超时** | 超过 `X-PA-Deadline` 规定时间（含模型卡死） | `504 TIMEOUT` | `server.mjs:117` | `bound invocations respect original cancellation and deadline...` |
| **客户端断连/取消** | HTTP 连接提前 abort 或 WS 发送 `cancel` 帧 | `499 CANCELLED`（HTTP） / `CANCELLED`（WS） | `server.mjs:100` / `websocket-transport.mjs:138` | `bound calls share HTTP/WS limits, cancellation...` |
| **并发超限** | 活动并发达到 `maxConcurrency` 上限 | `429 RATE_LIMITED` | `server.mjs:97` | `bound calls share HTTP/WS limits, cancellation...` |

---

## 8. 源码与迁移文档差异单独报告

1. **`PersonalAgent-MVP协调器`（C1）的可用性状态**：
   - *历史文档记录*：在早期清单中因原始云端导出仅含空 Controller 节点被记录为 `unavailable`。
   - *当前源码事实*：在最新实现中已建立新建 owned 绑定（`origin: "new-owned-binding"`，dispatch: router），接入受限主路由，支持作为 `defaultControllerId` 注入。矩阵标明其为新建 owned 绑定，保留原云端为空绑定的历史事实。
2. **多智能体循环与冗余分支收敛**：
   - *历史导出事实*：原云端多智能体导出中 `PersonalAgent持续认知协调器` 包含 `max_iteration=9` 与 Normal/Default 双重分支。
   - *当前源码事实*：镜像实现明确收敛为单次确定性流水线执行（`single_chain_no_duplicate_default`），消除重复执行风险。
3. **前置报告字符与请求字节预算**：
   - *核心层约束*：`index.ts` 中的 `reportCopy` 针对前置报告施行 16,000 UTF-16 字符计数限制；
   - *传输层约束*：`binding-dispatch.mjs` 同步校验 16,000 限制，整个 HTTP/WS 报文另受 1,200,000 UTF-8 字节限制；中文报告在核心层按 UTF-16 字符计额，消除了阶段转换时的多字节误判隐患。

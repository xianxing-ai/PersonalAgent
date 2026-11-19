# MOD-14 VOICE-SESSION-BOUNDARY-20261107：语音会话边界离线契约

<!-- current-design-20261107 -->
> 当前协作规则（2026-10-17）：[接线交付总包](../competition/COLLABORATOR_WIRING_PACKAGE.md) · [模块分工](../MODULE_ASSIGNMENTS.md) · [当前设计](../design/CURRENT_DESIGN_20261015.md)。各 MOD 负责人自行闭环实现、公开契约、实际调用方接线、必要测试与 Evidence/文档。常规 PR 须由 zemeng5208、goo122、Potatos498、2511375597-lab 中任一非作者对当前提交有效批准；Owner zemeng5208 对具体 PR 的审核例外须在该 PR 明确记录，不伪称独立批准。拥有合并权限者（包括作者）可在最新必需技术 CI 通过、严格同步 main、无冲突且阻断意见已处理后合并；四位协作者跨 PR 均衡承担审查与合并，禁止强推、直接推 main 或绕过技术检查。

- Profile：`huawei_ict_agentarts`（当前唯一实施路径；不扩展 `local`）
- 模块 / 需求：MOD-14 / PA-007
- 负责人：`zemeng`
- 非作者评审者：`goo122`
- 代码范围：`packages/voice/src/voice-session-boundary.ts`、`packages/voice/test/voice-session-boundary.test.mjs`、`packages/voice/src/index.ts`（最小导出）
- 状态：`in_progress`（离线边界与契约交付；真机 SIS 标待验收）
- 基线：最新 `origin/main`

## 1. 任务背景与边界约束

本交付包确立 MOD-14 语音会话的离线上下文断言与华为云 SIS 服务可用性规划契约：
- **边界明确**：纯离线契约与参数守护，不连网、不读凭据、不调用真实外部 API、不启动物理设备。
- **规避范围**：
  - 本任务**不是** F02 防回声，坚决避开 `#584` 的 `echo-guard` 及相关文件，不引入回声抑制相关逻辑。
  - 测试采用独立新文件名 `packages/voice/test/voice-session-boundary.test.mjs`，不修改 `#552` 涉及的文件名。
  - 严禁修改 `apps/desktop`、`echo-guard`、`Runtime` 以及业务连接器（`packages/connectors/**`）。

## 2. 交付实现与离线契约

### 2.1 语音会话上下文断言 (`assertVoiceSessionContext`)

提供对调用方传入的会话上下文 `context`（包含 `deadline` 与 `signal`）的离线断言：
- **上下文合法性**：入参必须为非 null、非数组的对象，否则抛出 `VoiceSessionError('INVALID_ARGUMENT', 'Invalid voice session context')`。
- **期限格式与规范性**：`deadline` 必须为符合 ISO 8601 UTC 的标准字符串（匹配 `/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/`）。对于非法格式或超出日历实际天数经 `Date.parse` 进位的非规范字符串，抛出 `INVALID_ARGUMENT`。
- **期限过期检查**：若 `expiresAt <= now`（支持 options 注入 `nowMs` 以供精准边界断言），立即抛出 `VoiceSessionError('TIMEOUT', 'Voice session deadline expired')`。
- **取消信号检查**：`signal` 必须为合法 `AbortSignal`（具备 `aborted` 布尔状态与事件监听能力）；若已触发取消 (`signal.aborted === true`)，立即抛出 `VoiceSessionError('CANCELLED', 'Voice session cancelled')`。
- **输出保障**：校验通过后返回冻结的 `ValidatedVoiceSessionContext`，包含 `deadline`、`expiresAt`、`remainingMs` 与 `signal`。

### 2.2 华为云 SIS 离线可用性规划 (`planHuaweiSisAvailability`)

在不发起任何网络连接、不调用凭据方法的前提下，纯离线裁决 SIS ASR/TTS 适配器的配置完备性：
- **缺失与未配置场景**：无输入、无区域（或非支持区域 `cn-north-4` / `cn-east-3`）、无项目 ID（或格式不符合 `/^[A-Za-z0-9_-]{1,128}$/`）、缺少凭据端口（既无 `tokenPort` 也无 `requestAuthPort`）、凭据端口歧义（同时配置了两者）或传输层缺失时，确定性返回：
  ```ts
  {
    available: false,
    reason: 'unavailable',
    detail: '...'
  }
  ```
- **配置就绪场景**：当区域、项目 ID 与唯一有效的凭据端口（`tokenPort` 或 `requestAuthPort`）均完备时，返回：
  ```ts
  {
    available: true,
    reason: 'ready',
    region: 'cn-north-4' | 'cn-east-3',
    projectId: string,
    authMode: 'token' | 'signature',
    endpoint: string,
    detail: 'configured'
  }
  ```
- **安全与离线不变式**：
  - 绝对不调用 `fetch` 或 `fetchImpl`；
  - 绝对不调用 `tokenPort.getSisToken()` 或 `requestAuthPort.getSisRequestHeaders()`；
  - 绝对不尝试从环境变量或磁盘读取未授权凭据。

### 2.3 最小导出

在 `packages/voice/src/index.ts` 中仅增量导出上述两个边界函数及对应强类型：
- `assertVoiceSessionContext`、`planHuaweiSisAvailability`
- `VoiceSessionContext`、`ValidatedVoiceSessionContext`、`AssertVoiceSessionContextOptions`、`HuaweiSisAvailabilityInput`、`HuaweiSisAvailabilityPlan`

## 3. 验证与证据记录

### 3.1 离线单元测试覆盖

新增测试文件 `packages/voice/test/voice-session-boundary.test.mjs`，共 12 项场景：
1. 非对象上下文输入拒绝（`INVALID_ARGUMENT`）；
2. 畸形及无效 ISO UTC 日期拒绝（`INVALID_ARGUMENT`）；
3. 已过期 deadline 及当前时刻边界拒绝（`TIMEOUT`）；
4. 缺失或非法 AbortSignal 拒绝（`INVALID_ARGUMENT`）；
5. 已取消 signal 拒绝（`CANCELLED`）；
6. 合法上下文返回冻结校验结果与剩余毫秒数；
7. 缺失配置对象规划判定为 unavailable；
8. 缺失或不支持的区域与项目 ID 规划判定为 unavailable；
9. 缺少凭据端口、双端口冲突歧义及非函数方法规划判定为 unavailable；
10. 缺失传输层 fetchImpl 规划判定为 unavailable；
11. 基于 Token 模式离线规划成功（调用探针计数为 0，验证零网络零凭据读取）；
12. 基于签名 Auth 模式离线规划成功（调用探针计数为 0，验证零网络零凭据读取）。

### 3.2 验证结果

- `npm run --workspace=@personal-agent/voice build`：编译及类型生成通过。
- `node --test packages/voice/test/voice-session-boundary.test.mjs`：12/12 全部通过。
- `npm run --workspace=@personal-agent/voice test`：154/154 全部通过，零失败，零跳过。
- `npm run check:architecture`：3/3 架构依赖及门禁检查通过。
- `git diff --check`：无空白或格式违规。

## 4. 剩余项与交接状态

- **状态保持**：由于真实华为云 SIS 账号调用、实机 PCM 麦克风录制、WAV 播放打断、噪声回声治理以及与 Desktop 界面端到端集成仍待真机取得实际回执，**真机 SIS 标待验收**，MOD-14 整体在 `ROADMAP.md` 中继续保持 `in_progress`。

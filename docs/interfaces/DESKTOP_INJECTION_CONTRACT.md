# Desktop 组合注入契约（lab 分区：conversationTools / 设置 / 图 host 条件注入）

> 本文是 2511375597-lab 的 Desktop 前端接线契约：把已提供的公开口条件注入生产组合，缺口显示 unavailable。
> 机器校验：`node scripts/competition/verify-graph-capability-coverage.mjs --domain device-cloud`（tests/contracts/desktop-injection-contract.test.mjs）。
> 边界（OWNER 2026-10-31 修订）：lab 负责全部前端与前端接线；不实现 Runtime/Policy，不伪造后端；Electron 受信设备能力（语音链路、键鼠/浏览器原生执行）本身归 zemeng。

## 1. 注入点（main 现有组合文件，逐个已核实在仓库中存在）

| 组合点 | 文件 | 注入语义 |
| --- | --- | --- |
| 对话工具目录条件注入 | `apps/desktop/electron/main.js`（conversationTools/availability 合并） | 公开口可用才注入；缺口显示 unavailable，禁止 Fake |
| 输入租约（电脑控制） | `apps/desktop/electron/computer-control-lease.js` | 主进程单一输入租约；`isComputerControlWrite` 读/写分类 |
| F14 观察/输入锁消费（`desktop.current_observation` / `runtime.desktop_input_lock`） | `apps/desktop/electron/main.js` + `packages/agentarts/src/f14-native-observation.ts`（PR #585 `createDesktopObservationHostPort`/`createDesktopInputLockHostPort`） | 观察与锁 host 端口按 namespace 绑定注入；未配置租约端口时 UI 显示 unavailable |
| F15 审核配置 UI | `apps/desktop/src`（Renderer 目录，lab） | 审核记录经 `packages/cognition/src/independent-review-signature.ts` 的 `createIndependentReviewRecord` 产生（签名端口注入）；UI 只消费记录，不发明信任 |
| F18/F19 平台读回展示 | `apps/desktop/electron/main.js` | 消费 `packages/agentarts/src/f18-f19-github-hosts.ts` 的绑定读回结果；`source:'platform_readback'` 才可展示为平台状态 |
| F22/F26/F28 门控显示 | Desktop f26 端口文件随 #571 堆叠链交付（合并后补引用路径） | 底层 unavailable 时 tools 为空，不暴露发布命令（#571 行为，合并后生效） |
| 离线评估集名称（`evaluation.dataset_snapshot`） | `packages/connectors/github/src/developer-duty.ts` 的 `buildOfflineEvalSet` | 只产生 `evidenceLevel: fixture` 的离线数据集。这不是 F23 生产 host 注入；真实评估口仍按 graph-capability-gaps.json 保持 open，界面不得把 fixture 显示成平台评估通过 |
| 语音 echo guard / final 回执（`voice.final_transcript`） | `apps/desktop/electron/main.js` 语音组合 + `packages/voice/src/echo-guard.ts`（PR #584） | TTS 窗口内 `inspect()` 为疑似回声不进 final；final 必须携带已验证回执才作为已确认用户输入 |
| 责任快照（`responsibility.snapshot`） | 责任生命周期 host 口随 F01 缺口交付（graph-capability-gaps.json 登记） | 落地前对话目录显示 unavailable；落地后按公开口条件注入 |

## 2. 注入条件与 unavailable 显示（强约束）

1. **条件注入**：每个公开口只有在其受信依赖（Runtime 工厂/租约/签名端口/平台读回）真实可用时才注入工具目录；否则该能力在对话工具目录与设置页显示 unavailable 及缺失原因。
2. **禁止 Fake**：不允许用 mock 结果填充工具目录（与 tests/contracts/large-control-terminal-unknown.test.mjs 的既有 unknown 语义一致）。
3. **会话绑定**：F14 观察指纹与输入锁都按 namespace（会话）绑定；UI 展示时保留绑定标识，不得跨会话复用。
4. **写口经原链**：`desktop.registered_input/registered_submit`（缺口登记 in graph-capability-gaps.json）落地前，注册/提交动作保持不可用；落地后仍走原 Policy/审批。

## 3. 覆盖校验与维护

- `--domain device-cloud`（voice./desktop./executor./responsibility./deployment./evaluation./shadow. 前缀）覆盖校验随缺口登记 JSON 维护；lab 注入新口后，在缺口登记移除对应条目并在本文第 1 节加行。
- 本文第 1 节引用的文件必须真实存在（tests/contracts/desktop-injection-contract.test.mjs 强制）；文件移动时同步更新。

## 4. 与其他契约的关系

- 业务工具的消费接线（邮件/日历/待办设置页）：接口语义见 BUSINESS_CONNECTOR_PORT_CONTRACTS.md；UI 归 lab。
- 基础口的消费接线：接口语义见 FOUNDATION_PORT_CONTRACTS.md。
- 部署/影子/模型门控的修复行为：见 docs/competition/evidence/F22_F26_F28_GATE_MATRIX_20261107.md。

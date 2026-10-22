# Live 语音只提示原授权卡（2026-10-22）

Profile：`huawei_ict_agentarts`。本增量沿用现有授权卡、Runtime/Policy 和原任务主链，
对应用户最新要求“审批只发生在授权卡片”，不新增审批来源、重试或执行路径。
工作树 `.worktrees/psec-real-completion`、分支 `codex/psec-real-completion`，
承接已提交提示词包 `9defb7a16a27049f3d14bde7bb2e038fa5d2b45d`。

## 行为变化

- Live 不再接收或调用 `onFinalUserCommand`、`prepareTaskApproval`。即使调用方仍传入旧
  回调，最终音频“同意/不同意”也不会生成批准回执或触发该回调。
- 删除最终音频绑定审批问题、消费结果及 `voiceConfirmation` 投影。语音转写继续进入
  原历史保存路径；用户讲话、打断、播放、关闭通话等原有行为保留。
- `waiting_approval` 只简短提示查看当前对话的原授权卡，不复述参数或询问是否执行，
  不再返回 `ask_current_parameters_once`。兼容入口 `askCurrentQuestion()` 仅播报相同
  卡片提示，不能播报参数确认问题或消费决定。
- `waiting_reconciliation` 只有原当前卡通过任务/会话范围及有效期检查时才提示卡片；
  无有效原卡仍保留原任务的未知结果保护，不重新派发。
- 卡片决定之后继续读回原 `taskId`；原工作提交、进度、取消信号、停止通话、
  子任务卡片范围检查和未知结果恢复均沿用现有实现。

原 `voice-command-host` 当前消费实现已是“去原卡完成”的只读提示，但 Live 仍保留调用
旧回调和信任其 `consumed` 结果的业务入口。本包移除这条入口，而不是依赖回调永远只读。
`main.js` 中旧 `onFinalUserCommand`、`prepareTaskApproval` 和独立
`voiceApprovalBridge` 接线已交由主控清理，本包没有编辑 main 或授权 host。

## 人设与定向验证

Live 系统提示仅修改两段中的审批要求，删除“点头确认/现在执行吗”和最终音频批准口径。
其余完整段落的 SHA256 由直接测试固定为：

```text
041ab85d5829b44e6eebc2cdc065808f9120a104f8e6bba47733e40bd405bfae
```

两段内原有的能力说明、打断后读取原任务、成功与未定状态描述保持原文。未改语气、
身份或 JARVIS 风格段落。

使用 pinned Node 24.15.0，仅准备已有 TypeScript 依赖产物；未安装依赖或构建原生语音 host：

```text
node node_modules/typescript/bin/tsc -p packages/voice-wake/tsconfig.json
node node_modules/typescript/bin/tsc -p packages/voice/tsconfig.json
passed

node --check apps/desktop/electron/live-voice-host.js
passed

node --test apps/desktop/test/live-voice-host.test.mjs apps/desktop/test/live-voice-recovery.test.mjs
44 passed / 0 failed / 0 skipped / 0 cancelled / 0 todo

git diff --check
passed
```

首次执行因本树缺少 `@personal-agent/voice` 的 dist 导致测试入口加载失败，补齐上述
两个 workspace 的 TypeScript 产物后重跑通过；没有启动全量构建或原生 host 构建脚本。

直接测试包含有效当前最终音频、缺元数据、旧语句、回声和停止后的音频，均不能触发
旧批准回调；一个永不返回的旧准备回调不会被调用，也不会拖延状态读取。
Fake 原卡外部推进 Runtime 状态后，Live 从原任务读到结果且只有一次提交。
现有测试继续覆盖子卡范围、未知结果不重发、取消/期限、打断、历史保存和设备释放。

以上为明确 Fake/离线夹具验证，不代表真实麦克风、扬声器、模型听辨或卡片 UI 实测。
未启动模型/服务/应用，未读取私人数据库、配置或邮件，未修改云部署。
主控仍需合入本增量及 main 接线清理后，按另行授权验证真实语音与原卡交互。

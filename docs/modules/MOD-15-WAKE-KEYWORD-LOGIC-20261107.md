# MOD-15-WAKE-KEYWORD-LOGIC-20261107：唤醒词匹配、冷却与误触抑制纯逻辑

<!-- current-design-20261015 -->
> 当前协作规则：[接线交付总包](../competition/COLLABORATOR_WIRING_PACKAGE.md) · [模块分工](../MODULE_ASSIGNMENTS.md) · [当前设计](../design/CURRENT_DESIGN_20261015.md)。各 MOD 负责人自行闭环实现、公开契约、实际调用方接线、必要测试与 Evidence/文档。常规 PR 须由 zemeng5208、goo122、Potatos498、2511375597-lab 中任一非作者对当前提交有效批准；Owner zemeng5208 对具体 PR 的审核例外须在该 PR 明确记录，不伪称独立批准。拥有合并权限者（包括作者）可在最新必需技术 CI 通过、严格同步 main、无冲突且阻断意见已处理后合并；四位协作者跨 PR 均衡承担审查与合并，禁止强推、直接推 main 或绕过技术检查。

- Profile：`huawei_ict_agentarts`；模块负责人：`zemeng`（GitHub：`zemeng5208`）。
- 分支：`zemeng/mod15-wake-keyword-logic`；工作目录：`/workspace/mod15-wake`。
- 状态：`in_progress` / provisional；本 PR 交付纯逻辑与定向单元测试，不宣称接口冻结或实机验收完成。
- 本次文件范围：仅限 `packages/voice-wake/**` 与本说明文档；不改动 `apps/desktop/**`、Runtime、连接器、MOD-10；不碰 ZCode #584（`packages/voice/src/echo-guard.ts`）与 #552（`packages/voice/test/`）文件。

## 1. 范围与交付边界

本增量在 `@personal-agent/voice-wake` 内补全可测的纯软件唤醒词匹配、冷却判定与播放误触抑制逻辑，为后续宿主提供纯函数工具集与最小适配钩子：

1. **词表与短语规范化**：
   - `normalizeWakePhrase(phrase: unknown): string`：去除首尾空白、大小写折叠（`toLowerCase`）、将连续空白符（含半角空格、制表符、换行、全角空格 `\u3000`）压缩为单空格；非字符串安全返回空字符串。
   - `normalizeWakeLexicon(lexicon: unknown): readonly string[]`：遍历词表，规范化每项并过滤非字符串及空项，集合去重后返回只读冻结数组（`Object.freeze`）。

2. **多语言与中文空白容错匹配**：
   - `matchesWakeKeyword(phrase: unknown, lexicon: unknown): boolean`：支持大小写不敏感匹配；对中文等无分词连续短语做内部空白无感比对（如 `"你好 小派"` 与 `"你好小派"` 互认），防范 ASR 或限定语法输出空格差异导致的漏触。

3. **抑制条件判定**：
   - `isCooldownSuppressed(cooldownUntilMs: unknown, nowMs?: unknown): boolean`：纯时间戳比对，判定当前时间是否处于有限冷却期（`nowMs < cooldownUntilMs`）。
   - `isPlaybackSuppressed(playbackActive: unknown): boolean`：严格布尔校验，在扬声器播放活跃期间判定抑制，防范设备自发声回声误唤醒。

4. **综合命中评估**：
   - `evaluateWakeKeywordHit(input?: WakeKeywordEvaluationInput): WakeKeywordEvaluationResult`：纯函数组合匹配与抑制分支。
     - `matched: boolean`：候选短语是否命中规范化唤醒词表；
     - `suppressed: boolean`：若命中，是否被播放中或冷却中抑制；
     - `reason?: 'playback_active' | 'cooldown_active'`：被抑制时的具体原因；
     - `hit: boolean`：最终有效的唤醒命中（等价于 `matched && !suppressed`），被抑制时严格为 `false`，彻底避免外部调用方误用 `if (res.hit)` 引发播放中自唤醒；
     - `accepted: boolean`：与 `hit` 一致的显式语义别名。

5. **硬件边界与可用性收口**：
   - `checkWakeHardwareAvailability(options?: ...): WakeHardwareAvailabilityResult`：当缺音频采集硬件（`hasCaptureDevice: false`）或缺语音识别引擎（`hasRecognizerEngine: false`）时，严格返回 `available: false` 并标明 `hardware_unavailable` 或 `engine_unavailable`；不读麦克风、不启真实驱动。

6. **宿主最小接入钩子（可选适配）**：
   - 在 `createPcmKeywordWakeSignalSource(pcm, detector, options?: WakePcmKeywordSourceOptions)` 增加可选 `options.evaluateHit` 钩子。未传 options 时完全保持历史行为；若宿主传入评估钩子，则在 detector 检出时复核，未命中或被抑制时不向下游分发 `wake` 事件。

## 2. 明确排除与待验边界

- **无 Desktop 组合接线**：本 PR 不修改 `apps/desktop/**` 中的任何 Electron 主进程、Preload、Renderer 或 UI 代码。
- **无麦克风与原生设备调用**：本代码为纯计算逻辑与内存数据流适配，不调用 `navigator.mediaDevices`、Windows CoreAudio、System.Speech 或硬件驱动。
- **真实误触与声学回声指标待验收**：真实扬声器-麦克风互扰、物理环境误唤醒率、中文引擎真实发音命中率及硬件释放仍标记为待真机验收（`pending_real_device_acceptance`）。

## 3. 验收入口与结果

```text
npm run build --workspace=@personal-agent/voice-wake
npm test --workspace=@personal-agent/voice-wake
npm run check:architecture
git diff --check
```

本地执行记录：
- `npm run build --workspace=@personal-agent/voice-wake`：TypeScript 编译零错误，退出码 0。
- `npm test --workspace=@personal-agent/voice-wake`：**56/56 测试全部通过，0 失败，0 跳过**（包含既有 42 个生命周期与 PCM 适配测试，及新增 14 个唤醒词逻辑测试）。
- `npm run check:architecture`：**3/3 架构门禁测试全部通过**。
- `git diff --check`：无空白或冲突异常。

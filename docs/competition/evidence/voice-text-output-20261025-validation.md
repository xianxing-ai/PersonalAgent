# 2026-10-25 文字驱动语音：独立验收前置

目标 profile：`huawei_ict_agentarts`。独立工作树：`.worktrees/voice-output-validation-20261025`，基线 `origin/main@ad1a045e`。本记录不表示实现已合并、真实语音已调用或设备已通过。

当前受信环境就绪观测为 current，HTTP unrestricted/enforced；secrets、runtime_variables、outbound_identities 均为空。只查相关环境变量名及存在性，未发现 AgentArts、Qwen/DashScope、SIS/Huawei 配置。常用 Linux Desktop profile 不存在，工作区与用户配置目录未发现 AgentArts/Live/SIS 配置文件名；没有读取凭据、私人正文或历史密文。10/16 Windows 的历史真实语音证据不能代替本环境配置。

真实验收当前 blocked：缺少当前可用的受信 AgentArts binding 与凭据注入；并非已确认网络拒绝。没有开麦、调用账号写入、创建新账号、承诺付费或部署，也没有用合成波形代替语音模型。

当前范围按用户最新要求仅做可验收测试，不继续调查配置或要求用户配置。`node --test tests/manual/agentarts/agentarts-text-output-probe.test.mjs` 四项合成测试通过：完整里程碑与精确字节摘要、accepted/空回合不能假成功、错误脱敏与音频上限、超时关闭与预取消零连接。

本机 Chromium `154.0.8037.57` 通过 Playwright 实际运行生产 `mountLiveVoicePlayback`，输入为明确标注的合成静音 PCM16 little endian、24 kHz、单声道、100 ms、4800 bytes；原字节 SHA256 为 `24ddaa4710480313757f965c38d60208a334556cb244f830d5006a893edd8da7`。Web Audio 事件依次为 `ready → drained → stopped`，没有 error。这证明浏览器生产播放器对该格式的消费与释放，不能作为语音模型输出或真人听到声音的证据。Browser skill 已读取、工具检索无 Browser 工具；按明确本地 Chromium 验证范围使用现有 Playwright 与 `/usr/bin/chromium`，未安装依赖。首次 ESM 裸包解析失败，改用 Node `createRequire` 的现有环境依赖后通过。

真实云返回、真实语音内容、用户听到声音及平台 trace 目前均未验证。探针可在未来既有受信 gateway 可用时发送公开固定文字，记录音频原字节哈希、转写、完成及关闭回执；当前没有执行该真实调用，不把合成探针/播放器测试升级为 cloudmodel 通过。

独立审查普通 merge 固定生产提交 `7ed6b969` 与切会话修复 `cbcb47c4`。Desktop 仅在可信文字 task.submit 后绑定 taskId，Live request_work 不进入该集合；会话与 session id 双重绑定、成功终态单次消费、取消/中断/停止清理、8 条 pending 与 256 个 tracked 上限均有实现依据。初查发现会话切换后旧任务可能晚播，作者在 `cbcb47c4` 通过会话动作前后 active id 对比失效旧绑定、清理队列/打断已受理音频及拒绝切换后的晚受理绑定修复；固定提交静态复核未发现残留阻断问题。

独立树在 `7ed6b969` 的 text-output 单测 5/5、播放器单测 7/7 通过；host suite 因未安装独立 workspace 依赖 `@personal-agent/client` 无法加载。切会话提交新增 host 组合测试后，text-output suite 也因缺 `@personal-agent/runtime` 无法加载；此时播放器 7 项与 probe 4 项仍通过。按当前约束未并行安装/构建，也未借用其他工作树依赖，故新增 host 组合测试的独立运行保持未验，不将依赖加载失败标为通过。

## 作者树最终本地检查

作者工作树 `.worktrees/voice-text-output-20261025` 使用 Node `24.15.0`、npm `11.12.1`，独立 `npm ci --ignore-scripts --no-audit --no-fund`；没有借用其他树的 node_modules/dist。生产源码固定于 `b030da73`，之后仅合并本验收文档和修复测试组合依赖。

- `npm run build`：exit 0。
- 模型 realtime、Desktop text-output/Live host/playback/controls 加 manual probe 的最终定向：94/94 通过，exit 0；含切会话真实 host 组合场景（text-output 6/6）。
- `npm run check`：exit 1。架构门禁、contract fixtures、生成检查、全工作区 build/typecheck 已通过；工作区测试暴露本次新增宿主端口后旧 AST/VM fixture 缺依赖的 16 个失败，其他工作区继续执行，没有把此命令记为通过。失败分别来自 conversation-main-actions 9、panel-event-readback-order 3、panel-task-progress 2、panel-task-refresh-order 2。
- `8de308be` / `e4ebc0bf` 为这四个 fixture 注入显式 Live/原 delivery 端口，并加载生产 observeTextTaskOutput；新增实际 main 受理后绑定回归。首次 Desktop 复跑残留 progress fixture 两项失败亦保留日志。最终 `npm run test --workspace=@personal-agent/desktop`：1814 项，1789 pass、25 skip、0 fail，exit 0。
- 原 check 未进入的 `npm run test:integration`：57 项，54 pass、3 skip、0 fail，exit 0。修复仅改 fixture，因此未重复已通过的 build/typecheck 和 integration。没有声称最终重新运行整个 check 并通过。
- `git diff --check`：通过。

所有原始日志保留在作者树忽略目录 `.cache/voice-text-output-20261025/`：`check-final.log`（SHA256 `c504cbb43768cd83361f6687b945a659f697ade37a6524ea5288d37653c4799c`）、`desktop-verified.log`（`175afd5d0c90a848ae1f5e00b76f1db5066fbf1399ce3d4945e1d762977b8a8c`）、`integration-final.log`（`a4942719c70ff01f71cc76dfc025a15d501f88bb5e38183d9b855063b638d3fd`）、`targeted-final.log`（`da8f3231f83b9c8c9e5ff41c05c0d051a8ca2fa5f62d3e12b5c631c5eb1f7510`）。`check.log` 为生命周期修订前主动停止的旧检查（exit 143），`desktop-final.log` 为修最后一个 progress fixture 前的失败复跑，未覆盖或冒充最终结果。

以上是本地源码、合成模型事件和生产播放消费验证；真实供应商对本轮 response 参数及 item 删除的兼容性、真实文字模型驱动真实语音音频、逐字准确性、物理扬声器和人耳确认均未验收。当前条件下不自动调用其他 provider，不部署、不发布，不将模型自报或 accepted 视为音频证据。

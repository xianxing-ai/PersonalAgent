# 2026-10-25 文字驱动语音：独立验收前置

目标 profile：`huawei_ict_agentarts`。独立工作树：`.worktrees/voice-output-validation-20261025`，基线 `origin/main@ad1a045e`。本记录不表示实现已合并、真实语音已调用或设备已通过。

当前受信环境就绪观测为 current，HTTP unrestricted/enforced；secrets、runtime_variables、outbound_identities 均为空。只查相关环境变量名及存在性，未发现 AgentArts、Qwen/DashScope、SIS/Huawei 配置。常用 Linux Desktop profile 不存在，工作区与用户配置目录未发现 AgentArts/Live/SIS 配置文件名；没有读取凭据、私人正文或历史密文。10/16 Windows 的历史真实语音证据不能代替本环境配置。

真实验收当前 blocked：缺少当前可用的受信 AgentArts binding 与凭据注入；并非已确认网络拒绝。没有开麦、调用账号写入、创建新账号、承诺付费或部署，也没有用合成波形代替语音模型。

当前范围按用户最新要求仅做可验收测试，不继续调查配置或要求用户配置。`node --test tests/manual/agentarts/agentarts-text-output-probe.test.mjs` 四项合成测试通过：完整里程碑与精确字节摘要、accepted/空回合不能假成功、错误脱敏与音频上限、超时关闭与预取消零连接。

本机 Chromium `154.0.8037.57` 通过 Playwright 实际运行生产 `mountLiveVoicePlayback`，输入为明确标注的合成静音 PCM16 little endian、24 kHz、单声道、100 ms、4800 bytes；原字节 SHA256 为 `24ddaa4710480313757f965c38d60208a334556cb244f830d5006a893edd8da7`。Web Audio 事件依次为 `ready → drained → stopped`，没有 error。这证明浏览器生产播放器对该格式的消费与释放，不能作为语音模型输出或真人听到声音的证据。Browser skill 已读取、工具检索无 Browser 工具；按明确本地 Chromium 验证范围使用现有 Playwright 与 `/usr/bin/chromium`，未安装依赖。首次 ESM 裸包解析失败，改用 Node `createRequire` 的现有环境依赖后通过。

真实云返回、真实语音内容、用户听到声音及平台 trace 目前均未验证。探针可在未来既有受信 gateway 可用时发送公开固定文字，记录音频原字节哈希、转写、完成及关闭回执；当前没有执行该真实调用，不把合成探针/播放器测试升级为 cloudmodel 通过。

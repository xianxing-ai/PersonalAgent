# Desktop / AgentArts V5 真实连接记录

Profile 为 `huawei_ict_agentarts`，分支为 `codex/laya-owned-runtime`。本记录补充 V4 的历史证据，不将 28 张模板图升级为全部业务验收。

## 发布对象

- AgentArts 运行时 `pa-owned-bindings-0dae0ff5-api`，精确版本 `arm64-v5-d92a17a4-r3`；刷新控制台后，Latest 也指向该版本。
- 自有 ARM64 镜像 `workflow-v5-d92a17a4`，索引摘要 `sha256:b045e230e0a1bb049f45521a7031c3657fb6951d6ac97b4b17db0a6ea3dcd098`，镜像源码 `d92a17a4c436f37ff7a9bfdc5829044031a89bf7`。
- 实测 Desktop 源码 `2ed95c38a3056d368bc90523bb0bbd8e7465a8c9`；后续本机恢复和精选 UI 修改单独记录，不冒称已进入此镜像。Local Runtime/Policy/ToolGateway/Evidence 权限边界保持。
- 2 核、8 GiB、端口 8080、原委托、入站认证和平台日志保留。Laya 仍在本机，不改变质量或架构结论。

## 已完成的真实链路

| 表面 | 原始回执 | 结果 |
| --- | --- | --- |
| Desktop 主任务 | `desktop-receipt.json` 的 `text` | 固定版本 WSS 101，DeepSeek-V4.1-Flash / low，任务 succeeded；提交至终态 13.189 秒 |
| 主模型派发子任务 | 同文件 `delegation`、`cloudCalls` | DeepSeek 提案 → 原 Policy/ToolGateway → Qwen3.8-Flash 子任务 → 原回执投影 → 主模型续答；父子任务均 succeeded，整链 15.520 秒 |
| 子模型耗时 | 同文件 Qwen 调用 | 5.162 秒；父模型首次提案 4.014 秒、续答 4.771 秒，均含网关传输，不能当纯 GPU 前向 |
| 通道 | 同文件 `sockets`、`httpTaskCalls` | 真实 Upgrade 101，HTTP 任务调用为 0；元数据读取另计，不是任务降级 |
| 平台独立读回 | `platform-models-final.json` | Qwen HTTP200；DeepSeek 主请求与续答 HTTP200，实际请求字段 low；保留此前 Qwen403 作对照 |
| 原生实时语音 | `voice-receipt.json` | 同版 WSS / `pa.realtime.v1` → 百炼原生实时模型，输入转写、输出转写、音频、轮次结束和关闭全部齐备 |

原任务状态与模型回答中的 `verification=unverified` 保留。简单数学值可独立校验，但本记录不把模型自报提升为业务工具或代码执行 Evidence。子任务没有文件操作，所以其 `evidenceRefs` 为空；父 dispatch 的原执行记录由 Runtime 保存。

语音只发送公开 Windows 合成中文 PCM：『你好。这是公开的语音连接测试。请只回答连接成功。』没有录音或播放。runner 从调用 gateway.connect 开始计时：ready 878.837ms、首次输入转写 2504.992ms、输出转写 2819.352ms、音频 6365.288ms、轮次完成 9494.599ms、关闭 9706.362ms。包含按音频时间发送的输入，不能把整轮 9.707 秒解读为一句话结束后的回复延迟。`socketEvidence.wallMs` 的外层起点还包含工厂准备，两个时钟不混算；不代表实体麦克风、扬声器、唤醒或听感通过。

## 真实失败与修复

1. 严格 Coordinator 起初遗漏 `executionModel` 可选字段，已补齐原 query 验证和工厂回归。
2. 子任务可发现 Schema 起初遗漏 role/effort 的公开 enum 路径，实际生成提案被拒；已补充，不放宽执行校验。
3. Desktop 原结果投影向缺失 result/error 写入 undefined，严格 JSON 拒绝导出。现生产投影省略缺失字段，成功/失败都覆盖实际工厂与原 ToolGateway 回归。
4. 语音 401 来自配置转交时使用了浏览器遮罩值。通过受信官方控制 API 修正并独立核对原安全配置后，r3 语音实测通过；凭据未进入公开回执。
5. Qwen403 来自专用密钥只允许实时语音。Owner 明确确认后，已在百炼将同一密钥设为全部已授权模型；原账号 IAM、其他密钥及原 API 设置未改变。修改后同一 r3 / Qwen 请求 HTTP200，完整主子任务通过。没有模型静默回退。
6. 原 panel 失败任务仍有 export-withheld 待核实记录，停止请求受理不等于终止；不删库、不重开、不重发。后续本地终止核实增量必须通过原 confirmed 回执、缓存、子任务绑定与 CAS 检查，实际结果另附。

失败摘要见 `prior-failures.json`；私人完整日志仍留本机。早先完整根检查曾分别遇到旧夹具错误和一次邮件分类不可用；后者未稳定复现，根因仍 unknown。已有串行 Desktop、Runtime、根集成通过记录不等于最新提交的全量检查，最终检查单独登记。

## 运行与边界

按仓库规定版本安装依赖并构建后，在根目录运行 `npm run start:desktop`。设置 → 模型中填写本机安全保存的 AgentArts 连接、精确部署版本、WSS URL，并刷新目录。原独立 API 字段保留；比赛模式语音走 AgentArts，F8 按现有 Live 设置由用户启用，保存配置不打开麦克风。凭据不随源码或交接包分发。

模型目录共有 177 项，其中 127 项文本；全部开放权限不等于全部模型协议、额度和推理已验收。本轮真实推理覆盖 DeepSeek-V4.1-Flash、Qwen3.8-Flash、Qwen3.8-Omni-Flash-Realtime。其他条目保持原 `unverified`，非文本不能充当思考模型；所有新增接口仍 provisional。真实设备、全部模型、28 条业务图、平台全 Trace、长期 WSS 保活及压力测试未在此验收。

本目录 JSON 为公开测试数据；没有音频设备采集、密钥、授权头、安全存储文件或数据库。`manifest.json` 给出文件 SHA256，方便核对。

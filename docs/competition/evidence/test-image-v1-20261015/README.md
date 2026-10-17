# 本地 ARM64 测试镜像 v1（2026-10-15）

目标 profile：`huawei_ict_agentarts`，分支 `codex/laya-owned-runtime`。本历史 V1 阶段未提交、推送、部署或发布；当前 V3 后续发布与验证见相邻 `test-image-v3-20261015`，不能倒填至 V1。公开说明省略开发机个人工作树前缀。

- 最终镜像：`personal-agent:test-v1-local-laya`，ID `sha256:e8aa319df4f93da61543a4100c51aeee973fabd392c0179b8142562e9d009889`。
- 最终冻结上下文：`.cache/agentarts-image/context-azpd0S`；`source-manifest.json` 记录 HEAD、dirty status、48 项源码和 88 项上下文文件 SHA256。镜像包含未提交修改，不能仅用 HEAD 还原。旧 `context-5q1QiG` 保留但已被替代，旧镜像/归档哈希不代表最终交付。
- 构建命令：`docker build --platform linux/arm64 --tag personal-agent:test-v1-local-laya .cache/agentarts-image/context-azpd0S`，exit 0；日志 `.cache/agentarts-image/test-v1-build.log`。最终镜像包含 owned-review/显式 abstainIds 识别与本机服务初始化失败释放修正，云端 main/server/controller 未变；最终两模式 smoke 已重新通过。
- `smoke.json`：实际 ARM64 容器、生产 main 入口、UID 1000、健康接口、28 工作流/185 节点；默认关闭及显式启用 testVersion 两模式均通过。启用模式验证 capabilities、有效 model_turn、缺失凭据/未知 modelRef/非法消息 role 拒绝。仅 synthetic.invalid 模型 fetch 被显式替换为合成 OpenAI Response，实际 HTTP /invocations → controller → ModelGateway → Provider → 序列化链路完成；`mockProviderCalls:1`，默认关闭模式为 0，拒绝请求不递增。容器 `--network none`，MaaS 调用为 0；这不是真实模型成功。首次追加 smoke 的断言误用 response.content 导致失败，按公开协议改为 response.text 后重跑通过，未改镜像源码。
- `context-artifact.json`：最终 allowlist 构建上下文归档 `.cache/agentarts-image/test-v1-build-context.zip`，190,858 bytes，SHA256 `75f36ed366c961619aeaa29d234fc9e9d4a04cfcabe2e01f5de5d4d290ecd5dd`；解压后从 `context-azpd0S` 构建。
- `image-artifact.json`：最终 docker save 归档 `.cache/agentarts-image/test-v1-local-laya.tar`，80,805,376 bytes，SHA256 `60eb752ba1b3c91e00edc416867c19706bf33fac9754b8a9631db6940969a549`。可使用 `docker load --input <archive>` 导入。

镜像仅包含云端工作流、节点与模型接入代码。Laya 服务、权重及受信工具执行保留本机。构建时的无网 smoke 不构成真实 MaaS/GPU 证明；后续真实专项测试见下，华为平台部署仍未验证。

协调者提供的独立验证回执：补丁前 `npm run check` exit 0，37 轮 TAP 汇总 3145 项、跳过 18、fail 0，日志 `.cache/test-version-check.log`；最终两处内部适配补丁后相关 HTTP/初始化/owned-review 回归 18/18 通过，该最终 snapshot 未重跑全量 check。首次初始化夹具 port=1 被真实校验拒绝，改为 44174 后通过，未放宽生产校验。新增手工接口/业务/分派单测不在根检查自动脚本内。浏览器开发自验 `tests/manual/agentarts/pelican-browser-selftest.mjs` exit 0，报告 `.cache/pelican-browser-check-1ZQDPL/report.json`，正负夹具运动符合预期、JS errors 0、`agentRepair:false`、`modelCalls:0`。这些结果由协调者报告，本镜像构建代理未重新执行；浏览器夹具不是模型修复成果。

## 后续真实专项证据

[live-test-results.json](live-test-results.json) 脱敏汇总第五轮 `.cache/pelican-test-version-5WrrrR/report.json`、对应 `launch.json/resources.json` 的来源 SHA、被测源码 SHA、实际 Provider tokens、分支初始失败/最终成功及 Evidence 引用；不复制原始模型返回、密钥或本机绝对路径。

第五轮本地镜像 → 真实 MaaS → 本机 Runtime/Policy/ToolGateway/编码工具/Edge SMIL 主影子修复 → 结果比较 → 单次 CAS 交付通过，耗时 167.886 秒，15 次真实模型成功返回、57,986 Provider tokens。main 49.251 秒，shadow 37.057 秒；两分支初始 `passed=false`、最终 `passed=true`、Runtime `succeeded`，最终采用 shadow SHA `60459cf294de2bfda7a3bc6676cbf25e626af7aef5ff43cd990e1be065530147`。main 本轮确有非法提案格式 → 严格拒绝反馈 → 模型修正 → 最终验证成功。

本机 GPU Laya 三次真实调用为 305.80/163.46/223.84 ms，三处未验证站点均实际升级 DeepSeek；独立裁决质量和 150 ms 目标均未通过。完全相同已验证案例复用 1 次，不是训练。资源只记录测试进程 PID 采样，没有同任务 Codex 公平基准；OS 线程不能等同 Torch intraop 线程。

前四轮失败或部分成功回执仍保留在 `.cache/pelican-test-version-{s6w6zY,IJrmdT,TLWsdA,fp0OVx}/report.json`。第四轮仅 shadow 成功并真实单次交付，整体仍为 partial。未据此验收 28 业务链、华为部署或所有恢复路径。`architectureFinalized=false`、`published=false`、`platformDeployment=false`。

第五轮在后补 maxTokens 保护前执行且未传 maxTokens。真实测试旧源码 SHA、后补预算保护后的最终源码 SHA 与离线检查分别记录；未对最终 agents SHA 重跑真实模型。本轮 host-only 修正没有改变上述镜像 ID/tar SHA。

最终全仓 `npm run check` exit 0，37 个 TAP 汇总：3,166 tests、3,148 pass、18 skipped、0 fail、0 cancelled；`.cache/test-version-final-check.log` SHA256 `57ac0b767372faa97a4466c5963d47be9022ec30182648c4979b6f595d05fd00`。最终手工包 22/22（11 pelican、4 business、7 delegation），`.cache/test-version-final-manual-check.log` SHA256 `cab382ba4d621f675187968b41e215092c7812585645a8b4bef6055ff6e4cace`，真实模型调用 0。预算 guard 的 25 项受影响集合属于子集，不额外计入总数。

最终 agents 源码 SHA `7266ddf8f4685e4cfe231fe87fd13ddcf89fc94ec00e90f1affdf030d275660b`，dist SHA `6d4aa128461b058ec288fe8804d02a7a92af06b707ddb7a5824fd10cc18eb7b5`；被测旧 SHA 仍保留。文档证据已收尾，源码 ZIP 待协调者立即更新；test-kit 的旧 sourceZip 在替换前仅代表历史归档。

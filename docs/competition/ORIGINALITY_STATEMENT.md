# 原创性声明核对稿（华为 ICT 大赛·AgentArts 赛道）

> 项目名称：衔星（Synstar），个人智能助手（xianxing-ai/PersonalAgent）
> 申报团队仓库：https://github.com/xianxing-ai/PersonalAgent
> 核对日期：2026-11-26。签署状态：待权利人核验。
> 配套清单：[OPEN_SOURCE_LIST.md](OPEN_SOURCE_LIST.md)（第三方开源组件清单）

## 1. 拟申报范围

本稿列出拟申报的模块、第三方直接依赖和已知模型分发记录，供团队逐项核对。第一方源码、第三方素材和数据的归属由有权代表相应权利人的人员对照提交历史、许可文件和实际交付物确认。

## 2. 原创范围

以下为提交给权利人核对的项目实现。

1. **协议与契约层**（`packages/contracts`）：公开 operation/tool Schema、版本化契约与生成工具链。
2. **认知与编排层**（`packages/coordination`、`packages/cognition`、`packages/agents`、`packages/goals`、`packages/learning`）：Goal/Fact/Decision/Plan 版本化世界状态、工作流图编排、任务生命周期、审批循环。
3. **AgentArts 云侧运行时**（`packages/agentarts`、`apps/agentarts-runtime`）：部署适配、Laya 编排服务、trace/评估接入、模型代理。
4. **受信设备宿主**（`apps/windows-host`、`packages/windows-client`、`packages/voice`、`packages/voice-wake`）：Windows 原生受限执行（记事本/UIA）、语音听写与唤醒生命周期。
5. **桌面应用主进程受信层**（`apps/desktop` 的 Electron 主进程部分）：IPC 隔离、审批卡、设置与任务消费。
6. **策略与工具网关**（`packages/policy`、`packages/tool-gateway`）：fail-closed 授权、工具执行证据与幂等重放。
7. **知识/记忆/学习**（`packages/knowledge`、`packages/memory`、`packages/learning`）：来源版本、受控写回、事实投影。
8. **业务连接器**（`packages/connectors`）：日历/待办/邮件/订阅/天气/研究/通知等连接器实现与真实来源读回。
9. **子智能体编排**（`packages/crew`）：驱动、任务分解、角色生命周期与协作测试。
10. **比赛材料**（`docs/competition`、`docs/demo`）：评测集、评估脚本与演示文档。

## 3. 第三方使用边界

- 协议解析、传输、文档解析、OCR、邮件和 Windows 构建工具使用的直接 npm 依赖见[开源组件清单](OPEN_SOURCE_LIST.md)。各组件版本可对照根锁文件。
- 演示资料见[工作区演示](../demo/WORKSPACE-DEMO.md)，评测题目、期望结果与评分规则见[评测目录](evaluation/README.md)。公开提交前须核对实际采用的数据与素材来源，以及相应使用许可。

## 4. 模型与数据

- 当前主线 `707ea6f6` 的云镜像使用 `PA_AGENT_LAYA_MODE=local`。构建器复制列入清单的应用和运行包，Laya 在 Windows 宿主加载。可核对 [Dockerfile](../../apps/agentarts-runtime/Dockerfile) 和[镜像输入生成器](../../apps/agentarts-runtime/scripts/image-context.mjs)。
- 历史 ARM64 版本 `arm64-laya-fe886677` 使用 embedded 模式，发布记录记载镜像包含 Laya multilingual 权重，模型 revision 为 `55cf4c4ebb4ebe31b2550e8bdf3bd21b99753851`。[历史发布与调用记录](OWNED_LAYA_RELEASE_AND_CALLS.md)
- 最终参赛范围按实际提交的镜像摘要、桌面附件和评测资料核对。若交付模型权重，需同时核对权重版本、分发许可及适用的署名要求。

## 5. 责任

权利人核验后填写最终交付物版本、权利依据及签署日期。当前仓库保存本核对稿，正式参赛声明以权利人签署的版本为准。

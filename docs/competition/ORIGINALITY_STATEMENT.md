# 原创性声明（华为 ICT 大赛·AgentArts 赛道）

> 项目名称：PersonalAgent —— 个人智能助手（xianxing-ai/PersonalAgent）
> 申报团队仓库：https://github.com/xianxing-ai/PersonalAgent
> 声明日期：2026-11-05
> 配套清单：[OPEN_SOURCE_LIST.md](OPEN_SOURCE_LIST.md)（第三方开源组件清单）

## 1. 声明

我们声明：参赛项目 PersonalAgent 的核心设计与全部第一方源码为参赛团队独立完成的原创成果，未抄袭、未复制任何第三方项目的源码、配置或文档；项目中使用的第三方开源组件均已在 [开源组件清单](OPEN_SOURCE_LIST.md) 中如实登记，并以 npm 依赖形式按其原始许可证引入，未修改其许可证声明。

## 2. 原创范围

以下均为本团队原创设计与实现：

1. **协议与契约层**（`packages/contracts`）：公开 operation/tool Schema、版本化契约与生成工具链。
2. **认知与编排层**（`packages/coordination`、`packages/cognition`、`packages/agents`、`packages/goals`、`packages/learning`）：Goal/Fact/Decision/Plan 版本化世界状态、工作流图编排、任务生命周期、审批循环。
3. **AgentArts 云侧运行时**（`packages/agentarts`、`apps/agentarts-runtime`）：部署适配、Laya 编排服务、trace/评估接入、模型代理。
4. **受信设备宿主**（`apps/windows-host`、`packages/windows-client`、`packages/voice`、`packages/voice-wake`）：Windows 原生受限执行（记事本/UIA）、语音听写与唤醒生命周期。
5. **桌面应用主进程受信层**（`apps/desktop` 的 Electron 主进程部分）：IPC 隔离、审批卡、设置与任务消费。
6. **策略与工具网关**（`packages/policy`、`packages/tool-gateway`）：fail-closed 授权、工具执行证据与幂等重放。
7. **知识/记忆/学习**（`packages/knowledge`、`packages/memory`、`packages/learning`）：来源版本、受控写回、事实投影。
8. **业务连接器**（`packages/connectors`）：日历/待办/邮件/订阅/天气/研究/通知等连接器实现与真实来源读回。
9. **子智能体编排 `packages/crew`**：参考了公开开源社区关于多智能体协作的**架构思想**（角色分层、任务分解、结果聚合），但**未复制任何一行第三方代码**；接口、实现、测试均为原创。
10. **比赛材料**（`docs/competition`、`docs/demo`、评测集与评估脚本）：原创编写。

## 3. 第三方使用边界

- 第三方组件仅作为**依赖库**使用（见 [OPEN_SOURCE_LIST.md](OPEN_SOURCE_LIST.md)），未将其源码合并为本仓第一方代码，未移除或篡改其许可证与版权声明。
- 第三方组件用于通用基础能力（协议解析、传输、文档解析、OCR、SMTP/IMAP、浏览器自动化、构建工具链），项目的核心创新点（受信执行边界、审批闭环、版本化世界状态、整图接线与评估体系）均不依赖任何第三方框架。
- 未使用未获授权的数据集；知识库演示内容为合成资料（见 `docs/demo/WORKSPACE-DEMO.md`），天气/订阅等真实数据仅在获得授权后经真实来源读回取得。

## 4. 模型与数据

- 模型调用经华为云 AgentArts 平台及配置的 Provider 完成，本仓不含、不分发任何模型权重。
- 评测集（`docs/competition/evaluation/`）为团队原创编写的测试题目、期望结果与判分规则；评估运行产生的 Trace 为系统实际运行记录，不作人为修饰。

## 5. 责任

如本声明与事实不符，团队愿承担相应责任并按大赛规则处理。本声明与开源清单随代码演进同步维护，任何新增第三方依赖必须同时更新清单并通过自动校验。

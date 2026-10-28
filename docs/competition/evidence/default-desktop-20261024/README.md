# 默认生产桌面公开夹具回执（2026-10-24）

本目录保留真实默认对话修复的脱敏回执，不含账户配置、凭据、用户历史或 SQLite 正文。目标为 `huawei_ict_agentarts`；生产 Desktop Main／panel／默认 user-work 调用已配置 AgentArts WSS，再通过原 Policy、ToolGateway、Native host 与 Evidence 执行。没有 Fake Model、Fake Tool 或本地模型回退。

- [成功回执](pelican-default-success.json)：第八次全新公开夹具通过，父子任务均 succeeded；原读取／预览／应用／项目测试记录、独立文件核验、重启读回和实际 SVG 播放都核对。
- [失败元数据](pelican-failed-attempts.json)：前七次失败的观察原因、记录状态、原始回执 SHA 与源码身份。没有把模型误报完成或被 runner 拒绝的结果改成通过。
- [原生进程预检](native-preflight.json)：本机固定 helper 的实际隔离检查；源码重建来源仍 `not_reestablished`。
- [原生项目命令](native-project-command.json)：仅提供项目测试配方时，正式 Native host／正式固定路径配方在真实 Windows PSEC 中启动 Node 并通过一项公开测试。提问宿主为明确 Synthetic，不能替代 UI 或 Policy 验收。
- [多文件原验收未通过元数据](progressive-failed-attempts.json)：六次原脚本记录分别保留。第五次是采样 `EBUSY` 中断；第六次原父子任务已成功，但脚本拒绝了选择不同文本跨度、结果字节相同的预览／应用参数。原脚本失败与原产品任务状态分别登记。
- [多文件目标独立读回成功](progressive-success-readback.json)：第六次原任务在第 45 步完成，子任务 44 次工具调用均 confirmed，窗口 32→64，14 项原生项目测试及 14 项独立 Node 检查通过。补丁输入分别校验原 Runtime 绑定，并严格核对相同原文件与完整结果字节；隔离副本冷启动保留原状态及记录，没有新云调用或工具重放。原失败回执、原数据库及源码字节不改。
- [冷启动实际面板](progressive-desktop-result.png)与[图片 hash](progressive-assets.json)：原自有 Electron 的真实截图，逐图查看后按原字节复制；面板自然停在长回答底部，完整目标证据以上述原记录为准。
- [原云调用只读查询](progressive-status-unknown.json)：第四次原请求的 ID、摘要及实例均匹配，返回 `unknown`，没有发送第二次 invoke 或改写原 Runtime。随后只通过自有测试 UI 取消该任务，保留原子任务 `waiting_reconciliation`。
- [最终本地组合检查与校验测量](combined-verification.json)：第五轮整仓 exit 0，6,027 pass／29 skip，152 份冻结源码哈希；125 项 WSS 恢复等聚焦使用合成 socket／时钟、真实 Runtime／Policy／SQLite。72 条回执的校验测量只是一前一后本机样本，无真实云调用。
- [验收进度与读回规则修复](progress-observer-fix.json)：全检后仅手动验收脚本修复，17 项回归通过；分别保留原输入绑定、原文／结果哈希、预测全文和真实执行状态反例。生产源码未改，最终文件／独立测试保持严格，新增独立读回脚本的哈希单独记录。
- [平台控制台非敏感字段读回](platform-console-readback.json)：正式 UI 列出 `arm64-output32k-1023` 与 SWR `context-128k-20261022` 标签，和实跑配置的版本名相符；没有改平台配置。UI 标签不能证明不可变 digest、启动覆写内容或容器精确源码，平台 API／trace 读回仍未完成。
- [可编辑修复产物](pelican-fixed.svg)、[第一帧](pelican-frame-1.png)、[第二帧](pelican-frame-2.png) 及 [hash 清单](assets.json)：均来自原实际运行，三个动画的变换矩阵有原时间戳。

单文件默认任务的子任务为 6 步；14 模块原任务及独立读回单独证明了 45 步执行，不混合计数。授权卡由脚本核对原待执行调用、参数摘要和持久允许回执后自动激活，物理用户点击 `not_run`。配置目标为 `arm64-output32k-1023`；平台部署／版本／trace API 独立读回、F15 完整工作流、任意大型项目及安装发行均未由本回执验证。依赖为空的 `workspace.npm_test` 实际通过原生宿主执行 `node --test`，不能据此称 npm CLI 已执行。

成功实跑的源码 SHA 与后续 WSS 有效窗口／重启恢复修正分别记录；原回执不冒充新源码的重复实跑。当前集成与新验证入口见[实施记录](../../PROGRESSIVE_EXECUTION_20261024.md)。原始本地文件、完整日志及加密测试 profile 留在主工作树被忽略的 `.cache/`，未导出到仓库。

10 月 25 日的窗口销毁异常、固定提示及自定义入口标签修复使用独立的[桌面集成复验](../desktop-integration-20261025/README.md)。该组明确采用回环 HTTP 模型夹具；本目录的原真实云回执与历史源码哈希保持不变。

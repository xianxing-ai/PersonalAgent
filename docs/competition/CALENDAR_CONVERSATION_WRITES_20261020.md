# 日历写能力的 Desktop 消费接线

状态：in_progress；profile：`huawei_ict_agentarts`；实施者 goo122；业务模块长期负责人 Potatos498。
隔离工作树 `27bb/Personal Agent`，分支 `codex/calendar-conversation-writes`。

## 依赖和范围

- 消费 #442 原连接器对话宿主和 #439 的可选 `CalendarProvider.writes`，沿公开 `register()` 获得 `calendar.create/update/cancel`，不重写其工具或创建第二个注册表。
- 本分支将依赖提交普通合并后验证；它们尚未合并主线。PR 的依赖和主线净差异分别核对，不能将本分支登记当作 main 已可用。
- 主进程继续使用原加密日历配置及异步凭据端口，懒建真实 CalDavProvider，参数不包含账号、URL或凭据。原 Runtime/Policy/ToolGateway 决定授权和执行；三项操作均为 external_write/calendar:write，不加入 automaticTools。
- 完整 metadata/result 原生出机许可独立于执行批准，绑定任务、会话、参数和配置身份。撤销或更换配置后旧执行/导出失效，取消、期限和异步凭据读取继续受原守卫约束。
- 新传输兼容增量仅为 `CalDavFetchResponseLike.headers?.get()`，只读夹具仍兼容；更新/删除若缺少强 ETag 则明确不支持。无 Core wire、Schema、数据库迁移、依赖或锁文件变化；保持 provisional/conditional。

## 写入保护

- 创建发送 `If-None-Match: *`，同 UID 冲突不覆盖；内容完全一致时只读回原资源，内容不一致返回 REVISION_CONFLICT。
- 修改/删除使用 GET 得到的强 ETag 发 `If-Match`，并发版本变化返回冲突，不强行覆盖或重复未知写入；删除须再读回404才确认。创建/修改仍核对实际字段。
- 原取消/超时进入 Runtime unknown/waiting_reconciliation，不把已发生效果重新执行或伪装成成功。
- UID 与资源 href 的真实映射及目的地约束仍在本包补充验证；未完成前不将本包转为可交付。
- 标准依据：[RFC4791资源创建与条件更新](https://www.rfc-editor.org/rfc/rfc4791#section-5.3.2)。

## 已执行的分层验证

- Desktop缺接线用例先失败；接入后21/21，包含三项真实Runtime/Policy消费的批准前零写入、批准后一次confirmed，以及在途取消后unknown且不重发。
- 本机HTTP夹具使用实际CalDavProvider、原Desktop代理及原公开工具完成创建/修改/删除与读回；服务器为显式合成资源，真实账号和真实日历服务均未调用。
- 提供者冲突/缺ETag/删除未消失用例先失败；条件写入后日历71通过/3既有真实读回门控跳过。
- 整仓检查正在执行，最终结果与后续增量复验由下节记录，不预填成功。
- 本机证据在忽略目录 `.cache/verification-20261019/`：calendar-wiring-red、calendar-wiring-transport-fixed、calendar-conditional-red、calendar-conditional-test及calendar-wiring-full-check日志。保留失败记录，不提交账号、原文、数据库或安装物。

## 平台与真实验收边界

本包是宿主消费、授权和HTTP一致性代码验证，未修改镜像/工作流，不以工程测试冒充华为评测集或评估任务。固定云版本未重新发布；评测集/评估任务、真实账号读写、时区/全天/重复事件业务、通知和完整F07仍未验。仅当前输入支持和保护范围可消费，不提升整个MOD或28图状态。

真实日历操作只按对应账号和动作授权进行。当前本机回环HTTP仅在测试工厂显式启用，正式设置的回环支持沿#441独立交付，不扩大任意HTTP或凭据目的地。

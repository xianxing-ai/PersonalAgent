# 日历写能力的 Desktop 消费接线

状态：review（离线接线及本机HTTP夹具已验，当前head CI/独立批准与真实账号验收分别待核）；profile：`huawei_ict_agentarts`；实施者 goo122；业务模块长期负责人 Potatos498。
隔离工作树 `27bb/Personal Agent`，分支 `codex/calendar-conversation-writes`。

## 依赖和范围

- 消费 #442 原连接器对话宿主和 #439 的可选 `CalendarProvider.writes`，沿公开 `register()` 获得 `calendar.create/update/cancel`，不重写其工具或创建第二个注册表。
- 本分支普通合并#439至`89dcb848`，保留其最新时间字段保护及main `93e00889`。依赖尚未全部合并主线；PR依赖与主线净差异分别核对，不能将本分支登记当作main已可用。
- 随后保留#442至`740384ea`的每次执行独立连接和有界清理增量，避免单次取消影响其他在途调用；原同分支提交未覆盖或强推。
- 主进程继续使用原加密日历配置及异步凭据端口，懒建真实 CalDavProvider，参数不包含账号、URL或凭据。原 Runtime/Policy/ToolGateway 决定授权和执行；三项操作均为 external_write/calendar:write，不加入 automaticTools。
- 完整 metadata/result 原生出机许可独立于执行批准，绑定任务、会话、参数和配置身份。撤销或更换配置后旧执行/导出失效，取消、期限和异步凭据读取继续受原守卫约束。
- 新传输兼容增量仅为 `CalDavFetchResponseLike.headers?.get()`，只读夹具仍兼容；更新/删除若缺少强 ETag 则明确不支持。无 Core wire、Schema、数据库迁移、依赖或锁文件变化；保持 provisional/conditional。

## 写入保护

- 创建发送 `If-None-Match: *`，同 UID 冲突不覆盖；内容完全一致时只读回原资源，内容不一致返回 REVISION_CONFLICT。
- 修改/删除使用 GET 得到的强 ETag 发 `If-Match`，并发版本变化返回冲突，不强行覆盖或重复未知写入；删除须再读回404才确认。创建/修改仍核对实际字段。
- 原取消/超时进入 Runtime unknown/waiting_reconciliation，不把已发生效果重新执行或伪装成成功。
- 修改/取消按UID定向REPORT解析真实资源href，不猜测UID.ics；拒绝重复UID目标、跨源/跨集合/子目录/编码穿越/查询/片段，不向未验证目的地发送凭据。删除前再次核对原UID，避免文件名相同而误删另一事件。
- 保留原只读UID语法并对XML过滤值转义。协作者的全天/时区/原字段保留与整秒精度拒绝均保留；写请求的提前计时器回调须复查实际截止时间，不提前终止仍有效的操作。
- 规范UTC日期必须能逐字往返，拒绝JavaScript自动归一的2月30日、无效闰日及24:00；创建/修改在任何请求前拒绝这些输入。
- 标准依据：[RFC4791资源创建与条件更新](https://www.rfc-editor.org/rfc/rfc4791#section-5.3.2)。

## 已执行的分层验证

- Desktop缺接线用例先失败；日历增量22/22，合入协作者取消边界后完整宿主31/31；包含三项真实Runtime/Policy消费的批准前零写入、批准后一次confirmed，以及在途取消后unknown且不重发；非回环HTTP在任何请求前拒绝。
- 本机HTTP夹具使用实际CalDavProvider、原Desktop代理及原公开工具完成创建/修改/删除与读回；服务器为显式合成资源，真实账号和真实日历服务均未调用。
- 提供者冲突/缺ETag/删除未消失、UID资源名不一致/不可信href、提前计时器和非法日期用例分别先失败；最终日历92通过/3既有真实读回门控跳过，构建及类型检查通过。补齐假服务器REPORT支持后，删除后的getEvent直接核对undefined，不再以夹具不支持REPORT的异常代替缺失读回。
- 整仓初轮825秒，架构/契约/生成/构建/类型通过，Desktop1386通过/9跳过，Runtime876通过/1失败（原主Agent F15全图未到预期状态）。该快照之后合入协作者最新日历修复和UID定位增量；最终受影响模块、集成51/51、最新原生思考控件12/12定向复验通过，F15同文件独立28/28。保留初轮失败，不宣称默认并行根因已修复或最终head单次整仓全绿。
- 文字和Runtime Application两项烟测均退出0。二者均为独立数据目录的显式合成配置，不是原用户实例或真实模型验收。
- 本机证据在忽略目录 `.cache/verification-20261019/`：calendar-wiring-red、calendar-wiring-transport-fixed、calendar-conditional-red、calendar-conditional-test及calendar-wiring-full-check日志。保留失败记录，不提交账号、原文、数据库或安装物。

## 平台与真实验收边界

本包是宿主消费、授权和HTTP一致性代码验证，未修改镜像/工作流，不以工程测试冒充华为评测集或评估任务。固定云版本未重新发布；评测集/评估任务、真实账号读写、时区/全天/重复事件业务、通知和完整F07仍未验。仅当前输入支持和保护范围可消费，不提升整个MOD或28图状态。

真实日历操作只按对应账号和动作授权进行。主进程工厂允许提供者严格校验的回环HTTP，实际HTTP夹具已使用默认生产工厂而非测试替身；非回环HTTP仍拒绝。正式设置接收回环地址沿#441独立交付，不扩大任意HTTP或凭据目的地。真实CalDAV账号和完整F07仍未验；没有新增付费调用或云发布。

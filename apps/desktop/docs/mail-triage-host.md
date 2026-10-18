# QQ 信头本地分类：main 装配

<!-- current-design-20261009 -->
> 当前目标与协作规则（2026-10-09）：[完整设计](../../../docs/design/resident-developer-agent-20261008/DESIGN.md) · [离线阅读/全部 SVG](../../../docs/design/resident-developer-agent-20261008/index.html) · [两人确认与本机阅读门槛](../../../docs/reviews/DESIGN_READING_GATE.md)。WSS 主通道、HTTPS 备用；Wiki 记忆由 goo122 接入。goo122 与 Potatos498 均确认后才可按授权合并，禁止强制合并/管理员绕过。设计不等于已实现；本文历史验收与作者记录保留，旧合并规则以当前门槛为准。

> 维护入口（2026-10-07）：项目主要负责人为 zemeng；当前分工以 [模块分工](../../../docs/MODULE_ASSIGNMENTS.md) 为准，最新状态见 [ROADMAP](../../../docs/ROADMAP.md)。历史日期、作者和验收结论按原记录保留。

本片不读取任何真实账号。连接器仍由 Potato 维护；只消费公开 QQMailProvider/register，未新增邮件写工具或云端出口。

本轮 main 与“设置 → 连接”已接入以下配置和操作；“记忆”页也提供 Laya 启停。只在明确点击“启动本地模型”后发现当前 checkout/Git common root 内已安装缓存并启动项目 batch-server；不下载、不复用未知 Python 进程、不自动加载权重。模型子进程不继承云服务凭据，停止会取消本地分类。可用内存不足 3 GiB 时显示未启动。邮箱派生分类单独以 safeStorage 加密保存，Renderer 仅见遮盖账号、各类别数量与待核对计数。

初次保存或更改账号配置需要下次应用启动装配；重启后重新允许当前会话，再启动 Laya 并点击“开始批量分类”。这是当前固定工具注册入口的限制，界面会准确显示。界面和真实 QQ/Laya 尚待实际验收，不能据此声称已完成邮件批量处理。

## 启动装配

1. `createMailConfig({userData,safeStorage,onRevoke:()=>mailHost?.cancel()})`。`current()` 只在main使用，返回 `{user,authCode,revision}`。磁盘只保存safeStorage加密后的整个JSON，账号也不以明文存储；snapshot只含遮盖账号、configured/status/sessionAllowed/requiresRestart/headersOnly/reason。读取许可不持久化。
2. 有配置时，用 `createQQMailTriageHost({user,authCode,accountRef,storage,namespace,triage,labels,meetingLabels,isSessionAllowed:()=>mailConfig.isSessionAllowed(revision)})` 创建宿主。accountRef使用不含邮箱地址的固定宿主ID；storage和namespace遵循Inbox流水线单owner/单key原子持久要求。triage从可信本机Laya配置创建；缺配置时不传triage，snapshot明确unavailable，拒绝startBatch。初始化provider不连接邮箱。
3. 把 `mailHost.tools` 加到现有Runtime的tools中，仅含 `mail.inbox`。不要同时再注册product-tools-composition的mail；不提供CompetitionToolExport/云端catalog绑定。Runtime包需增加 `@personal-agent/mail` workspace依赖，由root维护package/lock。
4. Runtime创建后调用 `mailHost.bindApplication(application)`、`mailConfig.markBound(revision)`。若当前启动没有创建该host，保存配置后保留requiresRestart=true；不擅自重启应用。

## UI接线

`mountMailControls(root,invoke)` 提供 `render(snapshot)`、`showSettings(bool)`、`close()`。root main仅接受受信设置窗口来源：

- `mail.configure` → `await mailConfig.configure({user,authCode,readConsent:true})`。configure撤销旧会话，保存新加密配置；返回mask，不回传凭据。
- `mail.enable` → `mailConfig.enableSession({readConsent:true})`。仅本会话有效，重启必须重新允许。
- `mail.read` → `mailHost.startBatch({expiresAt})`。expiresAt来自可信当前用户会话的实际有效期；没有host、配置版本未装配或本机Laya未配置时明确拒绝。若status为classification_unavailable，调用 `retryClassification()` 后等下一次refresh，不重复创建读任务。
- `mail.disable` → `await mailConfig.revoke()`；onRevoke取消Runtime租约和本地分类，并调用QQ provider.dispose。

main合并snapshot时优先保留config的account/configured/sessionAllowed/requiresRestart，加上host的status/counts/headersOnly。不要向Renderer返回current()、原始task结果、邮件subject或Laya密钥。

## 批量与授权

Runtime新增 `startMailReadSession({accountRef,folder:'INBOX',expiresAt,limit?})`、`nextMailReadSession(sessionId)`、`stopMailReadSession(sessionId)`。这是固定inbox读取租约，无计时器，不改变system observation行为。用户一次允许后，每页自动创建独立host task、精确参数digest的一次性Policy grant和Evidence，无逐页弹窗。账号、folder、limit固定，next入口不能传游标；游标只取上一页confirmed结果。租约不持久化；generic tool.invoke同样检查活租约，重启残留grant不能重用。

复用main现有tick调用 `mailHost.refresh()`：未confirmed不分类；confirmed后进入本地流水线，完成分类才申请下一页。`hasMore=false`结束；分类失败停止推进，显式retry后恢复。新会话从首部读取，旧版本使用持久分类结果；历史页不倒退派生游标。

撤销会请求取消任务、撤销grant、abort分类并dispose已建立IMAP连接。当前QQ provider的connect中连接尚未赋到this.client，dispose不能同步证明握手已经停止；宿主此时保留stop_unconfirmed，丢弃所有迟到结果，执行退出后再次dispose并显示disabled。不得宣称收到取消就已停止所有网络I/O。

## 验证

Runtime构建通过；现有system observation四项回归通过；Inbox分类边界一项通过；邮件租约两项通过，覆盖自动两页/Policy/Evidence、到期与重启generic调用拒绝、撤销中止信号和删除grant。只使用Fake工具/合成数据。真实QQ、真实Laya、Electron设置渲染、OS safeStorage与大批量邮箱尚未验收；此文件不宣称发布完成。

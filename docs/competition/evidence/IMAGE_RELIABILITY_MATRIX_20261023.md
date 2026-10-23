# 镜像问题清单逐项核验（2026-10-23）

Profile：`huawei_ict_agentarts`。附件是待验证线索，不能把用户现场描述、源码事实、模拟测试和真实云验收混为一项。`confirmed`表示本轮确认，`fixed`表示已修且实际回归通过，`existing`表示已有行为或明确产品边界，`blocked`表示缺少必要环境/账号。下表固定绑定已检查源码`c276adf38de15e8c84c1941fd5defd68cb2a3b03`，后续Desktop文案增量不冒称已包含在此检查中。

| 附件项 | 当前结论 | 证据与验证边界 |
| --- | --- | --- |
| 1 写工具错误原因 | fixed，pin完整check及真实Chromium通过 | `9c3aae64`等保留stage/cause/HTTP状态/可验证schema约束，写操作仍RESULT_UNKNOWN，禁止因显示具体原因自动重试；不透传任意异常文本。 |
| 2 application deadline | existing，pin完整check通过 | 原实现已有watchdog；`acfd8969`证据核对，没有新增重复机制。不能由仅两处setTimeout全文计数推断不存在deadline。 |
| 3 calendar.create 幂等 | existing，未确认附件所述源码缺陷 | 既有固定UID、If-None-Match及412后完整readback；worker130项127通过/3live跳过。无UID同内容的新任务允许合法两条；按标题/时间去重会吞掉合法操作，是需求新增。本轮真实日历账号blocked。 |
| 4 工具目录描述 | fixed，pin完整check通过 | `65023f27`；参数说明有界，实际MAX工具64/24KiB预算不变，超预算仅去说明。不证明现场模型误判唯一根因或真实模型一定使用该工具。 |
| 5 mail.review 100%失败 | existing作者后续修复，独立真实重验blocked | #503@06a0848f作者后续真实3/3复核与新信通知证据已反驳“当前100%失败”；failed/unknown重启不重发已有源码/测试。未合且不在本轮修改范围，无本轮AA/邮箱凭据，不能冒称本轮闭环。 |
| 6 WSS心跳 | existing，pin完整check及真实ARM容器协议通过 | 服务端已有15秒ping，客户端ws默认自动pong；真实ARM服务观察到ready及ping并以1000关闭。不加重复机制，不由静默时长推断平台断线原因。 |
| 7 请求级超时 | existing，pin完整check通过 | 既有请求deadline与任务deadline机制；不新增第二套期限。 |
| 8 重启后邮件卡片 | fixed，pin完整check通过 | `561dc42d`/`7abf2877`；历史持久cache→重建host→UI消费的受控验证中provider/mint均0；owner10回归及Chromium1280/390渲染0pageerror。缓存不恢复读取许可；无公开更新时间则不虚构时间；真实邮箱本轮blocked。 |
| 9 变化判定刷屏 | existing作者后续修复，本轮范围排除 | #503按confirmed page聚合、legacy coalesce、独立会话/main隐藏任务及silent前置已有实现；每页聚合不等于整次同步一次，超窗Laya可多组。未合，不把作者有限真实证据当作组合已交付。 |
| 10 close code/reason | fixed，pin完整check通过 | `572f7db6`；code及固定reason分类经生产WS接收并投影，任意close reason不直接公开；HTTP状态/阶段/请求身份沿错误传递，不保存payload。 |
| 11 失败requestId保留 | existing，pin完整check通过 | 原32项identity历史已持久保留；worker通过生产WS1011/HTTP401/429失败终态实际读到ID。不新增cache，不保存payload，不把本地ID冒充平台ID。 |
| 12 失败诊断落盘 | fixed，pin完整check及真实Chromium通过 | 安全原因沿既有Runtime持久事件与任务失败记录消费至桌面，不另建日志事实源、不落盘原异常敏感文本。 |
| 13 天气配置 | existing，范围排除 | #509独立PR未合，本轮不改；未进行其UI验收。 |
| 14 生成代码/创建文件 | confirmed为行为指导缺口，源码提示已补，真实模型blocked | `65023f27`明确落盘必须真实工具/读回；不把代码文本当文件成功。 |

## 错误全链与能力自知

错误全链源码`9c3aae64`/`572f7db6`及后续精确兼容/异常投影修复经pin完整组合检查通过：底层错误→ToolGateway保留安全原因与未知结果→Runtime持久失败→客户端/桌面具体展示；13公开协议码、鉴权、输入、超时、限流、外部失败、取消、结果不确定保持可区分。已确认的输入约束可显示keyword/白名单field，未知异常只显示可确定分类，不能推测根因或泄露路径/邮件/凭据。不能以合成Chromium消费测试替代完整Electron/真实账号验收。

能力自知提示`65023f27`：`available`、`registered`、`unavailable`分别表达当前就绪、已注册、未确认可用；`checked_on_invocation`不是授权。宿主接线`acfd8969`及typed goal/诊断失败保护增量经pin组合检查通过；owner受控夹具合法once调用1次、未grant调用0、hidden不泄露、预算收缩保留原任务。无配置证据时不得猜“模型不能/没有权限”，不证明真实模型一定遵守提示。

PR #485原文及历史变更对照见 [提示词证据](PROMPT_CATALOG_REPAIR_20261023.md)：本轮未改boundary/FAST风格尾段/CONTINUATION原声明；不把基线前已有授权调整回滚，不将当前全文冒称原附件逐字一致。

## 镜像与运行事实

[既有ARM64镜像证据](ARM64_REGISTRY_AUDIT_20261023.md)及[原日志hash](ARM64_REGISTRY_AUDIT_20261023.logs.json)绑定本轮实际结果。GHCR全部14标签中最新为0cbb3f1d，已正常pull并用户态QEMU运行ARM64服务，健康/鉴权/非法请求协议检查通过。较新SWR Release镜像查询401，不能声称已取得最新SWR镜像。直接ARM64执行实际exec-format失败；QEMU验证不是原生ARM硬件验证。

真实AA模型、平台原生评测、真实邮箱/设备验收均blocked；占位endpoint协议检查未调用模型。原ARM64 Dockerfile构建与只读补丁运行的不同结果见下文。

## 组合检查记录

本树 `.cache/toolchain/` 使用官方Node24.15.0-linux-x64（归档SHA256 `472655581fb851559730c48763e0c9d3bc25975c59d518003fc0849d3e4ba0f6`，与官方SHASUMS256一致），npm11.12.1，独立`npm ci --ignore-scripts --no-audit --no-fund`成功。

第一次组合 `d0f328a1` 的完整检查因独立复核发现RATE_LIMITED/REVISION_CONFLICT固定词表缺口，经主控要求安全中止，exit130，不算通过。后续 `5413eac3` 与 `1457c9c6`补全13枚举并保留read合法重试元数据；write仍unknown且不可自动重试。

冻结源码 `85431361bc40033635a4632e79cf8974e0c81e48` 的原`npm run check`于2026-10-23T14:25:16Z至14:34:16Z真实执行，exit1。显式启用`PA_ERROR_DISPLAY_UI_TEST=1`及`/usr/bin/chromium`，没有放宽原命令或跳过失败。日志位于`.cache/final-validation/85431361/`。

| 阶段/workspace | 实际结果 |
| --- | --- |
| architecture / contract fixtures / generated / 全量build / typecheck | 已通过 |
| agents | 33项，32通过/1失败；invalid arguments proposal repair的精确producer消息消费回归 |
| Desktop | 1815项，1783通过/7失败/25跳过；授权Todo、历史取回、目录预算/Goal投影消费路径 |
| Runtime | 1147项，1130通过/10失败/7跳过；计数含父子测试，涉及目录/续接/子代理历史与上下文消费 |
| 其余workspace | 无失败；详细逐workspace计数见本地check-summary.json |
| 新错误全链Chromium测试 | 真实执行并通过1433ms，非skip；Gateway→SQLite unknown→生产workspace UI，截图已保存 |
| 根integration阶段 | 因前序失败，原`&&`未执行 |
| ARM补丁构建与服务 | 依主控要求待上述真实失败修复后执行，未用旧版本冒充通过 |

该失败已交回对应owner修复，不能归为环境原因或仅修改断言。所有失败原栈保留，后续最终结果另记，不覆盖此轮。

后续生产修复：`f6191ec3`让模型提案修复仅接受精确安全schema producer格式，不把任意INVALID_ARGUMENT/工具侧失败作为可重试提案；`87925a02`仅对已选择conversation environment context的调用装配能力自知，保留其他原typed goal/JSON格式及预算。真实Desktop已选择该上下文的消费接线仍可达，不能为满足旧测试而整体关闭能力自知。当时组合`f2a163bb21dfa05ed51953ff49a36cf9f76bf653`进入精确pin完整检查，后续按下文中止，不据作者目标测试宣称整套通过。

后续检查中止记录：f2a在Desktop序列按主控要求exit130停止，独立复核发现启用上下文时诊断目录解析会抢原final guard/hold；`b4701109`将仅诊断解析纳入原try，失败返回read_failed，保留唯一原写与waiting_reconciliation。5b3f69c9检查在typecheck阶段因下一项独立复现而exit130停止：恶意throw对象getter/Proxy可令新增错误转换逃逸并泄露内容、丢失写结果unknown。`a2b40a1f`修Gateway/Desktop安全投影，`c90f2357`修WSS typed投影；互审及最终组合检查通过，固定fallback不泄露、write仍unknown，read合法重试元数据保留。不能把兜底分类文案说成未知异常原文可公开。上述中止均非通过，未执行ARM构建。

“最新”边界补充：当前仓库另有2026-10-22控制台读回 `arm64-v5-d92a17a4-r3`→SWR `workflow-v5-d92a17a4`，以及历史 `workflow-v5-4aa8f93f`发布回执；它们不能被10-16 Release V3代替。当前实查GHCR `workflow-v5-d92a17a4`为not found，SWR对应tag鉴权401。GHCR最新可验证且成功拉取的0cbb、更新SWR指针与本轮尚未取得的私有制品分别记录，不能声称已取得全局最新镜像。

当前授权GitHub API已完整读取47个Actions artifacts及7个Release的全部assets：最新ARM64 Actions归档仍为10-13的0cbb（artifact11786098304），Release只有V3 ZIP与旧GHCR tar，没有上述更新SWR精确镜像的现成归档。此阴性结论限本次仓库正常分发清单，不声称私有云制品不存在。

## 最终c276组合与ARM协议结果

原`npm run check`，工具链Node24.15.0/npm11.12.1，2026-10-23T14:50:08Z至14:59:24Z，**exit0**。显式UI flag及系统Chromium154.0.8037.57，未改原命令、未放宽测试。原结果与allowlist逐文件hash见[机器回执](IMAGE_RELIABILITY_VALIDATION_20261023.json)，所有中止/失败原日志hash同时保留。

| 检查 | 最终实际结果 |
| --- | --- |
| architecture / contract fixtures | 3/3、4/4通过 |
| generated、完整build、全部workspace typecheck | 通过 |
| 34个workspace的Node报告合计 | 5477项，5388通过、89跳过、0失败 |
| Desktop / Runtime | 1839项1814通过25跳过；1151项1144通过7跳过；均0失败 |
| 根integration | 57项，54通过、3跳过、0失败 |
| 新Gateway→SQLite→生产workspace UI | Chromium实际通过1530ms，非skip |

计数直接取这次Node报告；父子计数遵循Node，不把历史目标测试重复累计成独立验收，不将跳过项写成通过。模型/设备相关skip不证明其真实能力。

脱敏UI图片已实际查看，只有Synthetic任务与固定错误，无真实账号/路径/凭据：[c276检查时的错误全链截图](assets/image-reliability-20261023/error-pipeline-c276adf3.png)。它是c276展示快照，后续UI文案调整需自己的精确版本证据。

原仓库Dockerfile、原`image-context.mjs`生成128文件allowlist，`docker build --platform linux/arm64`于14:59:53Z至14:59:55Z **exit1**：`[5/7] RUN`执行`/bin/sh`时`exec format error`（guest exit255）。传入代理CA secret且未关闭TLS；失败发生在网络安装前。本机x86没有ARM binfmt，不能宣称原Dockerfile构建通过，也没有AMD替代或privileged注册emulator。

随后以原已拉取GHCR index `3e7e5c36…404b1`为base，显式用户态QEMU10.2.3，只读挂载c276 allowlist的`packages/dist`及Runtime `src`。旧base缺少新增`diff`，首次import的`ERR_MODULE_NOT_FOUND`原栈保留；随后严格按原image-context裁剪lock导出本树npmci生产依赖3927文件，只读挂载，无native二进制，不把其说成旧镜像自带依赖。首次占位proxy路径配置与缺WS session header被正确拒绝，原失败保留；按现有严格配置与协议补齐夹具后成功。

实际guest读回`arch:arm64`、Node`v24.15.0`、`PROMPT_VERSION:owned-1.10`；prompts.js、agentarts-websocket.js、main.mjs、server.mjs四文件SHA与c276上下文逐字匹配，机器回执绑定baseDigest/sourceSHA/文件hash。该结果证明修后挂载内容实际执行，不证明旧0cbb原镜像已含#485或新源码。

真实ARM进程启动`agentarts`/`local`后：`/ping`200、无鉴权`/bindings`401、合法本地测试Bearer目录200（11 bindings，unverified）、空JSON invocation400 INVALID_ARGUMENT；WS收到ready及服务端ping，客户端默认pong，1000正常关闭。模型调用为0；endpoint为`example.invalid/inference/v1`且仅占位测试token，没有model stub回答。测试容器仅127.0.0.1:18123，已停止删除，未动他人容器。

这是**既有ARM镜像+只读补丁与依赖的本机协议验证**，没有产生可发布新镜像、没有部署、没有ARM原生硬件/Windows/真实AA/邮箱/模型或平台评测成功声明。

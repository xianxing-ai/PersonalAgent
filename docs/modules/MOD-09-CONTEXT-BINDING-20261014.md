# MOD-09 / F27：版本化上下文、预算与删除覆盖

- 日期：2026-10-14
- 负责人：goo122；非作者评审待登记
- 状态：in_progress
- Profile：`huawei_ict_agentarts`
- 工作树：`.worktrees/goo122-versioned-context-20261014`
- 分支：`codex/goo122-versioned-context-20261014`
- 基线：#350 `a378c3df12b98990f8a10e02037f6c6eb3e6ae65`，父 PR 尚未合并
- 范围：PR #347 的 F27 第二工作包，复用 F04/F05 既有确认、版本及删除链路
- 方案：[ADR-0025](../adr/0025-competition-context-binding.md)

## 已实现

- `competition-context:v1` 保存编译输入的摘要和预算元数据，不保存新私人正文、来源路径、原消息 ID 或凭据。
- 后续发送和 SQLite 恢复校验同一上下文；来源/消息内容、私人绑定、配置及预算漂移拒绝继续使用。
- 原 16000 UTF-16 字符硬上限覆盖最终 JSON 包装和转义，不静默裁剪内容。
- 可信同步 goal tokenizer 端口支持计数加输出预留；计数/版本/预算在凭据读取后重验。未配置时明确 `unmeasured`。
- 历史任务变为 withheld 时拒绝旧上下文发送。新增内存记录在每次发送结束、close、原逐事实删除时释放；新检查点经现有父/子任务副本清理，无关任务不受影响。

## 验证记录

- 定向：`node --test apps/runtime/test/competition-context-binding.test.mjs apps/runtime/test/competition-conversation-context.test.mjs apps/desktop/test/private-memory-consumption.test.mjs apps/desktop/test/private-memory-erasure.test.mjs`：33/33，0 失败/跳过。
- 覆盖：最终包装与转义超限、token 边界/超限/非法/异步计数、凭据等待期间计数和配置漂移、SQLite 审批恢复版本一致或变化、历史 withheld、逐事实父/子任务清理、无关任务及重启保留。
- 新夹具首轮失败已修复：直接 TaskRuntime 提交补显式 conversationId，工具对象 Schema 补 properties；未修改生产协议/期限或放宽断言。原失败日志保留在忽略的 `.cache-context-tests*.log`。
- 本工作树 `npm ci`、根 build 已通过；`npm run check` 退出 0，37 个 Node 测试汇总块共 3081 测试：3050 通过、31 跳过、0 失败/取消；包括架构、契约夹具、生成类型、工作区类型检查/测试和根集成。使用项目已有 SDK8 与已构建的 WindowsJobProcessHost；未更改宿主生产超时。
- `git diff --check` 与新增文档相对链接检查通过。定向和完整日志分别为忽略的 `.cache-context-focused.log`、`.cache-context-check.log`。
- 用户授权 Git 交付后，当前工作树再次构建原生宿主并执行 `npm run dev`、`npm run demo:protocol`、`npm run demo:runtime`，均退出 0；三项演示使用既有合成路径，不当作新增上下文的真实云验收。完整 check 使用的原宿主与此构建来自相同未改动的源码。
- 原 Vault 未访问；数据均为独立合成夹具。真实云调用 0；合成 HTTP 仅注入 fetch，不访问网络。

## 未完成与交付边界

本增量不是完整 F27 或 MOD-09 done。Desktop 尚无已验证 tokenizer；当前 token 端口仅计编译 goal，完整云请求的工具目录/继续回执/额外提示计量、模型输出预留落实、历史选择与摘要副本仍需后续包。私人云消费验收继续暂缓，相关整篇 Wiki 备份仍保留并报告 pending。无 wire/迁移/依赖变化，接口继续 provisional。

用户已授权本包提交、普通推送并创建基于 #350 分支的独立 PR，交付以本页分支及 GitHub 记录追踪。非作者评审、远程门禁及主线集成待完成，依赖 #350 的当前状态以 GitHub 为准。

## PR #351 远程门禁修复记录

- 原 head `5f0aae79` 的 [PR Foundation](https://github.com/zemeng5208/PersonalAgent/actions/runs/38509143624) 失败：知识桥接的错误 key/pin 与过期/描述符替换两条 TLS 测试在 `ephemeralCertificate` 返回 `SOURCE_UNAVAILABLE`，耗时约 10.4/10.1 秒。底层错误被原实现屏蔽；接近 10 秒进程期限是排查线索，不作为已证明的根因。
- 本机原测试独立 6/6，原知识包标准并发探测 51 通过、1 跳过，未复现该失败。修复将知识包测试文件串行化，降低 Windows 证书进程与其他夹具的资源争用，并在测试入口加载限定字段的诊断器。生产桥接源码、10 秒证书期限、TLS pin、一次性 offer、取消与私密输出处理均未改变。
- 诊断器只输出进程耗时、spawn 耗时、timeout 和已知退出/取消类别；不输出命令、错误消息、stdout/stderr、PFX、私钥或配对秘密。新增两项测试验证字段保密与类别保留。诊断器不由产品入口加载。
- 当前知识专项 53 通过、1 跳过、0 失败，保持原宿主测试覆盖；最终完整 check 退出 0，37 个 Node 汇总块共 3083 项：3052 通过、31 跳过、0 失败。新 head 远程 Foundation 待读回，不能以本机通过宣称远程已修复。
- 本机验证环境还出现 unified exec 默认通道 setup refresh 失败、npm cmd 子进程找不到 node，以及短 PATH 缺少 PowerShell7 导致额外跳过。均使用正常权限通道、仅本次进程的短 PATH、现有 PowerShell7 与已构建宿主的实际路径恢复；没有修改系统配置。失败与修复日志在忽略的 `.cache-bridge-*`、`.cache-ci351-*` 中保留。PATH 8276 字符问题与 [Microsoft 的 cmd 8191 字符限制说明](https://learn.microsoft.com/en-us/troubleshoot/windows-client/shell-experience/command-line-string-limitation) 一致，与原 CI 证书失败分别记录。
- 首次完整回归还因短 PATH 遗漏已有 OpenSSL 导致自有镜像的 3 个合成 HTTPS 用例 `spawn openssl ENOENT`；补回 Git 附带的 OpenSSL 后专项 3/3，再独立完整回归通过。未修改相关断言或生产代码；失败日志 `.cache-ci351-check.log`、最终日志 `.cache-ci351-check-final.log` 均保留。

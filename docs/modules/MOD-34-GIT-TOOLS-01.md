# MOD-34 受控 Git 工具

<!-- current-design-20261009 -->
> 当前目标与协作规则（2026-10-09）：[完整设计](../design/resident-developer-agent-20261008/DESIGN.md) · [离线阅读/全部 SVG](../design/resident-developer-agent-20261008/index.html) · [两人确认与本机阅读门槛](../reviews/DESIGN_READING_GATE.md)。WSS 主通道、HTTPS 备用；Wiki 记忆由 goo122 接入。goo122 与 Potatos498 均确认后才可按授权合并，禁止强制合并/管理员绕过。设计不等于已实现；本文历史验收与作者记录保留，旧合并规则以当前门槛为准。

> 维护入口（2026-10-07）：项目主要负责人为 zemeng；当前分工以 [模块分工](../../docs/MODULE_ASSIGNMENTS.md) 为准，最新状态见 [ROADMAP](../../docs/ROADMAP.md)。历史日期、作者和验收结论按原记录保留。

当前负责人：Potatos498（2026-10-07 随 MOD-34 接续）；负责工具、对应失败/未知结果验证及必要宿主接线，历史作者和验收证据保留。

生产入口 `packages/coding-tools/src/dev-workflows/git-tools.ts` 提供 `createGitTools`、`registerGitTools`、`readGitWorkspaceFingerprint`。组合入口负责公开导出和注入可信 Runtime receipt 查询。

| 工具 | 输入 | 输出 | 授权 |
| --- | --- | --- | --- |
| workspace.git.head | repository | headSha, clean, workspaceClean, fingerprint | workspace:git:read |
| workspace.git.commit | repository, expectedHeadSha, paths, message, verificationRunId | headSha, parentSha, branch | workspace:git:commit + Presence |
| workspace.git.push | repository, expectedHeadSha | headSha, pushed | workspace:git:push + Presence |

`workspaceClean` 要求整个工作区和用户 index 干净，用于修复开始前检查；`clean` 允许 host allowlist 内未暂存修改，但禁止其他修改。两个字段不代表构建成功。

Host 固定 canonical root、repository、sourceBranch、remoteName、无凭据 HTTPS remote URL、路径 allowlist 与作者身份。模型无法传命令、shell、remote、branch、凭据或验证结果。进程使用 Node spawn 与固定 argv，限制输出和 deadline，清理 Git 环境注入变量，不返回 stderr。命令失败不声称写入未发生；取消、超时及输出溢出标记结果未知，必须外部核实后再决定操作。

注册时另捕获 canonical root 的 `bigint` device/inode 目录身份；Git 子进程启动与结算、
文件快照、可信 receipt/凭据等待结束及 index 操作前复核。路径缺失、同路径换成另一普通
目录或 symlink/junction 都拒绝，不能因为 HEAD、branch、remote 和文件字节恰好相同就
把旧许可或验证收据用于替换工作区。注册时合法的路径别名仍解析为同一 canonical root，
普通文件/目录编辑不因 root 时间戳变化而失效；更换工作区须由可信宿主重新注册。
该预检不是 OS 沙箱或不可替换目录句柄，检查后仍有跨进程路径竞态，不保证 Git 元数据
或所有文件与进程启动原子绑定。

stdout 先收集不超过 1 MiB 的字节，在进程正常退出后严格按完整 UTF-8 解码，保留 BOM 字符；管道分块不能破坏中文路径。非法编码明确失败，push/update-ref 的结果仍保守未知；不会猜测替换字符对应的文件路径。工作树 root 只去掉 Git 的一个 LF/CRLF 输出终止符，保留目录名中的合法空格。超限仍中断进程并返回 RESULT_UNKNOWN。

Commit 查询原 task/run 的 Runtime 已确认 `workspace.run_allowed_command` receipt，要求真实 exitCode=0、同 HEAD、全部 host allowlist 文件 SHA256 一致。Runtime 组合入口必须在验证命令执行前后读取相同快照，仅在两者一致且命令结果确认时记录 receipt。不能将模型 arguments 转成 receipt。快照 helper 只读，不签发授权。

Commit 用临时独立 index 从旧 HEAD 建树，精确验证字节经 hash-object stdin 写入 blob，不执行 clean filter、不暂存全仓。入口拒绝已有 staged 变动；按 `git rev-parse --git-path index` 取得实际 worktree index 路径，取得 exclusive index.lock 后核实原 index 字节 SHA256、HEAD 和文件快照，写入新 index，锁期间以 update-ref old SHA CAS 更新固定分支，再原子 rename 安装新 index。不覆盖并发 Git index 写入；ref 已尝试更新后异常使用 RESULT_UNKNOWN，需读回 HEAD/index 核实。仅支持 bounded canonical 普通文件；不支持删除、symlink、submodule。只读 Git 子进程中断也保守返回 RESULT_UNKNOWN。

若 `update-ref` 已尝试后 root 身份改变，仍保留 `RESULT_UNKNOWN`，不会向替换工作区
安装 index 或按旧 pathname 删除别人的 `index.lock`。原目录内本次已取得的锁可能保留；
可信宿主须定位原目录、核实原 HEAD/index 和该锁归属后显式恢复，不能直接重试提交或
删除当前同名路径。root 预检拒绝不证明之前已发生的本地 Git 写入已撤销。

Push 固定 SHA 到固定 remote 分支；读取远程 SHA 并确认其是新 HEAD 的祖先，再使用 expected-SHA lease 消除远程竞争，拒绝覆盖分叉历史。读到不可达远程对象时 fail closed，不做隐式 fetch。Push 独立外部写审批；无副作用盲目重试。

2026-10-06 root 身份增量登记 #212 `6017766414`，基线 main `e02865c`：真实临时 Git
repo 在注册后被同路径普通目录副本替换，原公开工具接受旧合成验证收据并在替换 repo
实际创建提交；原移走 repo HEAD 未变。原最小 probe 与八个新回归全部失败的日志保留。
修复后同 probe 返回 `SCOPE_DENIED`，两 repo 的 HEAD 均保持。Node24.15/npm11.12 的
coding-tools build/typecheck、完整模块测试 198通过/0失败/15平台跳过，Git 30/30、
架构门禁 3/3；新增覆盖三工具普通目录/链接替换零进程与零 host 调用、receipt/凭据等待
后替换零 Git 写命令、update-ref 后 unknown 和无关 lock 保留、缺失 root、正常编辑及
canonical 别名。receipt 和远程命令端口明确合成，本地 Git 进程实际执行；不接触真实账号。
初轮模块检查另有测试空目录清理 API 错误及未构建 policy/tool-gateway 依赖，原失败保留，
修正夹具并补齐必要构建后才取得以上通过结果。不重复整仓 check；新 head Windows CI、
非作者审核和真实账号/原设备验收另行记录，不能沿用旧 head 的 Foundation 结果。
发布前查重发现同分支 MOD18 已交 #295/e8e3e30，正常 fast-forward 消费其四文件且不改写。
该组合再次 coding-tools build/typecheck、完整模块 204通过/0失败/15平台跳过、架构3/3，
原最小 probe 仍拒绝；只沿同一 #295 追加本登记三文件，不重复建 PR。

最新受检源码be49b30及源码相同的docs90f02d0已完成准确90f02d0双Windows Foundation：
各31workspace2035通过/0失败/16跳过，其中coding198/0/4，下面历史四个新增Git夹具失败
均已修正并通过。PR首轮无runner/steps取消仍保留，仅一次基础设施重试成功；Linux实际
TMPDIR别名探针旧夹具0/3、新3/3，本身不替代Windows日志。真实账号push、原任务未知
恢复及真人UIA仍未计通过；详见统一续接清单的最终受检源码与非作者交接。

Push 在 context 授权检查后调用 host `getCredentials(context)`，接收 `{token}`。host 可与 GitHub 工具复用同一个可信 secret adapter；不读取 ambient token，不调用全局 credential helper。缺凭据明确 UNAUTHORIZED。仅为固定 HTTPS URL 的 Git 子进程设置 http extraheader 环境配置；token 不进入 argv、模型参数、返回值或日志，并禁止 HTTP redirect。注册任一工具失败时回滚已取得的注册。

初稿交付时遵照当时限制，未执行 build、测试、安装或真实服务；这是历史记录。后续沿原 PR #290 持续验证，最新路径修复登记 #212 `6002024053` / `6002153136`：固定 Node24.15/npm11.12 的 coding-tools build/typecheck 和完整模块测试已通过，187通过、0失败、15平台门控跳过，其中 Git19/19。回归先复现旧实现跨块中文损坏、非法 UTF-8 被接受及真实临时 Git 仓库末尾空格丢失，再验证修复；合成 stdout 覆盖逐字节分块、非法编码、1 MiB 超限，实际子进程的合成 Git 输出另覆盖中文跨块。真实临时本地 Git 仓库也覆盖现有可信合成 receipt 的正常本地提交；不把这些计作真实账号 push、Windows 原任务恢复或竞争场景全面验收。`d3426af` 的 Windows PR Foundation 首轮因新增夹具失败4项：临时根8.3别名与生产canonical根比较不一致，以及Windows不支持末尾空格目录cwd。#212 `6002331612` 保留原失败并规范化夹具根，Windows使用合法中文内部空格目录，Linux仍覆盖真实末尾空格；原UTF-8/超限和严格cwd断言保留，修正后的完整coding-tools本机仍187/0/15，新head Windows另验。完整验收与限制续接见 [当前清单](DEV-WORKFLOWS-CONTINUATION-20261005.md)。index/HEAD CAS 并发、真实远程 lease 与写结果未知恢复仍需对应可信环境读回；模块维持 provisional。

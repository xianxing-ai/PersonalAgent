# 普通对话待核实：只读脱敏采集

工具不会自动寻找个人数据库。由该电脑的使用者明确选择原 Runtime SQLite、一个原 taskId，以及可选的原 `desktop.log`；不需要提供凭据或对话正文。应使用项目约束的 Node 24.15。

```powershell
node scripts/diagnostics/reconciliation-readonly.mjs --database <本机明确选择的SQLite绝对路径> --task-id <原taskId> --source-root <本次检查的仓库绝对路径> --desktop-log <可选的原desktop.log绝对路径>
```

不需要日志时省略整个 `--desktop-log` 参数。输出仅写 stdout，可由使用者自行保存；失败只输出固定错误标签。不要上传原数据库、WAL、日志、`.env` 或设置文件。

SQLite 以 `readOnly:true`、禁用 extension、query_only、受限只读事务打开，不调用 Runtime、不运行迁移、不修改任务、审批或 checkpoint，不重试或重发云端操作。缺文件、Schema 不兼容、锁或权限失败均保留失败，不创建数据库、不清库、不忽略 WAL。对运行中的库遵循 SQLite 读锁；不会自动备份或关闭应用。首次使用应先由库所有者确认明确的路径；本次开发只使用自建数据库测试。

采集只读取单任务 state/typed error code，以及固定 checkpoint 的存在布尔值、三个原云回执的布尔 accepted；不读取 goal、result_summary、事件正文、工具结果或账号表。可选日志按原回执 requestId 在本机匹配，只导出原 adapter stage/code、resultUnknown 和已允许的 transportPhase。匹配 ID 不出现在输出；没有原日志时明确 `not_supplied`，绝不从任务状态猜测 receipt stage。读取日志限 512 KiB，不自动读取 `.previous`。

现在还会按原 `subtask-parent` 关系读回一层相关任务：至多一个 parent、32 个直接 child，超出时 `relatedTasks.childrenTruncated=true`，不递归读取孙任务或同会话其他历史。每个相关任务只投影相同白名单元数据，并分别匹配原日志中的安全 stage；父任务本身没有云回执不代表其 child 没有。关系是定位线索，不是执行或权限证明。新增目录/父子等待 checkpoint 也只返回存在布尔值，不返回其中的参数、模型、goal 或结果。

来源信息明确分开：`checkoutSha` 和源文件 hash 仅描述 `--source-root` 选定的磁盘；`resolvedModuleFiles` 通过该目录的 Desktop package 解析到磁盘上的 Runtime/coordination dist，并记录 hash。解析到树外时仅输出 `outside_selected_checkout_on_disk`，不暴露私人绝对路径。包版本是磁盘 package.json 声明；Node 版本属于采集器进程。全部都不证明已有 Desktop 进程当前加载的 build，`runningApplicationBuild` 始终为 `not_observed`。仓库同步、包版本相同和磁盘 dist 存在也不能证明正在运行的进程已更新。

`compiledRuntimeFiles` 补充实际解析入口旁的核心执行、协调循环和工具目录制品 hash，避免只比较未变化的 barrel 文件。源文件与制品 hash 不能直接相互比较为相等；该输出也不宣称它们由同一次构建生成。项目 `start:desktop` / Desktop `start` 只启动 Electron，不隐式构建 TypeScript workspace；仅同步 Git 无法证明磁盘或运行中的 dist 已更新。

Git 只读查询禁用 optional index locks/刷新写入和已配置的 fsmonitor；不执行 fetch、build、启动脚本或 Runtime 模块导入。

需要原安全 stage 时，可以在使用者下一次正常启动应用时设置 `PA_AGENTARTS_SAFE_DIAGNOSTICS=1`，随后只采集其明确选择的原日志。该开关只增加已有脱敏日志；不要为取证自动重放旧任务、切换 profile、关闭 guard 或发送真实模型请求。

初步判断：inflight/unknown 有值而没有可信 received/terminal，属于未知结果保护；export-withheld 通常表示已确认本地结果的继续出机被拦；runtime-interruption 表示原进程中断。它们是取证线索，不是根因证明。需要结合当前 taskId、typed error、原 stage，以及确切运行产物判断；不得把本机通过说成另一台电脑已修复。

原验证记录为 6/6、0 fail/skip：三项实际日志投影单元与三项自建 SQLite/日志采集测试。2026-10-22 的有界关系扩展另以 Node 24.15.0 验证当前五项采集测试全部通过，包含父子单层白名单、子任务原 stage、32 条截断、原文件字节不变、缺库不创建及畸形库安全失败。默认沙箱的 native realpath 限制会拒绝这些自建路径，随后同一命令在普通用户上下文通过；没有修改 canonical 规则，没有运行真实数据库、模型、服务或全仓构建。

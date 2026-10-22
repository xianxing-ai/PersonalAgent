# 原生设备隔离验收（2026-10-22）

目标为 Competition Profile 的原 Runtime/Policy/ToolGateway、真实 Windows Host 及本机聚合观察。
本轮基线 `ef3f4e71`，使用独立工作树和新建 SQLite/工作区；保留正式 Desktop 和已有文档。

## 隔离方案与兼容性

原 Host 固定读取当前用户 `PersonalAgent/windows-host/runs.jsonl`，无法诚实地将手动验收称为
独立 userData。按主控明确授权增加可信 `createWindowsHostBridgeTransport` 的可选
`journalDirectory`：只接受绝对本地驱动器目录，Bridge 使用 `ArgumentList` 转交 Host，
不使用 shell；相对路径、UNC/device/网络驱动器、ADS、控制字符或附加参数均拒绝。
新目录仅决定原 `runs.jsonl` 的位置；同一任务/run/参数摘要、持久 journal 与未知写保护不变。
未传此参数仍使用原位置，无迁移、不改正式 Main 默认路径、不读写正式 journal。

本次真实 runner 必须显式传自己新建的隔离目录，只新开空白 Notepad，输入公开随机文本；
观察阶段不读取正文，原 `expectedText:''` 写前硬校验及原生读回保持不变。
不得用 Fake、提前写入或伪造 F9 证明通过。

## 实际结果

- 原 Runtime/Policy/ToolGateway 的真实 `node:os` 聚合观察已执行一次：任务
  `9728c4cc-cc75-482a-80af-8379f22e52d6`，2026-10-22 08:24:39 UTC，
  采样窗口 256.17 ms，执行记录 confirmed、精确授权已消费。拒绝、取消、停止租约和
  重启后的旧租约均未触发新采样。Evidence verification 保留 `conditional`；
  这不是 Desktop、AgentArts 或所有设备通过的证明。
- Windows Host 真实 Notepad 验收尚未通过。隔离运行 `native-notepad-PgJFH6`
  完成 hello/bind 和打开一个新窗口，随后观察返回 UNAUTHORIZED：observe 7 次、
  observed 0 次、execute 0 次、verified 0 次，没有写入正文或保存文件。
  独立进程元数据表明官方 Notepad 包和窗口存在，但该窗口不是前台。
  前台变化是否由并行测试导致仍待独占 UI 复验，不能据此放松新目标和空白校验。
- Runtime adapter 定向测试 29/29、零跳过。此前 Host、Bridge 构建和原生 fixture
  已成功；新增固定枚举观察诊断仍需增量构建后复验，不将其记作真实通过。
- Hosted PSEC 的 7 项原生边界及 1 项授权链成功证据在
  [独立 Hosted 验收记录](PSEC_HOSTED_ARM64_PASS_20261022.md)，不由本机 Notepad 结果替代。

原始收据保留在本工作树忽略的 `.cache/mod17-runtime-fbv44P/receipt.json` 和
`.cache/native-notepad-PgJFH6/receipt.json`。正式用户的 Windows Host journal 未读取或修改。

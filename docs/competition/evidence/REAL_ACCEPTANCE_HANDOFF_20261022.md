# 既有成果交接保存（2026-10-22）

本地主控已收回 #495 与全功能验收。本分支只正常合并保存已有提交和本交接说明，未新增产品实现、产品测试、dispatch 或账号操作；root 是唯一发布者。没有修改 main 或 #495 分支。

| 材料 | 原精确提交 |
| --- | --- |
| #495 本地双 parent 集成 | `3ae3f6eb2e8fa90cbecd72acf9845f24ab325efc` |
| 连接器前置证据 | `7f98f3fda1dd80f62f960beb1d03573b8bd5a11f` |
| weather 有限真实查询 | `057df6d4c395c3f81fc291dacd456cb897ed01e8` |
| PSEC strict 入口 | `7e552b1982ded5783b4f2104e3bbdf423834476f` |
| Desktop 前置证据 | `eaa86ff4765be94ca6d3e48d0a7e18e7a79bc609` |
| 云端脱敏证据 | `122b403b5a04e061446dc35d5732c667fdc8324f` |
| 219 项静态验收矩阵 | `6411037a7d34948f83a8af5f40a68a2b0c001ed9` |

固定共同基线 `c15855f5ccceb76d6bf794203d9ebfbe9cb83cb3`。root 最新只读转交的远端 #495 仍 OPEN Draft，head `db8085aa373606dac1b8730d88e61c86727f0900`，未 merged。本分支不改写该来源；本地提交保存不代表远端已发布。

本分支从 `3ae3f6eb` 开始，依次正常 merge weather、PSEC、Desktop、cloud、matrix，均无冲突。`3ae3f6eb` 是双 parent merge，不能作为普通单父提交 cherry-pick；本地主控已有自己的正常融合时，只参考原逐冲突证据，不重做或覆盖其融合。其余材料可按需要独立选择并审查。

真实结果及缺口：

- weather 仅北京 forecast 经原 Runtime/批准与 SQLite 重开取得 conditional 有限查询结果。自然 weather watch、mail watch、持久 event、Laya、主对话通知及设备链未通过。继续关注 mail watch 旧 `sessionAllowed` 与三个 manual 入口统一 question 适配。
- PSEC 两项真实 Windows native positive 尚未执行；旧 controlledskip 不计通过。DLL/API 能力缺失明确 blocked，不能放宽生产 guard；严格入口要求普通 token、REQUIRED=1、两原场景、0 skip。
- Desktop/F15 鹈鹕六节点、真实 check/CAS、动画、语音、Laya 及自然事件设备链未验；Linux/pwsh ENOENT 前置记录不冒充设备验收。
- Cloud 仅无凭据 GET 404/401，不能证明部署、版本、API、Trace、工具闭环、平台评估或防回退。缺受信身份/WSS/SDK 配置；证据未保存响应正文、请求头、凭据或私有配置。
- 矩阵219项是静态覆盖目录：178 not_run、38 blocked、1 limited_pass_conditional、1 explicitly excluded、1 in_progress；完整产品 pass=0，不能称219项均已验。

详细证据沿各原提交及同目录文档查看。最终分支是否已推送以 root 的实际远端读回为准；本保存 worker 未 push、PR、dispatch 或发送外部消息。

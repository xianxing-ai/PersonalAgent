# Hosted ARM64 dotnet 只读预检超时（2026-10-22）

Profile：`huawei_ict_agentarts`。工作树 `.worktrees/pelican-real-completion`，
分支 `codex/pelican-real-completion`，实现基线 `ef3f4e71`。

## 新失败原始证据

通过 GitHub 连接器读取
[run 39746526547 / job 119716316100](https://github.com/xianxing-ai/PersonalAgent/actions/runs/39746526547/job/119716316100)
原始日志和步骤。实际 checkout 为 `ef3f4e7161f76ff6621dfc99e7b1c8adb601e9e9`，
image 为 `windows-11-vs2026-arm64` `20261013.183.4`，Node 为 pinned `24.15.0` ARM64。
prepare step 从 `08:17:17.238Z` 开始，在 `08:18:02.989Z` 输出：

```json
{"status":"failed","reason":"Native dotnet query failed","query":"--info","processError":"ETIMEDOUT","exitCode":null,"nodeArchitecture":"arm64","osMachine":"unknown"}
```

按原代码顺序，只有原生 API 回执已经严格校验后才会进入 `dotnet --info`。
因此上次 60 秒原生探针期限使本次进入下一阶段；本次失败是原 10 秒 dotnet 进程期限。
prepare 全部约 45.75 秒，但原日志没有各查询耗时，不能据此把约 35 秒直接写作原生 API
的精确测量值。SDK/PE/helper/token 检查及两项 REQUIRED 正例仍未完成；真实执行步骤为
skipped，上传步骤报告没有正例产物。此 run 不是验收通过。

## 最小修复

只把 `--info`、`--list-sdks`、`--list-runtimes` 三个只读 dotnet 进程查询期限各从
10 秒增加为固定 120 秒，给新 Hosted image 上已安装 SDK 的冷初始化留出时间。
每个仍只有一次调用、输出上限 64 KiB、`shell:false`、隐藏窗口；失败、超时、非零退出
或中断一律拒绝，即使 stdout 已有看似有效内容也不能放行。不下载/安装 SDK、不重试，
不接受环境架构声明或仿真。原 API 查询仍为固定 60 秒，所有 Node/.NET8/架构/PE/token/
PSEC 和两正例门禁原样保留。

CLI 现在输出固定原生架构和 dotnet 查询 started/passed 阶段；成功阶段只含固定枚举、
受校验架构和单调时钟耗时。query 失败只新增固定期限 `queryTimeoutMs` 和本机耗时
`queryElapsedMs`，不输出原异常文本、stdout/stderr、SDK 路径或环境变量。
阶段信息不代替最后的完整校验或 PSEC 正例。

## 定向验证

使用 pinned Node `24.15.0`：

```text
node --test packages/coding-tools/test/host-architecture.test.mjs scripts/ci/runner-probe.test.mjs
14 passed / 0 failed / 0 skipped / 0 cancelled / 0 todo
node --check packages/coding-tools/native/host-architecture.mjs
passed
git diff --check
passed
```

新增用例逐个使三项查询 timeout，确认各只有一次调用、部分输出不放行、阶段定位到原查询，
诊断不含私人占位内容。原 API 回执、SDK8缺失、dotnet 架构不符、PE及降权运行时负例保留。
这些是离线合成输入，尚不证明 Hosted 正例成功。未进行本机重型构建或启动模型/服务。
后续只推本工作分支并新派发严格 ARM64 probe，记录实际 source SHA、runner、阶段和两正例
结果；skip 或未执行不计通过，遇新失败按新证据处理。

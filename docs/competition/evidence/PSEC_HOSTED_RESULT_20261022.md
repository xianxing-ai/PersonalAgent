# Hosted PSEC 严格执行结果：失败，零跳过

本次真实 GitHub Actions [run 39725054857 / attempt 1](https://github.com/xianxing-ai/PersonalAgent/actions/runs/39725054857)，精确源码 `10cc9bbec289866642cb683b1e038e71fa78de44`，job `119646979653`。实际 `runner_name=GitHub Actions 1000000687`、runner group `GitHub Actions`、labels `windows-2025`。这是 `workflow_dispatch target=psec-strict` 的实际选择结果。

2026-10-22 04:58:03–04:58:09 UTC，两项正例均强制 `PA_TEST_NATIVE_SANDBOX_REQUIRED=1` 并实际执行，分别 fail 1、skip 0，严格入口退出 1；没有改为跳过或计为通过。依赖/构建和普通 token launcher 准备已成功，测试步骤失败。

原脱敏 [loader 诊断](psec-hosted-20261022/native-diagnostics.json) 证明：Windows Server 2025 Datacenter，kernel `26100.33296`，GitHub image `20261007.264.1`；普通 token（非 elevated/admin/AppContainer）。System32 `processmodel.dll` 的 `exists=false`、`stage=dll-missing`、Win32 `126`，四个 PSEC exports 均不可用。合约探针返回 `DllNotFoundException / -2146233052`。该环境未到原生策略执行阶段，不能通过放宽断言、复制外来 DLL 或换成普通 spawn 解决。

[原 receipt](psec-hosted-20261022/receipt.json)、[OS 正例 TAP](psec-hosted-20261022/os-boundary.log)、[授权整链 TAP](psec-hosted-20261022/authorization-chain.log) 和 [不可用业务回执](psec-hosted-20261022/authorization-0-unavailable-receipt.json) 保留原字节；GitHub artifact `12402772643`，下载 ZIP SHA256 `72698c77076559aeac705f5b6eddab2a796766e1da29d99dbad8b67079a350d3`。

本机 Windows 11 的 7/7 + 1/1 真实通过与此 Hosted 失败分别记账。后续需从官方支持矩阵确定具备 PSEC 的 Hosted OS/架构，实际重新执行两项正例；目前 Hosted 门禁仍未满足。

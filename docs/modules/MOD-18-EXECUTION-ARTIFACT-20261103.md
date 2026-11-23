# MOD-18 本地执行摘要与只读范围核对（2026-11-03）

Profile：`huawei_ict_agentarts`。负责人：zemeng5208。本文只记录本次代码与本机夹具，不把夹具写成真实用户工作区、Windows 独占补丁或 AgentArts 验收。

## 已实现

- `CodingRepairVerificationReceipt` 增加可选 `artifactDigest`。旧回执没有该字段时仍可解析。摘要覆盖会话、run、recipe、退出码、输入快照和文件路径/SHA，不覆盖验证状态词、诊断正文或文件内容。派生 STALE 不改写已保存摘要。
- 隔离修复 `verify` 在命令停止后写入该摘要。这不是公共 Artifact 服务，也不是 Runtime Evidence。
- 新增只读工具 `workspace.patch_scope_check@1.0.0`。宿主提供工作区根和授权相对路径。预期 SHA 不一致时返回 `conflict`，不写文件。匹配时 `scopeReady=true`，`behaviorReviewed` 固定为 false。默认 `register()` 不注册它。隔离修复预览已有文件时先调用它，冲突仍是 `REVISION_CONFLICT`。

## 未实现 / 未验收

- 公共 Artifact 创建、读取、过期和释放仍归 MOD-01/02/05，本次未实现。
- `workspace.apply_text_patch` 与锁定创建仍只在 Windows + 受信 PowerShell helper 上执行。本环境是 Linux，相关用例按原条件跳过。
- 没有真实用户工作区、物理设备、真实 GitHub 或华为 AgentArts 验收。
- `behaviorReviewed: false` 表示没有做 API 破坏或无关格式审查。不能把 `scopeReady` 当成红线批准。

## 本机验证

Node `v24.15.0`，npm `11.12.1`。

- `npm run typecheck --workspace=@personal-agent/contracts`：退出码 0。
- `npm run typecheck --workspace=@personal-agent/coding-tools`：退出码 0。
- `npm run check:generated --workspace=@personal-agent/contracts`：退出码 0。
- `npm run check:architecture`：3 通过，0 失败。
- `npm test --workspace=@personal-agent/coding-tools`：345 项，314 通过，0 失败，31 跳过。跳过项是既有 Windows helper / Job Object / 原生沙箱条件，不是本次改成跳过。
- `node --test apps/desktop/test/coding-repair-result-export.test.mjs`：3 通过，0 失败。
- `git diff --check`：通过。

未运行根 `npm run check`，也未运行完整 integration。上述结果不代替 #531 head 上已经成功的 Windows CI / Linux image CI。

## #531 head 检查（只读，未改 CI）

核对提交 `d108cfec7d93eabe558def08cf12ff9efca574ec`，Foundation run `41460272146`：

| 检查 | 结果 | 依据 |
| --- | --- | --- |
| ecs-linux-check | success | job `125327216918` |
| Linux image CI | success | job `125327458867`，已执行契约/构建、镜像测试和 ARM64 构建 |
| Windows CI (GitHub) | success | job `125327458923`，已执行 “Run the complete original Windows check” |
| check | success | job `125355819383`。该 job 是路由与所选平台 job 的汇合门，不是第二次全量 `npm run check` |
| design-review-approval | failure | run `41460272303` job `125327217268`。输出 `passed:false, approved:[], blocked:[]`，等待一名合格非作者批准。本次不修改该门禁 |

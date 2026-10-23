# OpenCode 正式评审：待真实验收

目标是让 OpenCode 对真实 PR 提交 GitHub `APPROVED` 或 `CHANGES_REQUESTED`，不是把评论冒充批准。
前身 [#470](https://github.com/xianxing-ai/PersonalAgent/pull/470) 已关闭且未合并，只提供 CI 报错建议。
本包基于 main `ad1a045e1ec65f9ef280125d9df78b9cb63b4e51` 独立准备，不重新打开过时定位器，不覆盖其历史。

## 已准备的核心

`scripts/review/opencode-formal-review.mjs` 提供完整变更文件输入、严格模型结果解析、正式 review payload 与可注入的发布/读回核心。
只接收公开同仓 main PR，完整 before/after 文本上限 400 KB、40 文件；缺文件、二进制、重命名、超限明确拒绝，不截断后批准。
每个文件必须有实质审查理由；打回至少含一处精确源码行及后果。上下文不足不发批准或打回。
固定免费模型名单，不接受付费模型结果。模型判断不是可信权限来源，发布目标与 SHA 来自受信快照。
发布前多次核对 head/base，并从 GitHub 固定 SHA 重新收集完整源码验证 artifact；before 使用 compare 返回的 merge base，不能把目标分支新增代码误归为 PR 修改。使用 GitHub API 的 `commit_id`、`event`，随后读取 review ID、状态、身份、正文及链接。
写入结果未知时不重试；同一 bot/SHA/输入摘要的回执用于核实，已撤销评审不重建。

`scripts/review/opencode-formal-runner.mjs` 已准备固定 SHA 的完整源码采集、隔离模型运行与限定 main workflow 的 API 适配器。
`identity` 是受信适配器契约，不是 GitHub 仓库 REST 端点；将由经批准 workflow 的显式 `github.token` 绑定临时 bot 身份，并在真实 review 读回验证。
官方 runner workflow 已加入本分支：PR 事件只运行无写权限的合成双向推理烟测；合入 main 后，pull_request_target / main workflow_dispatch 使用固定受信 main SHA，通过独立读/写 job 处理真实 PR。适配器的真实 token 身份绑定、实际 GitHub 发送/读回尚未验收。
重新获取源码只能认证源码，不能认证 `result.raw`、模型名称或尝试记录。部署必须只接收同一受信 workflow run、固定 review job 上传的 artifact；禁止手工上传、跨 run 下载或接受 PR 提供的结果文件。受信 job 必须固定检出 main 代码，显式绑定 `github.token`，分离只读模型 job 与写 review job。没有这些来源保证，伪造的 APPROVE 仍可能配上真实源码，不能启用发布器。
现有测试不是上线证据，不代表真实模型审查、GitHub 权限可用或已经合并。

## 不改变的门槛

不改 design-policy 的四位登记协作者，不伪装人类或作者身份，不替代已有非作者批准、技术 CI、保护与正常合并要求。
不创建 PAT、GitHub App、OAuth、密钥，不读取或转移用户秘密，不启用自托管 runner。
不执行 PR head、不运行 PR 中的安装脚本/AGENTS/插件，不在模型进程放 GitHub 写令牌。

## 部署前阻碍与最小授权

当前 main 没有 OpenCode workflow，不能推定已配置 review 身份或权限。
2026-10-23 通过现有 connector 读取 Actions workflow permissions 返回 endpoint 不支持，实际 Allow GitHub Actions to create and approve pull requests 状态未知；未修改设置。
Owner 已于 2026-10-23 明确批准仅本仓同仓 PR 的临时 bot review 写权限及必要的创建/批准 PR 开关，因此分支已接入隔离 workflow。没有新增凭据、没有修改人工评审名单/保护。
仓库开关实际状态仍未知，未声称已启用；若现有权限已满足仍需真实当前 SHA review 读回。开关不能由现有 connector 管理时须在仓库 Settings → Actions → General 中处理，不用 PAT 绕过。

离线验证：`node --test scripts/ci/opencode-formal-review.test.mjs`。

## 2026-10-23 当前验证

- 固定本机 CLI `opencode --version` 返回 `1.19.3`。全新空 HOME、无凭据的 `models opencode` 列表有 DeepSeek V4.1 Flash 与 GLM 5.3 Flash，不含原 MiniMax M3.1 Flash，故本次固定免费名单移除该过时候选；未加入其他模型或付费回退。
- 旧三候选对合成公开代码的实际推理均未返回有效结果。追加一次 DeepSeek 限时诊断 30 秒后 `ETIMEDOUT`/`SIGKILL`，stdout/stderr 均空。不能据此确定远端根因，也不能宣称任一真实推理通过。
- 核心与适配器定向回归均为离线夹具；覆盖双向判定、逐文件覆盖、源码证据、SHA 过期、作者身份契约、去重、未知写入不重试、token 隔离、禁止工具、不以换模型刷批准、伪造 artifact 拒绝、merge-base before 绑定与 workflow 隔离。实际非作者身份仍须真实 readback，夹具不是身份验收。
- 没有真实 GitHub review、没有改变保护或凭据、没有合并或发布完成声明。真实模型和正式 review 必须分别验收，不用 smoke 合成源码结果替代真实 PR 审查。

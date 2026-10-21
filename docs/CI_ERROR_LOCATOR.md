# 免费模型 CI 报错定位建议

此功能不是 PR 审查，不评分、批准、修改或合并代码，也不替代现有人工评审或技术 CI。它是开发工具，不进入产品运行时，不改变 Competition Profile 或公共协议。

所有输出均固定显示：

> 以下仅为报错定位建议，未经人工核实，不代表已确认根因；请结合日志和源码验证。

## 触发与结果

- 仅 Foundation（`.github/workflows/ci.yml`）完成且为 `failure` 或 `timed_out` 时触发。
- 普通 `pull_request`：失败 SHA 必须唯一关联当前公开仓库的一个 open/main PR；建议评论到该 PR。按 run ID、run attempt、head SHA 去重，发布前重查运行和 PR；过期结果不评论。
- `merge_group`：分析准确组合提交的日志与源码，仅写本次诊断工作流的 Job Summary。首版不猜组合提交对应哪些 PR，不向这些 PR 自动贴结果。
- push、手动普通 CI、取消及成功运行不处理。既有 `CI failure feedback` 通知独立保留，本功能有单独的评论标记。
- 建议列出疑似文件、函数、大概行号、错误证据、推断理由、置信度和缺失信息。报错发生位置不一定是根因。
- 缺少可安全提供的错误证据时不调用模型；免费模型不可用时明确标记，不把工作流完成当成定位成功。

## 输入与边界

只读取失败运行对应 attempt 的最多三个失败 job。每份日志最多 1 MB，提取最多 100 行错误及邻近上下文，单行最多 500 字符。不传完整日志或整份 PR diff。优先实际 failing-test、编译错误、异常记录，忽略成功测试名称中单独出现的 error/failed 字样。

日志过大、缺失或没有安全片段时，兜底读取该失败 job 对应 GitHub Actions check 的最多 30 条 failure annotations；再次验证 check 的 head SHA，并对每条完整消息作相同敏感过滤。仅有“Process completed with exit code 1”这类通用退出信息不送模型。Annotation 可能同样缺乏根因证据，不能保证任何失败都能定位。

过滤凭据关键词、已知 token 形式、长不透明字符串、URL、邮箱及控制序列；所选错误块、annotation 或源码块任何一行可疑，整块都省略，避免秘密标签与值跨行时遗漏。相互分离的错误窗口独立检查，一个敏感窗口不会直接清空其他安全窗口。规则不能证明任意自由文本绝无敏感数据，日志本身仍不得输出秘密。被截断/省略的证据可能导致无法定位，不能靠模型补全事实。

merge_group 最多从保留下来的栈轨迹中选三处 `apps/`、`packages/`、`scripts/`、`tests/` 下的 JS/TS 文件，在失败组合 head SHA 上只读抓取上下各六行，并再次过滤。路径穿越、未知位置或无法读取的源码不猜测，不执行下载文件。普通 PR 的 Foundation 可能运行 synthetic merge ref，run.head_sha 不能证明实际检出版本，因此首版普通 PR 只提供日志，不补取 PR head 源码冒充执行版本；输出明确披露此限制。

模型固定使用 OpenCode CLI `1.19.3` 官方 Linux baseline 包，禁用安装脚本。免费候选顺序固定为 MiniMax M3.1 Flash → DeepSeek V4.1 Flash → GLM 5.3 Flash；不使用 MiMo 或收费模型。每个最多一次 CLI 调用、80 秒，总计最多 240 秒，内部网络重试同样受期限限制。免费模型可能限流或下线。

模型从全新 HOME/XDG 和工作目录启动，所有工具权限拒绝；`--pure`、禁用插件/分享/自动更新/LSP 下载，固定标题并关闭自动压缩，主模型及 small_model 都绑定当前免费候选。日志和源码只是数据，不允许成为执行指令。模型环境不继承 GitHub、Actions、provider token 或代理配置。

`workflow_run` 只检出触发时默认分支的可信 SHA，不检出或执行失败 PR 代码，不安装 PR 依赖。读取和模型 job 无仓库写权限；独立发布 job 才能评论，不安装模型。模型输出以不能逃逸的代码块展示，无法控制目标、mentions、HTML 或审批动作。

不修改 required checks、审批策略或现有合并逻辑。GitHub Actions 仍受账户运行额度影响，“免费模型”不代表无限 runner 时间。未知结果的评论写入不自动重试。

## 验证

离线：`node --test scripts/ci/opencode-error-locator.test.mjs`。

固定 CLI 的版本及参数已本地验证；此前隔离环境中的合成请求遇到 API 连接失败，真实免费推理仍未验证。首次合并后应等待新的有效失败事件，检查诊断工作流摘要及 PR 评论。首版没有手动补跑历史失败的入口，不会把历史成功或 CI 绿当作本功能验收。

官方参考：https://opencode.ai/docs/cli/ 、https://opencode.ai/docs/config/ 、https://opencode.ai/v2/docs/console/models/ 。

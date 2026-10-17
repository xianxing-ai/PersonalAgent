# MOD-04A：完整官方模板离线验证入口

- Profile：huawei_ict_agentarts；负责人：goo122；状态：in_progress。
- 基线：#367 / 90f464c0；工作树：`.worktrees/goo122-template-probe-20261015`。
- 范围：测试脚本、独立 Linux CI 与文档；无生产代码、wire、迁移或 Node 依赖变化。

## 固定来源

- 官方 Python 包 [deepseek-recipe 0.1.1](https://pypi.org/project/deepseek-recipe/0.1.1/)，MIT，Linux x86_64 wheel SHA256 固定在 requirements-deepseek-template-linux.txt；约 11.4 MB，无源码构建或自动升级。
- tokenizer 固定来自 deepseek-ai/deepseek-recipe 的 8cadfede7063c896b944e7bae05daa3549ae97ea / static/tokenizers/v41/tokenizer.json；SHA256 为 81f64d1248a68ce3663e07ab3ee48b851e5df0e32d27cb98e4c9a268151e8d99。来源 revision 是词表来源，不冒称 wheel 的构建提交。
- 官方 [API 与流程](https://github.com/deepseek-ai/deepseek-recipe/blob/8cadfede7063c896b944e7bae05daa3549ae97ea/docs/tokenizer.md)：先转换请求，再渲染与编码 conversation，不能直接计量原始 JSON。

## 验证行为

固定七个公开合成请求：普通文本、Unicode/转义、工具目录及确认回执、续答、思考开/关、特殊 token 字面量。脚本无私人 prompt 或任意输入语料入口，不调用模型、工具或 from_pretrained。

检查词表摘要和包版本，确认内容标记不丢失、无图像来源、token ID 合法，官方 conversation 编码与同一 tokenizer 的 rendered prompt 编码一致。普通请求必须包含对话 framing；思考开关必须产生不同 prompt。输出仅计数与摘要，不输出完整 prompt/IDs。

网络只用于 CI 的独立资产获取步骤。实际编码通过 Linux 新网络命名空间执行，脚本要求只有 lo 接口；缺环境、hash/版本错误或任何不一致均失败，不用 Fake 计数替代。

## 执行与证据

Windows 本机 Docker 管道不可连接，且缺 Rust；官方 0.1.1 未发布 Windows wheel。本包先验证标准库 guard 测试及脚本/工作流结构。guard 使用的 Fake encoder 只验证拒绝路径，不构成官方模板通过。

Linux 实际编码由 `.github/workflows/deepseek-template.yml` 在交付后执行，回执为 deepseek-template-receipt。Linux 尚未执行前不得填写模板通过或具体 token 数。CI 失败保留原始日志，修复相应问题后重跑。

本机实际验证：

- Python 3.12.6 独立 venv；最终标准库 guard 测试 5/5，包含错误词表、错误包版本、网络环境、非法/不一致编码、内容丢失、图像拒绝及异常脱敏。编码器为明确 Fake，不能计为官方通过。
- 实际 CLI + 正确 SHA 的公开词表：退出码 1，明确 supported_linux_environment_required；实际 CLI + 错资产：退出码 1，明确 tokenizer_sha256_mismatch。均符合预期拒绝，没有编码执行。
- 工作流经现有 js-yaml 工具解析；只读 contents 权限、SHA 固定的三项 Action、Ubuntu 24.04/Python 3.12、七类固定请求与独立下载/无网络执行步骤已复核。
- 官方 PyPI 元数据已读回并核对 wheel 摘要；无必需 Python 依赖，pytest 仅 test extra，本包不安装该 extra。词表为此前已有公开固定资产，不下载模型权重。
- 差异与文档链接检查通过。日志留在忽略的 .cache-template-*.log。本包不改 Node/生产代码，未重复全仓 Node 回归；标准 Foundation 与新增 Linux job 在 Git 交付后独立执行。

远程模型请求、AgentArts 调用、原 Vault 访问为零。#367 当前 Foundation 已通过，仍待合资格非作者批准；不修改或合并该 PR。

Linux 手动复现采用同一 requirements、词表及以下编码命令（依赖已在独立 venv 中获取）：

```sh
sudo unshare --net -- env "LD_LIBRARY_PATH=${LD_LIBRARY_PATH:-}" \
  "$PWD/.cache/template-venv/bin/python" tests/manual/models/deepseek_template_probe.py \
  --tokenizer .cache/tokenizer-v41.json
```

依赖获取、guard 测试与回执上传的完整顺序以工作流为准。不要为通过检查删掉网络隔离、摘要校验或内容保留断言。

## 限制与后续

官方模板离线通过只证明固定版本与这七类合成请求；不证明 Huawei MaaS 的模板/特殊 token 行为相同，也不覆盖平台隐藏上下文。生产 meter 继续未注入，报告明确 productionMeterSuitable=false、maasTemplateMatch=unverified。

下一步在 Linux 读取真实编码回执，再考虑实际 Provider 生成请求的适配与窗口配置。MaaS 参数/usage 对比仍需恢复后的独立云授权。用户已授权本包提交、普通推送、创建基于 #367 的独立 PR 并由新增 Linux CI 验证；实际 Git 交付、当前检查与批准状态以 Git/GitHub 为准。

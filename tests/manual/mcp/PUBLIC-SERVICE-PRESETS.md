# Microsoft Learn 与 Hugging Face 只读查询

在 Competition 桌面管理后台打开「远程 MCP 管理」，从「公开只读服务」选择预设，点击「选择服务」和「保存」。公开查询可以留空令牌。首次添加后正常退出并重开应用，选中已保存的服务，点击「连接」。选择预设会填入一份公开参数示例。点击「提出申请」，在原任务的对话卡确认后，由 Runtime 保存结构化结果。

| 预设 | 工具 | 公开测试输入 | 2026-11-22 真实服务回执 |
| --- | --- | --- | --- |
| Microsoft Learn 文档搜索 | `microsoft_docs_search` | `{"query":"Windows per-monitor DPI"}` | 10 条结果，原任务 `a765de4a-82fa-415e-8dc8-a6ce19971301` |
| Microsoft Learn 代码示例 | `microsoft_code_sample_search` | `{"query":"Windows DPI","language":"csharp"}` | 10 条结果，原任务 `97e719a4-c1cb-4f4d-932c-0e70149f1f0b` |
| Hugging Face Hub 仓库查询 | `hf_fs` | `{"operations":[{"cmd":"stat","args":["hf://models/google-bert/bert-base-uncased/README.md"]}]}` | 文件存在，10,517 字节，原任务 `7e5f0a31-4ec0-4e78-8736-38f8745d2576` |

本批通过匿名 HTTPS、Desktop 远程 MCP 宿主、Competition Runtime 和隔离 SQLite 运行。三个任务均先进入等待审批，测试驱动提交一次批准，最终各有一条 confirmed 执行记录。测试使用模拟本机密文存储。此次验收覆盖第三方读取与原任务读回，AgentArts 的对话编排和结果出站需另行验收。

服务定义位于 `apps/desktop/electron/mcp-presets/`，绑定服务身份、版本、完整目录摘要、输入和输出格式。微软服务固定使用协议 2025-06-18，Hugging Face 使用默认的 2025-11-25。工具目录变化时重新获取并审核定义后再更新。上游入口见 [Microsoft Learn](https://learn.microsoft.com/en-us/training/support/mcp-developer-reference) 和 [Hugging Face Hub](https://huggingface.co/docs/hub/agents-mcp)。

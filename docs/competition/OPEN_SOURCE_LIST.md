# 开源组件清单（华为 ICT 大赛 AgentArts 赛道）

> 项目：衔星（Synstar），仓库 xianxing-ai/PersonalAgent。清单按 2026-11-26 的主线 `707ea6f6` 整理。
> 范围：列出各工作区及根目录直接声明的第三方 npm 依赖与 Node.js 运行时。版本取自锁文件，许可证栏依据对应软件包的元数据。来源、数据与模型的分发范围见[原创性核对稿](ORIGINALITY_STATEMENT.md)。

## 1. 运行时与构建工具链

| 组件 | 版本 | 许可证 | 用途 | 引入位置 |
| --- | --- | --- | --- | --- |
| Node.js | 24.15.x（engines 约定） | MIT 等混合 | 运行时 | 全仓 |
| typescript | 5.9.3 | Apache-2.0 | 类型检查/编译 | 根 devDependencies、packages/agentarts |
| electron | 44.2.0 | MIT | Windows 桌面宿主 | apps/desktop |
| electron-builder | 24.13.3 | MIT | 构建 Windows NSIS 安装包 | apps/desktop devDependencies |
| playwright | 1.63.0 | Apache-2.0 | 受控浏览器自动化（受限工作区） | apps/desktop |

## 2. 协议与校验

| 组件 | 版本 | 许可证 | 用途 | 引入位置 |
| --- | --- | --- | --- | --- |
| @modelcontextprotocol/sdk | 1.31.0 | MIT | MCP 客户端/服务端协议 | packages/mcp、packages/windows-client、apps/agentarts-runtime |
| @modelcontextprotocol/server-filesystem | 2026.8.31 | MIT（见包内 LICENSE） | 官方参考实现，固定版本受控 stdio 文件系统服务 | packages/mcp |
| ajv | 8.17.1 | MIT | JSON Schema 校验（契约层） | packages/contracts |
| ajv-formats | 3.0.1 | MIT | 为契约 Schema 提供标准格式校验 | packages/contracts |
| json-schema-to-typescript | 15.0.4 | MIT | 契约 Schema → TypeScript 类型生成（开发工具） | packages/contracts devDependencies |

## 3. 传输与模型接入

| 组件 | 版本 | 许可证 | 用途 | 引入位置 |
| --- | --- | --- | --- | --- |
| ws | 8.22.0 | MIT | WebSocket 传输 | packages/models、packages/coordination、apps/agentarts-runtime |
| @types/ws | 8.18.x | MIT | WebSocket 类型定义 | packages/models、packages/coordination |

## 4. 文档与内容解析（知识/订阅/邮件能力）

| 组件 | 版本 | 许可证 | 用途 | 引入位置 |
| --- | --- | --- | --- | --- |
| fast-xml-parser | 5.11.1 | MIT | RSS/Atom 订阅与 XML 解析 | packages/knowledge、packages/connectors |
| parse5 | 8.0.1 | MIT | HTML 解析（网页抓取只读观察） | packages/knowledge |
| pdfjs-dist | 6.4.299 | Apache-2.0 | PDF 文本提取（知识库导入） | packages/knowledge |
| @napi-rs/canvas | 1.0.13 | MIT | PDF 渲染画布（知识库导入） | packages/knowledge |
| fflate | 0.8.3 | MIT | 压缩/解压（知识库打包资源） | packages/knowledge |
| tesseract.js | 7.0.0 | Apache-2.0 | OCR（知识库图片文字） | packages/knowledge |
| @tesseract.js-data/eng | 1.0.0 | MIT | OCR 英文语言数据 | packages/knowledge |
| @tesseract.js-data/chi_sim | 1.0.0 | MIT | OCR 简体中文语言数据 | packages/knowledge |
| diff | 8.0.4 | BSD-3-Clause | 文本差异比对（知识受控写回预览） | packages/agentarts |
| js-yaml | 4.3.2 | MIT | SKILL.md frontmatter 解析 | packages/skills |

## 5. 业务连接器（邮件/开发流程）

| 组件 | 版本 | 许可证 | 用途 | 引入位置 |
| --- | --- | --- | --- | --- |
| nodemailer | 10.0.0 | MIT-0 | SMTP 发信（邮件连接器） | packages/connectors |
| @types/nodemailer | 8.0.1 | MIT | SMTP 类型定义 | packages/connectors |
| imapflow | 1.7.8 | MIT | IMAP 收信（邮件连接器） | packages/connectors |
| @jackwener/opencli | 1.8.6 | Apache-2.0 | OpenCLI 受控命令行执行桥 | apps/desktop |

## 6. 开发期类型与工具

| 组件 | 版本 | 许可证 | 用途 | 引入位置 |
| --- | --- | --- | --- | --- |
| @types/node | 24.10.1 | MIT | Node 类型定义 | 根 devDependencies |

## 7. 源码与传递依赖

- 子智能体编排实现及开发记录位于 `packages/crew`。源码来源与贡献归属由团队结合提交记录核对。
- 传递依赖及嵌套版本可在根目录的 `package-lock.json` 中按安装位置查询。

## 8. 维护方式

新增第三方直接依赖时，必须同时更新本清单并在 `tests/contracts/open-source-list.test.mjs` 的自动校验中通过：清单中每个 `名称@版本` 都必须能在 `package-lock.json` 找到，且工作区内所有第三方直接依赖都必须已登记。

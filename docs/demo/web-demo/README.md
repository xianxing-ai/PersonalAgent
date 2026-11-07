# 在线 Web Demo（决赛可视化页面 · zemeng 归属部分）

决赛要求在线可交互的 Web Demo 页面。本目录是**独立新目录**：不进 npm workspace（无 package.json）、零第三方依赖、不改任何既有文件（前端 UI 归 2511375597-lab，本目录只提供可独立部署的演示页与其数据后端）。

## 组成

| 文件 | 说明 |
| --- | --- |
| `build-demo-data.mjs` | 构建脚本：从仓库真实文件生成 `demo-data.json`（28 张工作流图/185 个设计节点、F01–F28 状态快照、git HEAD、输入文件 sha256）。不编造任何数据。 |
| `demo-server.mjs` | 零依赖 Node HTTP 服务器：服务 `public/` 静态页 + 只读 JSON 接口。数据未构建时接口返回 **503 unavailable**，绝不返回编造数据。 |
| `public/` | 静态页（index.html / app.js / style.css）：28 图浏览与筛选、逐节点证据要求、F01–F28 状态、在途 PR、可选的已部署 Runtime 只读探测。 |
| `capability-status.json` | F01–F28 状态快照（2026-11-05），逐条注明来源文档（OPEN_WORK / ROADMAP / 接口目录）。 |
| `demo-data.json` | 构建产物（本文件随构建生成，测试与部署均可用仓库内预生成版本）。 |

## 构建与运行

```bash
node docs/demo/web-demo/build-demo-data.mjs                # 生成 docs/demo/web-demo/demo-data.json
node docs/demo/web-demo/demo-server.mjs --port 8080        # http://127.0.0.1:8080
```

接口（全部只读 GET）：

- `GET /api/health` → `{ok, dataLoaded, profile}`
- `GET /api/demo-data` → 完整数据（未构建 → 503 `data_unavailable`）
- `GET /api/workflows` → 28 图摘要
- `GET /api/workflows/F01` … `F28` → 单图详情（含节点与证据要求）
- `GET /api/capabilities` → F01–F28 状态
- `GET /api/highlights` → 在途 PR 卡片

## 部署（决赛在线页面）

1. 在干净 checkout 执行 `node docs/demo/web-demo/build-demo-data.mjs`（数据随 checkout 的 HEAD 变化，保证可追溯）。
2. 默认仅监听本机 `127.0.0.1`；在线访问可经已授权的反向代理。容器映射等确需监听其他网卡时，可显式指定 `--host 0.0.0.0`；此操作可能对网络开放服务，须先获得授权并配置网络访问限制。也可将 `public/` + `demo-data.json` 交给静态托管和只读 API 代理。
3. 页面“运行时健康探测”区可输入已部署 AgentArts Runtime 地址做只读探测（GET /healthz）；未部署时显示 unavailable。此探测不执行任务。

## 边界与编号说明

- 本页展示的 F01–F28 编号以 `docs/competition/workflow-wiring.json`（28 图绑定）为准；历史协作文档中的 F 编号存在差异（如 OPEN_WORK 的“F20 worker 信任闭环”对应 ownedWorkflowWorker 信任链，不是本表 F20“API 文档与一致性检查”），已在 capability-status.json 对应条目加注。
- 状态快照 `2026-11-05`：`configured 0/28`、宿主守卫清单 `0/152`（依据 OPEN_WORK）。这些数字由 build 脚本透传，不由页面硬编码。
- 不包含：Desktop 前端 UI/组合接线（lab）、Runtime/Policy 生产口（goo122）、业务连接器真实账号口（Potatos498）。缺口在页面上按负责人如实标注。

## 已知不可测项

- 静态页的浏览器渲染效果由人工/CI 浏览器确认；仓库内测试只覆盖数据构建、服务器接口与内容断言。
- “运行时健康探测”依赖真实部署的 Runtime，本地无部署时按设计显示 unavailable；它不验证真实任务交互。

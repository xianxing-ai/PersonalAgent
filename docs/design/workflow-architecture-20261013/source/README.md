# 架构查看器可编辑源码

完整设计、离线打开和无需安装依赖的Node运行方式见[上一级README](../README.md)。

本目录只负责静态架构查看，不连接产品Runtime、账号、模型或麦克风。依赖版本沿用现有锁文件；npm配置使用项目级国内镜像。

## 开发与导出

在本目录执行（Node要求以当前Vite依赖为准）：

```powershell
npm ci
npm run dev
```

打开Vite打印的URL。生成可离线打开的HTML并检查：

```powershell
npm run export:offline
npm run check:architecture
npm run lint
```

发布副本：把dist/architecture.html复制到上一级index.html，然后重启上一级的Node查看服务。

修改28功能流程用src/data/architecture.json；机制与六板块用architectureRevisions.ts；共享关系/适配用overview.ts；界面用components/workflow/WorkflowOverview.tsx。所有字段是查看器的设计数据，不是新增公共wire契约。

AgentArts平台接入、已有代码/最小增量、多来源知识库与MCP/Skill在`src/data/agentartsIntegration.ts`。平台节点连入同一总图；Owner已确认本机Laya是本机运行方案并参与Competition产品路径，领域资格、节点接线和场景适用性仍待验证；AgentArts负责Competition Agent/Workflow构建、编排、评估与部署，本地Runtime经CloudAgentPort消费已部署工作流并负责授权工具执行和Evidence；外部比赛资格与真实平台端到端验收仍待验证。

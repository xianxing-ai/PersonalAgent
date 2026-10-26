# MOD-31/32 有界观测与离线评估核验

目标 profile：`huawei_ict_agentarts`；基线 `ad1a045e1ec65f9ef280125d9df78b9cb63b4e51`。
工作树 `.worktrees/agentarts31-32-20261025`，分支 `codex/agentarts31-32-20261025`，开始时 clean。
Linux x64；固定工具链 `/workspace/PersonalAgent/.cache/wiring-20261018/toolchain/node-v24.15.0-linux-x64/bin`（Node 24.15.0），本树独立 `npm ci --ignore-scripts`，dist 在本树从源码构建。没有调用云 API、部署、创建凭据或镜像。

## 已复现与最小修补

公开 `readAgentArtsTrace` 的 legacy summary 接受合成响应 `total:0`、`span_list` 实际一条，成功返回自相矛盾的观测计数。新增测试在原实现以 Missing expected rejection 失败。修补只在 `src/observability/reader.mjs` 增加 `total >= span_list.length` 校验，矛盾响应返回既有脱敏 `EXTERNAL_FAILURE`，保持单次 GET、不重试。

依据是既有 `src/observability/index.mjs` correlated projection 的相同下界，以及 [MOD-32](../../docs/modules/MOD-32-AGENTARTS-OBSERVABILITY.md) 的总数/已返回条数定义；既有合成官方结构夹具也明确 `total:5` 可以只返回一个 span。本次不是观察到真实平台已返回坏数据，而是验证不可信合成响应的准入。

新增回归拒绝 0/1、1/2（total/returned），逐次断言仅一个请求；允许完整 1/1、局部 5/1、空 0/0 与局部空页 5/0，原样保留两种计数。legacy `deploymentVersion/requestCorrelation` 保持 `not_checked`；correlated projection 保持 `deploymentVersion/cost:unavailable`，不把配置或 HTTP 200 当作部署版本/请求精确关联。无公共 DTO、依赖、迁移或权限变更。

## 本次诊断与可验边界

- 角色预算/路由只读盘点：`OwnedAgentOrchestrator` 构造器验证正整数预算，每次角色调用给 ModelGateway 同一 `maxOutputTokens`、原 deadline/signal；普通 fast 与修复 World/Plan/Review 的结果仍受原严格校验。预算为每角色输出预算，不宣称新增跨角色总预算。没有修改共享 index/prompts；路由/transport/server 专项由 MOD29/30 同批负责人负责，本包不重复代验。
- 实际执行的角色收据测试：同 requestId 并发 span 不混淆；成功/失败/取消/超时各保留结束回执；提前取消零调用；同步/异步观测 sink 失败不改变调用结果。completed 只表示模型输出解析为对象，不等于后续业务校验或工具完成。
- 镜像角色日志 writer：允许名单/脱敏字段，host 配置版本注明 `host_configuration`；缺版本 unknown，拒绝 Latest 等浮动标签。不是平台命中版本读回。
- 观测 Fake fetch：精确/缺失/冲突身份、部分页、指标未知、错误响应、凭据头准入、禁重定向、1 MiB、签名/fetch/body 的取消和超时、单请求无重试；dist-only 包布局使用本树 dist，源码未进入隔离 fixture。
- 离线评分全部使用合成摘要/文件：缺 trace、错误交接、失败、unknown、缺 baseline、配置/输入/工件不一致不能成为成功或有效对照。历史公开 Evidence 保持 unscored；固定评分结果为 unverified，不推断多 Agent 优势、费用或平台评测完成。
- trace replay 测试包含本机临时 HTTP 服务，只返回已有历史 data/Evidence；无模型/工具执行，写入只作为时间线观察。失败和 unknown 原样保留，不续期 deadline。该本机服务不是 Huawei 云 API。

## 命令、UTC 与日志

全部日志在忽略目录 `.cache/mod3132/`；完整命令与计时 JSONL 为 `checks.jsonl`。下列时间均为 2026-10-25 UTC，hash 为日志 SHA-256。

| 检查 | UTC 开始–结束 | wall秒 | exit | 结果 | SHA-256 |
| --- | --- | --- | --- | --- | --- |
| build | 06:30:09.729822–06:30:19.589174 | 9.859 | 0 | 本树 owned-agent 依赖及产物 | bcec43888fc28102adba795b97ee63c3eab15af1ad48ab79467f2030ffd85dfb |
| red | 06:30:32.484004–06:30:32.600862 | 0.117 | 1 | 新增回归原实现失败 | 918d4bcf69e4bac532af22d3a3d494db02541ce706b4d8485ccfc00c12c7a108 |
| build-observability | 06:30:44.914625–06:30:45.113457 | 0.199 | 0 | 修补 reader 复制到 dist | 7b68092bdbd41186a594a9a233e437d70bd862dd5222954c5292f6c29b87401c |
| green | 06:30:45.153711–06:30:45.266122 | 0.112 | 0 | 同一新增回归 1/1 | 64e26846875c850f36518aa0149c2b70c0ba64b71056e01d6a859dd3259bbe22 |
| evaluation | 06:30:45.674505–06:30:45.860439 | 0.186 | 0 | 30/30 | 495f0f484501f2a4992f9bbf28eb05433f4024f9ffb83e316a8768a8166d25ad |
| role-observation | 06:30:45.901805–06:30:46.846380 | 0.945 | 0 | 24/24 | 762c067d634bacfcb6efcdab2da7f221465baf1eb8126132326e56988687a4ef |
| typecheck | 06:30:52.620403–06:30:55.379254 | 2.759 | 0 | 通过 | aadb18867b10863908983658f7b640dab974384a29567aa5692f4b74ce3089a4 |
| reader-syntax | 06:30:55.416991–06:30:55.441486 | 0.024 | 0 | 通过 | e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855 |
| architecture | 06:30:55.476719–06:30:55.778834 | 0.302 | 0 | 3/3 | 5df0382351212fd0ff754a3817bac80db26d5829af5bbe0333d1aaac15be6eba |
| observation-final | 06:31:09.028308–06:31:09.331987 | 0.304 | 0 | 增补合法页边界后 38/38 | 2f568842a1d02f3eeca50f37efac3f66c7cb513630a6644bcaf061c13dc6af09 |

可复现命令（`node/npm` 使用上述固定 PATH）：

```sh
npm ci --ignore-scripts
npm run build:owned-agent
node --test --test-name-pattern='trace summary rejects a total' tests/manual/agentarts/support/read-platform-trace.test.mjs
npm run build:observability --workspace=@personal-agent/agentarts
node --test packages/agentarts/test/observability.test.mjs packages/agentarts/test/observability-package.test.mjs tests/manual/agentarts/support/read-platform-trace.test.mjs tests/manual/agentarts/support/read-platform-trace-observation.test.mjs tests/manual/agentarts/support/read-platform-trace-consumer.test.mjs tests/manual/agentarts/support/platform-trace-fixtures.test.mjs
node --test tests/manual/agentarts/evaluation/score-runs.test.mjs tests/manual/agentarts/evaluation/score-owned-workflows.test.mjs
node --test packages/agentarts/test/role-receipts.test.mjs apps/agentarts-runtime/test/role-receipts.test.mjs apps/agentarts-runtime/test/stage-timeline.test.mjs apps/agentarts-runtime/test/trace-replay.test.mjs
npm run typecheck --workspace=@personal-agent/agentarts
node --check packages/agentarts/src/observability/reader.mjs
npm run check:architecture
git diff --check
```

未验：Huawei 原生云 API/trace/角色交接、真实模型、固定部署命中版本、平台评测/usage/账单、发布回滚、Desktop 整链及比赛整图。没有探取环境凭据或创建云请求；不能凭这些离线通过把 MOD31/32 标为完成。提交由 root 统一发布，本包不 push/PR/Approve/merge。

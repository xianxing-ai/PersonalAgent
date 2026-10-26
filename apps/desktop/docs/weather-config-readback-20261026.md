# PR #509 天气配置读回竞态修复

目标 profile：`huawei_ict_agentarts`；原作者提交 `6853c87ce92da3ce3e46d92f4c74e32142972628`，修复提交 `d6765484c208dabf04198606e9894e86f53e9c25`。隔离工作树 `.worktrees/pr509-bootstrap-revision-20261026`；保留作者城市配置 UI 与其他修改，未改后端、公共协议或真实账号配置。

`weather.configure` 完成后发出的 `snapshot` 可能晚于订阅的新状态返回，原提交会把新状态覆盖。修复复用生产 `updateRevision`，在发出读请求前捕获 revision，仅在期间没有新 update 时消费结果。不改变初始化入口。

Node `24.15.0` / npm `11.12.1`，本树独立 `npm ci --ignore-scripts --no-audit --no-fund`（exit 0），没有借用其他树的依赖或 dist。

- 新增测试从生产源码提取实际城市提交 handler 与 update revision 增量，在 VM 中控制配置/读回 Promise 和订阅 update 顺序；这是合成 Renderer 状态验证，不是 Electron 调度或真实天气证据。
- 修复前：3 项中 1 fail、2 pass，确证旧读回覆盖新订阅。修复后：3/3 pass，覆盖旧读回应丢弃、读回先到仍正常更新、配置期间订阅后新读回仍接纳。
- `npm run typecheck --workspace=@personal-agent/desktop`：exit 0。仓库该脚本实际是 `node --check` 语法检查链，明确包含目标 `src/features/workspace/view.js`；不称为 TypeScript 语义验证。
- `node --test apps/desktop/test/workspace-weather-readback-order.test.mjs apps/desktop/test/workspace-refresh-order.test.mjs apps/desktop/test/weather-card-host.test.mjs apps/desktop/test/workspace-controls.test.mjs`：19/19 pass，exit 0。
- 首轮另外尝试 `workspace-config-host.test.mjs`，因尚未安装自身依赖，加载时报 `ERR_MODULE_NOT_FOUND: @personal-agent/contracts`，该轮 14 pass、1 fail。安装依赖后未构建其完整 Runtime 依赖闭包、未重跑该无关配置宿主套件；保留失败，不宣称其通过。
- `git diff --check`：通过。未执行全量 CI、真实 Electron、真实天气请求或账号验收；PR 合并与独立批准另行确认。

原始日志在当前树忽略目录 `.cache/pr509-bootstrap-revision-20261026/`，SHA256：

| 文件 | SHA256 |
| --- | --- |
| red.log | `d9713e9007d5a1f8f74db0fa5d0e1b12e188e02cda5f5cf279b87a33bdfb8572` |
| green.log | `308d25e128cb4204cc37c739312d2ea3323d9e821aa31db45bc4d8426d4d656c` |
| typecheck.log | `0c49c69a103a881cd534e0f8f077225fea536270601d3988c03d63d9ab9270ae` |
| npm-ci.log | `dec8fb58c3aab2b307ecbd465a840f10879c10995bd46c5a40a508734997f78d` |
| targeted.log（首次加载失败） | `45cf3d54a76133478301e2f1e673f2b18b049bb52d2146981f65913608c85ba4` |
| targeted-green.log | `311950cbaa3dd49f5a0f1931d8f0419ef10d1992eef79362c8ac72a6640e7eda` |

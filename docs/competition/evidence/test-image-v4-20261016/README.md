# V4 接线与真实公共案例证据（2026-10-16）

本轮目标 `huawei_ict_agentarts`。工作流在自有 ARM64 镜像，本机 Laya 使用 CPU/1 Torch 线程，原 Runtime、Policy、ToolGateway、SQLite Evidence 保留事实与授权来源。未定模型或架构最终方案，未训练权重，未恢复暂停的最小修复算法，未推送或部署新镜像。

## 源码与镜像

整仓检查针对 `058e0df7`，已普通合入 `main@c4909b0b`（含 #340/#330）。随后仅修改手工夹具与说明；`checks.json` 逐项核对 apps/packages/package.json/package-lock.json Git 对象一致。本地镜像构建源码为 `e38ef23d`，成功真实案例使用 `d83e6c4c` 的手工 runner；两者生产源一致，不倒填成一次同源码提交。

本机标签 `personal-agent:test-v4-workflow-wiring`，image ID `sha256:58c6fc1c8be1dbb14a0a2aae1140a1058d3a8126eb487d541145e8e956f9929d`，约 389.6 MB，`linux/arm64`。构建墙时 20.613s；Docker build 本身 9.084s。内容逐 SHA 与运行身份见 [local-image.json](local-image.json)、[image-context.json](image-context.json)。这不是 SWR/华为 Runtime 已发布证明。

## 实际验证

| 项目 | 结果 | 时间/边界 |
| --- | --- | --- |
| 根 `npm run check` | 37 组、3628 项：3608 通过、20 跳过、0 失败/取消 | 359.185s；生成类型、架构、类型、workspace 与 integration 门禁完整执行 |
| `PA_TEST_PYTHON` 指向现有 Python 后的手工 harness | 最终 68/68 通过、0 跳过 | 12.210s；含相同已验证产物去重，均不作真实账号证明 |
| 实际 Electron 原 Local 回归 | 7 次本地模型夹具请求、2 次取消，通过 | 设置窗口复用与可见性；没有真实云模型/麦克风 |
| 新容器无网络 smoke | 28 图/185 节点、6 控制动作、3 影子层级、历史回放及未知反事实 | 实际 ARM64/uid1000；模型判断为显式合成，外网调用 0，平台缺口明确 unavailable |
| 孙悟空真实案例 | 初稿生成→浏览器检查→暂停动画故障注入→主/影子分别修复→验证→单 CAS 写回 | flow 323.400s；含容器启动/收尾外层 331.371s |
| 鹈鹕真实案例 | 原动画故障→主/影子分别修复→验证→单 CAS 写回 | flow 192.498s；外层 200.484s |

两条成功案例的实际表面是**本机新镜像 Docker + 本机原 Runtime/Policy/工具/Laya + 远端 AgentArts 推理代理**。不是远端 Runtime 执行完整工具链，不是 28 条真实业务全部验收。两成功轮分别实际记录 24/22 个模型 HTTP200；独立只读 SQLite 核到 46 条原始工具记录，其中 45 confirmed、1 failed。失败为鹈鹕 `workspace.preview_text_patch/INVALID_ARGUMENT`，其后模型修正并通过；未删除或改成成功。分支父任务 succeeded，协调锚点 created 也保留，不冒称全部任务终态完成。

孙悟空初稿生成 73.094s，主分支 27.664s，影子 65.477s；鹈鹕主分支 79.210s、影子 47.498s。模型请求和工具子阶段已经包含在 flow 墙时中，不能再次相加。两个案例最终主/影子文件均逐字节相同，所以在读回当前验证 SHA 后由代码去重选一；仍重新检查当前用户基线、授权、CAS 和写后 SHA。不同产物仍走原候选比较，没有模糊修正候选、放宽 checker、增加预算或改变最小修复算法。

完整 UTC 起止、逐节点墙时、调用、失败、输入 token、队列/HTTP/前向、文件 SHA 与持久记录见 [汇总](full-workflow-results.json)、[checks.json](checks.json)、各 case 的 `report.json`、`stage-timeline.jsonl`、`sqlite-readback.json`、`container.jsonl` 和 `launcher-timings.json`。文本规范化本机路径前缀；公开日志还统一 LF、移除行尾空白和多余末尾空行。原始/公开日志 SHA 分别记录，不宣称投影前后字节相同。目录内 `.gitattributes` 禁止 Git 自动改写证据字节，便于跨系统核对文件 SHA。

## 性能未达标及未验证项

本轮本机 CPU 单线程下，孙悟空 Laya 的 6071/5961-token 输入纯前向为 **64.890s/61.626s**；队列仅 0.446ms/0.055ms。鹈鹕 2635/2557 tokens 的调用墙时约 **15.580s/14.743s**。这些完整输入结果不满足 150ms 目标，不能以历史 182–618ms 短样本替代，也不是旧版/新版同输入、同配额的加速比。基础权重仍未通过任务资格，实际选择升级教师。

本机没有额外 2核8G 限额，不能称云端算力实测；Torch 线程数不等于进程所有 OS 线程。launcher 的资源采样包含全部新出现 Python、没有 PPID 绑定，不能据此声称与 Codex 资源完全相同或把峰值精确归给某个模型。本轮未完成这种资源等价证明。

真实业务来源/账号、物理通知与语音、机会影子收益、远端完整闭环、平台原生知识/MCP/评估仍须负责人独立接入验收。新增主动 IPC 已注册并限制受信调用，产品 Renderer 触发入口尚待接入。截图只支持结构/可见内容核查，孙悟空角色相似度和美术质量不作自动通过项。

## 保留的失败

- 整仓首次 5 个退出测试失败：VM fixture 漏声明新增通知宿主。修 fixture 并补实际清理顺序断言，未改生产退出门槛。
- 旧 synthetic 导出器拒绝当前可选 `sha256`，使已确认读结果被 withheld；现严格接受公开契约原4字段或4+sha，存在 sha 时必须核实际 bytes/hash。旧 Fake 建议契约与 Windows Python JSON 编码也修正，未放宽原验证。
- `wukong-startup-invalid-assets/`：首次用了缺清单的原始模型缓存，0 次模型调用，未计成功。后来五文件 manifest/SHA 独立校验。
- `wukong-native-exit/`：启动期退出 `-1073740791`，无完整报告，原因 unknown。单独同模型/CPU1 启动随后成功约23.9s；不据退出码推定 OOM。现有 child 日志与终态诊断不足留作后续问题。
- `wukong-comparison-504/`：主/影子均 verified，但教师最后比较超时504，未交付。由逐字节相同产物去重减少无意义比较；首轮失败仍完整保留。
- `pelican-invalid-candidate/`：教师200响应含原候选外 ID，在工具执行前被严格拒绝；未做模糊匹配。独立第二轮通过，不据小样本推导可靠率。

## 复现与打开

使用仓库规定 Node/npm，根目录 `npm ci`、`npm run check`；手工回归设置本机 `PA_TEST_PYTHON` 后执行 `node --test --test-isolation=none tests/manual/agentarts/*.test.mjs`。本机镜像构建使用原 `scripts/agentarts/release-owned-image.ps1 -Build -Image personal-agent:test-v4-workflow-wiring`，不传 `-Push`。真实双案例运行 [参数化 launcher](../../../../tests/manual/agentarts/run-wukong-test-version.ps1)，参数和受信配置见 [RUN](../../TEST_IMAGE_V3_RUN.md)，将 `-Image` 指向本轮标签，CPU示例 `-Device cpu -TorchThreads 1`；密钥与权重不在仓库，模型目录必须有通过校验的 `asset-manifest.json`。

设计网页、桌面实际入口、协作者接口见 [V4 接线](../../WORKFLOW_WIRING_V4.md)。原 Node.js 页面仍在 `docs/design/workflow-architecture-20261013/source`，`npm ci`、`npm run export:offline`、`npm run preview -- --host 127.0.0.1 --port 4173` 后用 Chrome 打开 `/architecture.html`，或直接打开其上级 `index.html`。

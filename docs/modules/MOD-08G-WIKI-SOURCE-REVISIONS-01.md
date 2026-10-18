# MOD-08G：Wiki 只读来源身份与版本

<!-- current-design-20261013 -->
> 本文按所记版本阅读，API/阶段/验收事实保留。当前依据：[完整主架构](../design/workflow-architecture-20261013/DESIGN.md) · [28功能流程](../design/workflow-architecture-20261013/WORKFLOWS.md) · [连通图](../design/workflow-architecture-20261013/index.html) · [接口状态](../interfaces/CURRENT_INTERFACE_CATALOG.md) · [协作规则](../../CONTRIBUTING.md)。当前实验为本机Laya有限候选判断，资格不足升级原受信teacher，国内执行模型经AgentArts调用；自有ARM64镜像串行编排，架构未最终定型。历史部署方案不覆盖当前决定，模板数量不等于业务验收；旧双人本机阅读不作为现行要求。设计不等于实现；非作者有效Approve和真实检查仍须满足。


- Profile：`huawei_ict_agentarts`
- 负责人：`goo122`；非作者评审：其他已登记协作者
- 状态：`review`；本地实现及离线门禁通过，2026-10-11 已获提交/推送/创建 PR 授权，与 MOD-08H/I 联合交付；待非作者评审及集成，整个 MOD-08/09 尚未完成
- 需求：PA-008 可追溯知识检索；PA-024 来源版本与有效期（本包只交付 Wiki 来源部分）
- 基线：`main@e86bac53`；分支：`codex/goo122-wiki-source-revisions`
- 目录：`packages/knowledge`、本工作包文档、接口目录和必要集成验收
- 决策：[ADR-0022](../adr/0022-wiki-source-identity.md)，状态 proposed

## 实现边界

公开进程内 `WikiPort` 提供 `scanPages/search/readCitation`。本机 Markdown 适配器
复用已存在的 Knowledge 有界扫描和安全读取。受信宿主显式绑定 sourceId、namespace、
configRevision、dataLevel、validUntil 和整个目录的读取许可，返回相对位置、pageId、内容 revision。
异步读取前后验证配置/许可，切库或撤销不会把旧任务切换到新来源。

原生文件身份保留同卷 rename 的页面 ID，内容相同的独立文件不会被合并；
正文修改使旧引用返回 SOURCE_CHANGED，同内容的新文件复用旧路径也拒绝旧引用。
原位置缺失或不可读返回 SOURCE_UNAVAILABLE，不能据此证明已删除。
根目录身份替换、链接及越界拒绝；扫描失败不返回部分清单。
扫描不生成 Feed、确认记忆、写入原文件或删除任何投影。

`createWikiPort` 支持显式注入已授权 reader；`createFakeWikiPort` 使用固定合成文档，
`createUnavailableWikiPort` 明确返回 SOURCE_UNAVAILABLE，不静默回退。
旧 Knowledge 搜索结果和 readNote 的结构保持原样；新增 filesystem host-only 方法。
没有新 wire capability、公共协议 Schema、数据库迁移或依赖。

## 验收

本包使用公开合成 Markdown，验证原生文件扫描/引用和显式 Fake 的许可边界。
用例覆盖重复扫描、同内容不同身份、编辑失效、移动和重新打开的身份连续、旧路径复用、
配置/分类替换、撤销、取消、超时、扫描失败、根替换、链接及路径越界。
实际验证（2026-10-10）：

- 锁定依赖安装：`npm ci --ignore-scripts --no-audit --no-fund` 成功。
- 根 `npm run build` 及最终 Knowledge 模块 build 成功；没有新增依赖。
- `npm run test --workspace=@personal-agent/knowledge` 首次 39 项、38 通过、1 跳过；
  自审补齐有效期与读取期间参数替换测试后，完整 check 内 Knowledge 为 40 项、39 通过、1 跳过，新增 Wiki 11/11 通过。
- `npm run check` 退出 0：架构、契约、生成类型、构建/类型检查、全部 workspace 测试和根集成均成功。
  日志合计 2647 项、2618 通过、29 跳过、0 失败；其中 Desktop 705/703 通过/2 跳过，
  Runtime 439/439，根集成 22/22。Knowledge 跳过项是 Windows 文件符号链接权限不可用。
- 完整 check 中有 4 项 Windows Job 测试因 helper 尚未构建跳过。按 Foundation CI 使用既有
  .NET 8 SDK 构建 `packages/coding-tools/native/build-helper.mjs`，显式注入 PA_TEST_JOB_HOST_EXE，
  补跑 `node --test packages/coding-tools/test/workspace-command.test.mjs`：23/23 通过、0 跳过，
  原先跳过的树取消、成功执行、deadline 和根退出四项均实际执行成功。
- `git diff --check` 成功。原根工作树及其他协作者文件保留。

验证日志位于本工作树忽略目录 `.cache/wiki-check.log`、`.cache/wiki-native-tests.log`、
`.cache/wiki-tests.log`。测试均为合成文件/任务及显式 Fake，不读取私人 Vault、不调用真实模型。
默认沙箱对本机原生 realpath 返回 EPERM，因此离线文件测试使用正常本机权限运行；
构建及 TEMP/辅助程序目录均限于项目忽略缓存，不改变系统配置。

## 下一包

2026-10-10：用户已授权启动下面第 1～3 项，实现及专项验收进展见
[MOD-08H](MOD-08H-WIKI-MEMORY-PROJECTION-01.md)；下述限制记录第一包交付时的范围。

1. 在现有 trusted Knowledge source configuration 中装配此端口，验证真实用户选择范围及撤销。
2. 仅将逐条确认的摘录/更正投影到 Memory；原始证据包含此来源身份和版本。
3. 来源变化触发已有 FactChangeFeed 的幂等撤回/受影响消费；缺失或扫描失败不自动删除。
4. 再接受控 patch 写回和未知写入核实，使用既有 Runtime/Policy/ToolGateway。

## 未验证与限制

没有改动私人 Vault，没有调用 AgentArts 或其他模型。
尚无 Desktop 默认装配、真实 Obsidian 插件、后台索引、跨卷/跨设备身份关联、
正文与 SQLite 的跨存储原子写入、Memory 自动同步或云端消费。
本机复制、跨卷移动和编辑器替换保存视为新页面；读取不能替代 OS 沙箱。
完整模块完成仍需对应验收、非作者评审和集成。

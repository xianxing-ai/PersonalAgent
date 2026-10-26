# PR #503 当前邮件卡片夹具与历史状态修正

2026-10-26 UTC；`huawei_ict_agentarts`。本轮从干净的
`cd3a32bd1d854c61537bae4c52c777feb2d453a0` 开始，工作树仍为
`.worktrees/pr503-main521-integration-20261026`。开始时远端 #503 head 与本树一致，
main 为 `a3e9d51d331f3ddc1b42a12962b8397137f7a91c`；协作规则没有新变化。

## 已证失败与最小修改

[Foundation 40284109783](https://github.com/xianxing-ai/PersonalAgent/actions/runs/40284109783)
Windows job `121443773823` 在实际 source cd3 的完整检查中失败：
`apps/desktop/test/connector-empty-state.test.mjs:8` 预期“已分类 7363 封”，
实际为“历史分类 7363 封 · 非实时 / 需重新授权 / 当前会话尚未允许读取”。
根忽略目录 `.cache/pr503-final-ci-20261026/source-windows-121443773823.log:4009`
保留原完整日志，SHA256
`5d0cbc957c4eee31fb12d8a3b0abd3e2635e8c2a5af4676788db454a454bf978`。
这是已复现的 JavaScript 夹具语义冲突，未归因为环境故障。

原“当前卡片”用例使用 `status:'disabled', sessionAllowed:false`，却预期当前分类和
启动监测说明。实际 `connectorCards` 沿 main #511 的原 `historicalMailCard` 正确将其
渲染为无当前读取许可的历史缓存；生产逻辑和原历史卡片保护测试均不应回退。

本次仅修改 `connector-empty-state.test.mjs`：

- 原当前卡片用例显式使用 `sessionAllowed:true`，保留分类数量、未读数缺失、监测与
  转义断言。它仅是 **Synthetic trusted-host snapshot**，该布尔值不创建或验证真实 grant。
- 单独增加实际 `connectorCards` 消费回归，保持 `sessionAllowed:false`，明确要求历史
  数量、非实时、需重新授权、当前会话未允许读取与不会读取新邮件；拒绝当前分类、
  未读数量、当前监测或已允许等误导显示，保留转义和导航到原连接设置的断言。
- 生产 helper、权限、读取/监测入口、原 `mail-history-card` 测试和其余连接器断言未改。

## 先红后绿

固定 Node 24.15.0 / npm 11.12.1，复用本树既有独立依赖/dist。修改前先执行原文件：

```sh
node --test --test-concurrency=1 apps/desktop/test/connector-empty-state.test.mjs
```

exit 1：7 项，6 pass / 1 fail / 0 skip；准确复现官方原正则断言。
修正后仅执行两个必要消费文件：

```sh
node --test --test-concurrency=1 \
  apps/desktop/test/connector-empty-state.test.mjs \
  apps/desktop/test/mail-history-card.test.mjs
```

exit 0：**12/12 pass，0 fail / 0 skip**。原历史卡片的实际本地宿主/加密缓存 Synthetic
case 继续断言 `providerReads === 0`、`permissionMints === 0`，无当前许可时的读取和
批次入口仍拒绝。这里没有真实邮箱、账号、云模型或实体设备调用。

修改后测试文件 `node --check`、staged/unstaged `git diff --check` 和相对 cd3 的生产零
diff 检查通过。未重建、未重跑先前 114/56 项或全仓检查；没有修改生产行为来迎合测试。

## 日志与提交绑定

本树忽略目录 `.cache/pr503-connector-fixture-ci-20261026/` 保存原日志、独立命令回执和
独立逐文件 SHA 清单，文件名彼此不同。完整命令及 UTC/wall/exit 均在 `*-command.json`：

| 日志 | UTC 起止 | wall / exit | SHA256 |
| --- | --- | --- | --- |
| `red-run.log` | 07:31:32–07:31:32 | 0.117s / 1 | `d5874f86fe571d78d796c51973bdbdc95d4299f5f7ceeda9a9ee551af7b88ad2` |
| `green-run.log` | 07:31:46–07:31:47 | 1.192s / 0 | `f900dd1f75667d0996fd5e98d74b395c708a7653d50bfceaf794cde727a034da` |
| `syntax-diff-run.log` | 07:32:57–07:32:57 | 0.066s / 0 | `6d74ebb26fbd4cc3cc71e239ccfc7711cb4bdd9186f3d5fe8b5e5cbd4444f991` |

测试在普通提交前执行，之后仅新增本 Evidence；最终 head 与已测文件的一致性、干净状态
及相对 cd3 除本测试/Evidence 外全部 tracked 路径零 diff 的证明在 `final-head.json`。
绿色文件集 fingerprint（仅排本 Evidence 自引）为
`8391aced63c91c17cf1fea7301d5e755dad168e3c2dd093a97106bc707a33322`。
不把提交前执行声称为提交后重跑，不将局部绿或旧 CI 代替新 head 的正式必需检查。

本轮未 push、修改 PR、重跑 CI 或批准，root 唯一发布。没有真实读取许可变更、provider
调用、新模型请求、部署或功能扩充；历史 Synthetic/SQLite/真实回执仍保持各自原版本范围。

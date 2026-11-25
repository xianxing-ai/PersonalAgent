# F14 N01 浏览器观察适配器（2026-10-29）

Profile：`huawei_ict_agentarts`。本轮新增 `apps/runtime/src/application/workflow-f14-observation-host.ts` 并通过 `apps/runtime/src/application.ts` 导出。适配器复用已发布的 `browser.observe` 名称与原作用域；要求受信调用口通过原 Runtime/Policy/ToolGateway 执行，并核对原子任务、请求、当前有效观察、地址、证据和出口授权，仅输出有界控件数量。它不执行浏览器动作、不赋予新权限、不输出原 task 绑定的 targetRef，也不证明页面业务结果。

测试（本机 Node 24.15.0）：直接运行 `node node_modules/typescript/bin/tsc -p apps/runtime/tsconfig.json` 成功；`node --test apps/runtime/test/workflow-f14-observation-host.test.mjs` 5/5 通过。测试使用 Synthetic Runtime 记录与浏览器观察，覆盖缺受信口不注册、观察回执与导出授权、缺 scope/页面变化/证据缺失/撤权、伪造元素数、原图任务未确认、观察过期及导出过程中来源变化，且验证不重放观察；不代表实际浏览器、真实设备、生产组合或整图验收。尝试 `npm run build --workspace=@personal-agent/runtime` 返回 `tsc is not recognized`；随后直接调用当前工作树安装的 TypeScript CLI 完成编译。并行编辑期间曾因 F11 TypeScript 报错阻断编译，后续直接编译通过；首次使用旧 dist 的 3/5 测试结果不得视为当前代码测试。

导出 graph receipt 时，适配器从原 Runtime checkpoint 读取此前持久绑定的观察任务，检查 F14 本身和 browser.observe 的原任务成功状态、确认结果与执行 Evidence，以及元素数与原观察一致；出口授权前后重新核对绑定、读回及有效期，且不再次运行浏览器观察。

Desktop 目前没有把该工厂注入实际工具目录，也没有实现对应可信 `invokeObservation`/出口授权；因此 F14_N01 在生产组合仍为 unavailable。`browser-control-host.js` 将 targetRef 绑定到创建观察的 `taskId`，而不同图节点的 HostBridge 子任务不相同；F14_N02/N03/N06 需要沿原设备会话验证绑定并复用现有 `computer-control-lease.js` 输入锁，不能直接跨子任务复用 targetRef 或增加 scope。用户指定带 query 的 URL 仍需受信地址比较方案；当前只接受不带凭据、query 和 fragment 的原页面 URL。此记录不勾选整图验收。

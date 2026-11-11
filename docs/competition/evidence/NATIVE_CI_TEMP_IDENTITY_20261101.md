# Windows CI 临时目录与 Fake Host 身份修复

Competition Profile，隔离工作树 `.worktrees/pr531-native-ci`，基线 `df3f6c48`。

远端 `8007e03f` 的 Job 发布夹具在严格目录检查拒绝；日志没有输出实际临时目录，
不能据此断言 runner 使用了哪一种短路径或链接。原发布器直接传递 `mkdtemp` 返回值，
本机以自有 TEMP junction 稳定复现了未规范路径。现在只对发布器自己刚创建的目录
调用 `realpath`；包校验器、外部输入与加载面规则不变。测试同时要求传给构建器的路径
已规范化，拒绝资源链接、额外 DLL、旧非空发布目标与不完整清单。

三项 Windows Host 生命周期夹具模拟了进程，却遗漏新增加的包身份端口，因此默认
FDD 检查尝试读取不存在的 `D:\synthetic\WindowsHost.Host.runtimeconfig.json`。
夹具现在显式注入 Fake 身份端口并断言 exact host/bridge 路径；新增身份拒绝零 spawn。
原关闭超时不能冒充已释放、幂等关闭、发送失败无孤立 rejection 断言保持。
没有修改 Runtime 生产校验、PSEC、普通 token、peer PID/session、nonce 或干净环境。

验证：

- `npm run build`：通过。
- `node --test apps/desktop/test/native-job-component.test.mjs apps/desktop/test/native-windows-host-component.test.mjs apps/desktop/test/publish-native-desktop.test.mjs apps/runtime/test/windows-host-lifecycle.test.mjs packages/coding-tools/test/native-helper-bundle.test.mjs`：40 通过、1 跳过、0 失败。
- `git diff --check`：通过。最终完整 `npm run check` 由根集成树统一执行。

这些是明确合成包字节、Fake 子进程和本机文件系统验证。真实 Host hello/EOF 用例因未配置
正式包而跳过；本次未运行 UI/Notepad，也不替代先前或后续原生实体验收。首次提前于构建
完成的试跑记录含 Runtime dist 缺失，完成构建后上述原断言运行通过；日志均留于本树 `.cache`。

# 本地 Laya 真批处理适配

<!-- current-design-20261009 -->
> 当前目标与协作规则（2026-10-09）：[完整设计](../../docs/design/resident-developer-agent-20261008/DESIGN.md) · [离线阅读/全部 SVG](../../docs/design/resident-developer-agent-20261008/index.html) · [两人确认与本机阅读门槛](../../docs/reviews/DESIGN_READING_GATE.md)。WSS 主通道、HTTPS 备用；Wiki 记忆由 goo122 接入。goo122 与 Potatos498 均确认后才可按授权合并，禁止强制合并/管理员绕过。设计不等于已实现；本文历史验收与作者记录保留，旧合并规则以当前门槛为准。

> 维护入口（2026-10-07）：项目主要负责人为 zemeng；当前分工以 [模块分工](../../docs/MODULE_ASSIGNMENTS.md) 为准，最新状态见 [ROADMAP](../../docs/ROADMAP.md)。历史日期、作者和验收结论按原记录保留。

`batch-server.py` 属于本项目，不修改第三方 site-packages。只有直接执行 `main()` 才加载模型。
现有 `laya[serve]` 虚拟环境可运行，启动前由可信宿主设置：

- `LAYA_MODEL_PATH`：已有 multilingual 模型目录的绝对路径，包含 `model.safetensors`。
- `LAYA_API_KEY`：只通过进程环境提供，不写仓库、日志或 Renderer。
- `LAYA_PORT`：可选，默认 8000，范围 1024–65535。

使用已有虚拟环境 Python 执行此脚本。固定绑定 `127.0.0.1`、CPU、两个 Torch 线程，强制 Hugging Face / Transformers 离线模式；缓存缺失即失败，不下载。不要在内存不足时启动，且不同时运行旧 Laya 服务造成重复权重加载。

`GET /health` 同样要求 Bearer，返回 `capabilities: ['multi_state']` 与 `maxStates: 4`。仅在宿主明确配置此能力后，使用 `LocalLayaBatchHttpTransport` 和 `LayaTriageService(..., {batching: 'multi_state'})`。

`POST /v1/systemone/batch` 输入 `{model:'multilingual', items:[{requestId,state}], questions, deadline}`。
每批 1–4 个独立 state，共享 questions；服务调用一次 `Agent.predict_batch(states, questions, batch_size=4)`，按原序把结果与 requestId 配对。客户端再次核验身份，不因响应重排错配邮件。结果 `{batching:'multi_state',items:[{requestId,result}]}`。旧 `POST /v1/systemone` 单 state、多 question 入口保留。

所有接口要求 Bearer；请求最大 128 KiB，每独立 state 最大 5000 字符。只有受限 choice 问题，拒绝无白名单的任意输出。全服务一个推理执行器，忙时返回 429，宿主不能盲目重试。错误不回显源正文、路径或异常详情。

CPU 前向不能由 HTTP 取消强行中断：请求超时/断连后不交付结果，当前前向结束前仍拒绝新推理，防止取消造成并发内存激增。后续 chunk 由客户端 deadline/signal 阻止。服务不调度、不读取邮箱、不启动其他模型、不训练，也不向云发送数据。

原增量完成 Python AST 语法检查与 TypeScript/Fake 客户端协议验证；未启动服务或加载权重。真实批处理吞吐、峰值内存及分类质量需另行验收。

## 无模型的释放回归

在已有 FastAPI 环境运行 `python scripts/laya/test_batch_server.py`。测试直接调用受控请求端口，不开网络监听、不导入 Torch/Laya 权重；覆盖超时后后台任务仍忙时保持 429、迟到模型异常不进入事件循环日志、后台结束后重新受理。该检查不在 Node Foundation 中自动运行，也不能代替真实模型或性能验收。

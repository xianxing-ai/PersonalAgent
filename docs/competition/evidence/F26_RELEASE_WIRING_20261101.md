# F26 原发布链接线

Competition 配置沿同一加密 AgentArts 配置新增可选 releaseBinding，固定平台实际选定的 runtime/endpoint/version/SWR digest；不创建发布配置库。开发态仅使用当前应用源码根、原 HEAD 与固定发布脚本，打包应用无源码则 unavailable。原脚本继续生成 allowlist Docker context，不上传整仓目录。

N02 通过 Runtime/ToolGateway 和原生执行宿主执行固定发布指令；现有实现必须选择 `full-access`（完全访问），该模式自动批准应用授权，不弹逐任务同意卡。实际验收尚未切换此模式。Docker daemon 与网络不受文件隔离限制，不宣称进程隔离。未知原命令只读原 journal，不能以新操作重试。N03 控制面 READY、认证 invoke 读回、N04 原提案/Policy/工具/Evidence 分开检查，N05 仅记录本次覆盖，不自动更改服务路由或伪称全部比赛验收。IMAGE 新读回仅绑定原非秘密传输摘要，传输成功不等于工具成功。

真实云、设备/本机和 Fixture 检查分别记录；尚无当前新镜像/平台整图成功声明。

接管后修正 worker 结果 Schema、公开 Runtime descriptor 读取、可选镜像摘要的 JSON 持久绑定及实际 Node/Docker 发现；Main 和固定发布绑定管理页已接线。构建结果按原 N02 读回的 SWR digest 核对，不要求在构建前猜测摘要。一次完整原图/Runtime/Policy/SQLite/业务子任务检查通过，构建、镜像服务和公共 HTTP 均为 Fixture。发布仍受固定命令 120 秒及原 task deadline 限制；原 N02 真实构建与发布总耗时、控制面固定版本读回和真实工具闭环待验。N03 不会自动新建版本或改端点路由。

## 真实平台进展与未闭合项（2026-11-02）

云代码 `ad354455` 的 ARM64 镜像已实际构建、导出并通过 Edge 上传 SWR。标签 `pr531-ad354455` 的注册表 manifest 为 `sha256:a7ef99f0ae475e40ad77c0fb7f32d3f6eb5f1d37cb9ba42369a26633ad94d6b0`，CLI 独立读回的 config digest 与本地镜像一致。现有 runtime `9a65747e-05f0-475c-a2dc-f24dd3ed87ae` 新固定版本及端点 `pr531-ad354455-v2` 已部署，认证目录调用及 F23 原宿主任务的四次真实模型调用成功。以上是发布操作和局部调用证据，未经过 F26 原五节点图，不能作为 F26 全图通过。

真实 UI 拒绝 `image@sha256`、接受标签镜像地址。N03 reader 已补同一 SWR 仓库标签的原生 Docker `buildx imagetools inspect --format '{{json .Manifest}}'` 读回：两次平台 runtime 读取分别解析标签，必须都与原 N02 构建摘要一致，并保持平台原标签不变。没有可信解析器、摘要漂移或跨仓库标签均拒绝；摘要地址的原行为保留。该定向测试 1/1 通过，无新依赖、无公共 wire 或数据库迁移。当前尝试真实标签读取返回 SWR 401，临时注册表登录已失效，尚未完成这条新路径的真实验证。

用户授权的现有本地 CSV 凭据仅执行了一次固定版本 GET，返回 HTTP 404 / `AgentArts.03000001`，未读到目标 runtime，未重复请求、未据此保存为已验证配置。该次检查时，登录账号存在名为 `PersonalAgent observation` 的启用密钥，但平台只能下载一次且密钥配额已满；现有 Desktop userData、项目工作树的标准加密配置文件和当前进程环境未找到可复用观测配置。未停用任何既有密钥。Edge 登录不等于原宿主 SDK 签名授权。当前控制面真实读回及真实工具证据仍未闭合，保持未完成。

后续已创建专用 IAM 只读身份，同一身份签名读取 F23 平台评估结果 API 返回 HTTP 200。F26 固定 runtime 的端点列表 GET 返回 HTTP 403 / `AgentArts.03005403`；平台授权诊断明确指出 `agentarts:runtimeEndpoint:listCoreRuntimeEndpoints` 缺少同一 runtime 下 `runtimeEndpoint:pa-owned-bindings-0dae0ff5-api/*` 集合资源的授权，当前单端点资源范围不覆盖该请求。此处通配符要求来自实际平台诊断；[官方权限表](https://support.huaweicloud.com/api-agentarts/Permission2.html)的星号仅标识必需资源类型。F23 结果读回成功不代表 F26 部署读回通过；F26 尚未取得真实端点 UUID，也未完成固定 runtime/endpoint 及原五节点图的真实验收。

19:02（UTC+08）补充：用户保留原端点列表范围，未增加集合通配符。固定端点 UUID `1349e2f9-d703-4127-816a-df5bbdb696e1` 已从当前登录账号的官方 API Explorer 响应取得。专用只读身份的精确单端点 GET 最初仍返回 403，平台明确要求同时授权父 runtime；用户批准仅为 `showCoreRuntimeEndpoint` 补上同一个父 runtime 后，固定版本 runtime GET 与单端点 GET 均返回 HTTP 200，runtime 为 READY，端点名称和目标版本均为 `pr531-ad354455-v2`。使用轮换后的本机加密凭据，未增加写权限或扩大列表权限。此结果只证明固定控制面绑定读回，不代替原 N02、认证 invoke、工具闭环或 F26 全图验收。

## 契约与源码绑定复核（2026-11-02）

纠正先前将“新版本自动部署”列为既有接线缺口的表述：[F26 节点定义](../../../packages/agentarts/src/owned-workflow-data.ts)中 N03 是 `deterministic_check`、`effectType:读取`，要求读取实际镜像、deployment 和健康结果；[节点清单](IMAGE28_HOST_GUARD_CHECKLIST_20261028.md)公布的能力是 `deployment.runtime_readback`。预先部署固定版本，再由原五节点图严格核对同一镜像摘要，符合当前读回契约；自动创建版本或修改路由属于额外写行为，不在本次读回实现中暗加。原 N02 和整图仍未真实执行，现有手动部署不能代替其回执。

固定端点错配已由 `95804ebd` 修复：发布绑定的 `endpointName` 必须等于实际 HTTPS 调用的 `deploymentVersion`，防止控制面验证与认证 invoke 指向不同端点；相关配置、传输和读回检查 34/34 通过。另将根 `tsconfig.base.json` 加入 Desktop 原源码集合及发布脚本的未提交修改检查，四个构建包继承的编译配置随原 tree digest 绑定，不能在 HEAD 不变时绕过源码检查。本次仅做静态 diff 与语法检查，未重复构建或调用真实服务。

镜像导出器和 Dockerfile 不向镜像写入 HEAD，发布脚本只在宿主 `release.json` 记录源码提交；`ad354455` 至 `a89d7e1a` 在固定来源目录中的唯一变更是未导出的测试文件。镜像摘要是否一致仍须由原 N02 重建和 SWR 读回确认。既有 `ad354455` 构建日志最大 Docker 阶段为 21.2 秒，尚无原 N02 全流程超过 120 秒的证据；该上限包含 npm 构建、导出、Docker 构建/推送/读回，不预先扩大公共命令期限。

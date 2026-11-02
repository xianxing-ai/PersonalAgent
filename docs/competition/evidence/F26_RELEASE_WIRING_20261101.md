# F26 原发布链接线

Competition 配置沿同一加密 AgentArts 配置新增可选 releaseBinding，固定平台实际选定的 runtime/endpoint/version/SWR digest；不创建发布配置库。开发态仅使用当前应用源码根、原 HEAD 与固定发布脚本，打包应用无源码则 unavailable。原脚本继续生成 allowlist Docker context，不上传整仓目录。

N02 通过 Runtime/ToolGateway 和原生权限卡执行固定发布指令；Docker daemon 与发布需要原明确完整权限，不宣称进程隔离。未知原命令只读原 journal，不能以新操作重试。N03 控制面 READY、认证 invoke 读回、N04 原提案/Policy/工具/Evidence 分开检查，N05 仅记录本次覆盖，不自动更改服务路由或伪称全部比赛验收。IMAGE 新读回仅绑定原非秘密传输摘要，传输成功不等于工具成功。

真实云、设备/本机和 Fixture 检查分别记录；尚无当前新镜像/平台整图成功声明。

接管后修正 worker 结果 Schema、公开 Runtime descriptor 读取、可选镜像摘要的 JSON 持久绑定及实际 Node/Docker 发现；Main 和固定发布绑定管理页已接线。构建结果按原 N02 读回的 SWR digest 核对，不要求在构建前猜测摘要。一次完整原图/Runtime/Policy/SQLite/业务子任务检查通过，构建、镜像服务和公共 HTTP 均为 Fixture。发布仍受固定命令 120 秒及原 task deadline 限制；真实 ARM64 构建耗时、当前控制面凭据、新版本部署和真实工具闭环待验。N03 不会自动新建版本或改端点路由。

## 真实平台进展与未闭合项（2026-11-02）

云代码 `ad354455` 的 ARM64 镜像已实际构建、导出并通过 Edge 上传 SWR。标签 `pr531-ad354455` 的注册表 manifest 为 `sha256:a7ef99f0ae475e40ad77c0fb7f32d3f6eb5f1d37cb9ba42369a26633ad94d6b0`，CLI 独立读回的 config digest 与本地镜像一致。现有 runtime `9a65747e-05f0-475c-a2dc-f24dd3ed87ae` 新固定版本及端点 `pr531-ad354455-v2` 已部署，认证目录调用及 F23 原宿主任务的四次真实模型调用成功。以上是发布操作和局部调用证据，未经过 F26 原五节点图，不能作为 F26 全图通过。

真实 UI 拒绝 `image@sha256`、接受标签镜像地址。N03 reader 已补同一 SWR 仓库标签的原生 Docker `buildx imagetools inspect --format '{{json .Manifest}}'` 读回：两次平台 runtime 读取分别解析标签，必须都与原 N02 构建摘要一致，并保持平台原标签不变。没有可信解析器、摘要漂移或跨仓库标签均拒绝；摘要地址的原行为保留。该定向测试 1/1 通过，无新依赖、无公共 wire 或数据库迁移。当前尝试真实标签读取返回 SWR 401，临时注册表登录已失效，尚未完成这条新路径的真实验证。

用户授权的现有本地 CSV 凭据仅执行了一次固定版本 GET，返回 HTTP 404 / `AgentArts.03000001`，未读到目标 runtime，未重复请求、未据此保存为已验证配置。当前登录账号存在名为 `PersonalAgent observation` 的启用密钥，但平台只能下载一次且密钥配额已满；现有 Desktop userData、项目工作树的标准加密配置文件和当前进程环境未找到可复用观测配置。未停用任何既有密钥。Edge 登录不等于原宿主 SDK 签名授权。N03 新版本部署自动接线、当前控制面真实读回及真实工具证据仍未闭合，保持未完成。

# F26 原发布链接线

Competition 配置沿同一加密 AgentArts 配置新增可选 releaseBinding，固定平台实际选定的 runtime/endpoint/version/SWR digest；不创建发布配置库。开发态仅使用当前应用源码根、原 HEAD 与固定发布脚本，打包应用无源码则 unavailable。原脚本继续生成 allowlist Docker context，不上传整仓目录。

N02 通过 Runtime/ToolGateway 和原生权限卡执行固定发布指令；Docker daemon 与发布需要原明确完整权限，不宣称进程隔离。未知原命令只读原 journal，不能以新操作重试。N03 控制面 READY、认证 invoke 读回、N04 原提案/Policy/工具/Evidence 分开检查，N05 仅记录本次覆盖，不自动更改服务路由或伪称全部比赛验收。IMAGE 新读回仅绑定原非秘密传输摘要，传输成功不等于工具成功。

真实云、设备/本机和 Fixture 检查分别记录；尚无当前新镜像/平台整图成功声明。

接管后修正 worker 结果 Schema、公开 Runtime descriptor 读取、可选镜像摘要的 JSON 持久绑定及实际 Node/Docker 发现；Main 和固定发布绑定管理页已接线。构建结果按原 N02 读回的 SWR digest 核对，不要求在构建前猜测摘要。一次完整原图/Runtime/Policy/SQLite/业务子任务检查通过，构建、镜像服务和公共 HTTP 均为 Fixture。发布仍受固定命令 120 秒及原 task deadline 限制；真实 ARM64 构建耗时、当前控制面凭据、新版本部署和真实工具闭环待验。N03 不会自动新建版本或改端点路由。

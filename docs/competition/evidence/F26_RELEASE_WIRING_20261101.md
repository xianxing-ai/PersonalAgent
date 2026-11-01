# F26 原发布链接线

Competition 配置沿同一加密 AgentArts 配置新增可选 releaseBinding，固定平台实际选定的 runtime/endpoint/version/SWR digest；不创建发布配置库。开发态仅使用当前应用源码根、原 HEAD 与固定发布脚本，打包应用无源码则 unavailable。原脚本继续生成 allowlist Docker context，不上传整仓目录。

N02 通过 Runtime/ToolGateway 和原生权限卡执行固定发布指令；Docker daemon 与发布需要原明确完整权限，不宣称进程隔离。未知原命令只读原 journal，不能以新操作重试。N03 控制面 READY、认证 invoke 读回、N04 原提案/Policy/工具/Evidence 分开检查，N05 仅记录本次覆盖，不自动更改服务路由或伪称全部比赛验收。IMAGE 新读回仅绑定原非秘密传输摘要，传输成功不等于工具成功。

真实云、设备/本机和 Fixture 检查分别记录；尚无当前新镜像/平台整图成功声明。

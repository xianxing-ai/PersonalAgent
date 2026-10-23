# 2026-10-23 既有 ARM64 镜像实际拉取与执行

目标 profile：`huawei_ict_agentarts`。本轮只读仓库/registry，正常拉取及本机协议验证；没有推送、发布或部署。原始命令结果保存在本工作树忽略目录 `.cache/image-audit/`。不要将本记录当作最新云端部署证明。

## 来源与“最新”的范围

- 仓库 API 已重定向至 `xianxing-ai/PersonalAgent`，原 remote 为 `zemeng5208/PersonalAgent`。
- 读取 `owned-image-preview.yml` 最近十次运行，最新成功为 [38339645031](https://github.com/xianxing-ai/PersonalAgent/actions/runs/38339645031)，2026-10-13，revision `0cbb3f1dee2d98b692e8229f3844eb3c4a2a2a87`。
- 正常匿名 registry token 读取 GHCR `tags/list` 的全部 14 标签，再逐一读取 ARM64 manifest/config 并按 config.created 排序，最新仍为该 revision，created `2026-10-13T03:02:07.425783516Z`。GitHub packages versions API 因当前 token 缺少 `read:packages` 返回 403；不扩大凭据权限。
- 最新 Release 为 2026-10-16 `agentarts-preview-local-laya-v3-244ca434`，它引用 SWR `local-laya-v3-244ca434`、index `sha256:244ca4340ae5c0f0ee62df98b2e86cddc16a543cb6d1eb5f7abbf163528d96e1`。SWR 实际 manifest 查询返回 401；当前 Docker config 没有 registry auth selectors。本轮不能证明 SWR 最新标签或将 Release 文字当作已拉取证据。
- Issue #459 的旧 `owned-1.7` 材料是历史证据，不是本轮最新镜像来源，也未用于冒充本轮拉取。

## 实际拉取的不可变身份

镜像仓库 `ghcr.io/zemeng5208/personal-agent-owned`：

| 项目 | 实际读回 |
| --- | --- |
| tag | `sha-0cbb3f1dee2d98b692e8229f3844eb3c4a2a2a87` |
| index | `sha256:3e7e5c361ef226d3cb26a321ca2daaae463336f8480171a0c3c52a1f682404b1` |
| ARM64 manifest | `sha256:942eccec3311e3e40e871b9dbd60600a3c2174b76992886c50e6c2026b3c78c1` |
| config / local image ID | `sha256:8a7814a701dbfebf9e457b13139bd812679bab1c2fe18c16dd7714ac7e887bba` |
| platform | `linux/arm64` |
| OCI revision | `0cbb3f1dee2d98b692e8229f3844eb3c4a2a2a87` |

`docker pull --platform linux/arm64 ghcr.io/zemeng5208/personal-agent-owned@sha256:3e7e5c361ef226d3cb26a321ca2daaae463336f8480171a0c3c52a1f682404b1` 成功。index 另含 `unknown/unknown` attestation，不含 AMD64 应用 member。

## 本机真实运行

managed Docker 28.4.0，host x86_64。直接 `docker run --platform linux/arm64 --entrypoint node …` 实际失败 `exec /usr/local/bin/node: exec format error`，不能宣称本机原生执行 ARM64。

不注册 binfmt、不使用 privileged。仅从已有/正常拉取的 `tonistiigi/binfmt@sha256:400a4873b838d1b89194d982c45e5fb3cda4593fbfd7e08a02e76b03b21166f0` create/cp 提取静态 `/usr/bin/qemu-aarch64`，以只读 bind mount 和显式 entrypoint 执行 ARM64 Node。QEMU 为 10.2.3。本环境该 emulator 需要重复 guest executable 参数；首轮未重复时参数错位，失败日志保留，没有归因成产品缺陷。

验证命令结构：

```sh
docker run --rm --platform linux/arm64 \
  --mount type=bind,src="$PWD/.cache/image-audit/qemu-aarch64",dst=/qemu-aarch64,readonly \
  --entrypoint /qemu-aarch64 "$IMAGE" \
  /usr/local/bin/node /usr/local/bin/node \
  -e 'console.log(JSON.stringify({arch:process.arch,node:process.version,platform:process.platform}))'
```

实际输出 `{"arch":"arm64","node":"v24.15.0","platform":"linux"}`。启动镜像自带 `apps/agentarts-runtime/src/main.mjs` 后真实返回：

| 检查 | 结果 |
| --- | --- |
| startup | `listening`, mode `agentarts`, port 8080 |
| GET `/ping` | 200 `Healthy` |
| GET `/bindings` 无鉴权 | 401 `UNAUTHORIZED` |
| GET `/bindings` 本地测试 Bearer | 200，目录 `verification: unverified` |
| POST `/invocations`，合法测试鉴权、空 JSON | 400 `INVALID_ARGUMENT` |

测试容器仅绑定 127.0.0.1:18123，之后正常停止并删除。模型 endpoint 使用 `https://example.invalid/v1`，模型名/凭据均为明确占位符；这些协议检查没有调用模型，也没有 model stub 回答。没有真实 AA/model 凭据，真实云模型/评估验收为 **blocked**。既有镜像为 10-13 构建，不包含本轮源码修复或 PR #485 新文案。

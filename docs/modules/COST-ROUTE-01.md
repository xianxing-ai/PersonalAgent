# 成本路由与回放对比

目标 profile：`huawei_ict_agentarts`。

在现有 fast/flagship 目录和 `executionModel` 上选择模型。短任务用快速模型，多步骤或较长任务用旗舰。用户已经指定的模型保持不变，除非用量上限要求换更便宜的模型。

和未合并的 #636 兼容方式：路由调用可选的 `decide({origin, modelId, candidates})`。返回 `allowed: false` 时不选模型、不回放。返回的 `modelId` 必须在本次目录候选里。估算单价与该用量端口的档位一致（flash/turbo/lite/mini、plus、max/pro）。本路由不另建账本。`costRouteBudget` 留给 #636 的产品在启动时绑定。

回放读取已结束任务的目标，在另一个目录模型上比较。没有已保存的本地执行配置时不发起付费调用。

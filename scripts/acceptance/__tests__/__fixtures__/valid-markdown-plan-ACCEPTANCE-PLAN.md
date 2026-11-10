---
id: f09-cloud-prefix-plan
title: F09 订阅云前缀与会话授权端到端读回离线规划
status: unavailable
closedLoop: false
requiredEnvironments:
  - huawei_cloud
  - real_account
reason: 待真云端网关路由与会话租约在线读回
---

# F09：订阅云前缀与会话授权端到端读回离线规划

## 验收步骤
1. 华为云 AgentArts 托管运行时前缀路由（/invocations/*）公网端点实际映射与读回
2. 华为云端到端会话授权与 feed-source-grant 租约凭据在线读回（非本地 mock）
3. 真实 feeds 连接器多源订阅流拉取、增量 cursor 与去重校验

## 证据要求
1. AgentArts 平台独立 TraceId 关联与 Token/计费读回回执
2. 包含真实 sessionId 与 authorizationRef 的会话租约凭据
3. 真实 feeds 增量数据落盘与独立读回校验

## 挂起项
- huawei_cloud_prefix_route_readback: 华为云前缀路由公网映射
- cloud_session_auth_and_source_grant: 华为云会话授权在线读回

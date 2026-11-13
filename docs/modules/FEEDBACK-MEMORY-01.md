# 反馈学习与记忆整理

目标 profile：`huawei_ict_agentarts`。

在现有私人记忆和流程学习宿主上：

- `learning.feedback` 记下纠正或点评。相同文本不重复保存。面板显示已记下的偏好。
- 宿主启动时，以及之后每 24 小时，按摘要找出重复的活动记忆。
- `learning.consolidate` 先刷新并列出重复建议，不会自动删除或撤回；用户逐条点击“确认撤回”触发 `learning.confirmConsolidate` 并走原来的确认后才撤回。没有确认就不会删。

偏好目前只在这个面板里生效，没有写进模型提示，也没有改对话回答。

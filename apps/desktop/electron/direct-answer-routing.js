/**
 * Static direct-answer routing (#430).
 *
 * A single read-only weather question is answered on the root task instead of being wrapped in a
 * delegated child. This is a fixed, conservative list rather than a model decision: it cannot
 * widen tool scope or Policy, and anything it does not clearly recognise keeps the existing
 * mandatory delegation.
 */
const ACTION = /(整理|创建|新建|修改|编辑|删除|发送|发一封|写一|撰写|生成|执行|运行|部署|提交|安装|卸载|下载|上传|打开|关闭|设置|安排|提醒|预订|预约|购买|付款|转账|订票|订酒店|打车|叫车|修复|翻译|总结|分析|对比|报告|审查|计划|日程|待办|建个|做个)/;
const MULTI = /(并且|然后|同时|分别|以及|首先|其次|第一|第二|多个|每个|逐个|顺便)/;
const WEATHER = /(天气|气温|温度|下雨|降雨|降水|下雪|降雪|刮风|风力|风速|湿度|紫外线|雾霾|空气质量|weather|forecast|带伞|穿什么|适合.{0,8}(跑步|运动|出门|出行|户外))/;
const OTHER_TOPIC = /(邮件|附件|代码|仓库|工作区|文件|表格|文档|会议|日历|订单|发票|合同|简历|论文|网站|接口|数据库|机票|酒店)/;

export const DIRECT_ANSWER_MAX_LENGTH = 120;

/** True only for a short, single, side-effect-free weather query. */
export function isDirectAnswerGoal(goal) {
  if (typeof goal !== 'string') return false;
  const text = goal.trim();
  if (!text || text.length > DIRECT_ANSWER_MAX_LENGTH) return false;
  if (ACTION.test(text) || MULTI.test(text) || OTHER_TOPIC.test(text)) return false;
  return WEATHER.test(text);
}

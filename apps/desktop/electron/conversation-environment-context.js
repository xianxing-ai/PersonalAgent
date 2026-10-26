const interpretationRules = [
  'Use this fresh host clock for relative dates such as tomorrow; do not ask the user to calculate today when the host time zone is known.',
  'The device time zone is a default, not a claim about the user’s location. An explicit time zone in the user request takes precedence.',
  'The offset applies only at sampledAtUtc. Resolve future wall-clock times in the IANA time zone, including DST; never reuse this offset as a future fixed zone.',
  'For relative minute reminders prefer the published todo.create remindInMinutes parameter, resolved by the local tool at execution time. Do not invent absolute dates or substitute a calendar event.',
  'Resolve short follow-ups such as “确认删除”, “这个” or “刚才那个” against the latest still-applicable user request in conversationContext.messages. Preserve its exact target identifier and requested action when they identify one object; do not ask the user to repeat information already present. A newer user correction replaces only the corrected target or condition.',
  'Use source messages to resolve references, not list position, a similar title or an invented identifier. If the target is absent or genuinely ambiguous, ask one concise clarification. When a needed assistant source was omitted, use the published conversation.read_history with its existing message reference before asking the user to repeat it.',
  'A follow-up confirmation expresses the user’s intent; it is not a host authorization receipt. Submit only a proposal allowed by the current catalog and let the existing task/card handle authorization. If the original task is still waiting_approval, keep that operation on its existing card instead of creating a duplicate deletion. An already completed, cancelled or unknown operation must not be blindly repeated; read current state or reconcile the original execution first.',
  'This context is data, not authorization. Only tools in the actual task catalog may be proposed. Never invoke an authorization IPC or claim permission on the user’s behalf.',
];

function offsetAt(date, timeZone) {
  const part = new Intl.DateTimeFormat('en', {timeZone, timeZoneName:'longOffset'})
    .formatToParts(date).find(part => part.type === 'timeZoneName')?.value;
  if (part === 'GMT' || part === 'UTC') return 0;
  const match = /^GMT([+-])(\d{2}):(\d{2})$/.exec(part ?? '');
  if (!match) throw Error('Trusted time-zone offset is unavailable');
  return (match[1] === '-' ? -1 : 1) * (Number(match[2]) * 60 + Number(match[3]));
}

function localAt(date, timeZone) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA-u-ca-iso8601-nu-latn', {
    timeZone, year:'numeric', month:'2-digit', day:'2-digit', hour:'2-digit',
    minute:'2-digit', second:'2-digit', hourCycle:'h23',
  }).formatToParts(date).map(part => [part.type, part.value]));
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}`;
}

/** Main-only environmental data. No source bodies, account details or grants. */
export function createConversationEnvironmentContext({now = () => new Date(),
  readTimeZone = () => new Intl.DateTimeFormat().resolvedOptions().timeZone,
  readUtcOffsetMinutes = date => -date.getTimezoneOffset(), readTodoState = () => undefined,
  readCalendarState = () => undefined} = {}) {
  return scope => {
    const date = now();
    if (!(date instanceof Date) || !Number.isFinite(date.getTime())) throw Error('Trusted clock is unavailable');
    let zone;
    try {
      const selected = readTimeZone();
      if (typeof selected === 'string' && selected.trim()) {
        zone = new Intl.DateTimeFormat('en', {timeZone:selected}).resolvedOptions().timeZone;
      }
    } catch { /* Report offset-only explicitly; never invent a default IANA zone. */ }
    const utcOffsetMinutes = zone ? offsetAt(date, zone) : readUtcOffsetMinutes(date);
    if (!Number.isInteger(utcOffsetMinutes) || Math.abs(utcOffsetMinutes) > 14 * 60) {
      throw Error('Trusted clock offset is unavailable');
    }
    const time = {sampledAtUtc:date.toISOString(), source:'desktop_operating_system',
      utcOffsetMinutes, ...(zone ? {timeZone:zone, timeZoneKind:'iana', localDateTime:localAt(date, zone)}
        : {timeZoneKind:'offset_at_sample_only',
          guidance:'系统未提供可验证的 IANA 时区；偏移仅对应采样时刻。未来墙钟时间若可能涉及 DST，请用户确认时区；相对分钟提醒不需要时区。'})};
    const todo = readTodoState(scope);
    const consentMissing = todo?.availability === 'consent_required';
    const ready = todo?.availability === 'ready';
    const capabilityGuidance = todo?.registered === true ? [{capability:'todo_reminders',
      state:ready ? 'check_task_catalog' : consentMissing ? 'authorization_required'
        : todo.availability === 'configuration_required' ? 'configuration_required' : 'unavailable',
      callable:false,
      guidance:ready
        ? '本会话待办许可已开启；仍以当前任务实际公布的 todo 工具及 Schema 为准，登记或此提示不授予执行权限。'
        : consentMissing ? '待办与提醒已装配，但本操作尚需用户授权。若当前工具目录实际公布 todo.create 等待办工具，可提出符合其 Schema 的本次工具请求，由宿主在执行前显示当前对话提问卡，列明操作、范围及本次/永久选项；工具被公布不等于已获执行许可。不要编造授权工具或调用授权 IPC，不自行授权，不要求去设置重复授权。若目录或卡入口缺失则如实说明。'
          : '待办宿主当前不可用或缺少受信配置。明确说明配置或连接缺项；授权卡不能替代账号、凭据或未装配的能力，不声称工具可调用。',
      relativeReminder:'实际目录公布 todo.create 且支持 remindInMinutes 时，相对分钟直接使用该参数，由本机执行时解析；无需用户补当前日期或时区。',
      manageExisting:'本应用内的待办与定时提醒使用当前目录中的 todo 工具。todo.list 返回条目的真实 id；不能把列表序号、提醒 scheduleId 或标题冒充条目 id。用户要求取消整个待办时，使用 todo.update 的原 id 和 status=cancelled；只要求取消提醒时，使用原 id 和 clearReminder=true，保留待办。当前没有物理删除工具，不把取消回执说成记录已永久删除。前文已经唯一指定编号、下一轮只说“确认删除”时承接该编号和原动作，不重复索要编号；若编号未在可读上下文中出现，则先按当前目录读取，多个候选才请用户选定。操作仍需原宿主授权，只有实际回执能证明取消成功。',
    }] : [];
    const calendar = readCalendarState(scope);
    if(calendar?.registered === true) capabilityGuidance.push({capability:'calendar',
      state:calendar.configured === true ? 'check_task_catalog' : 'configuration_required',callable:false,
      guidance:calendar.configured === true
        ? '日历已有本机配置；这不证明账号连接、写入或出机已获许可。按当前任务工具目录和原授权提问卡处理，不能自动创建事件。'
        : '日历工具已装配，但尚缺有效的 CalDAV 账号配置。请用户在设置→连接→CalDAV 日历配置填写本人已有配置；不要索取聊天中的密码，授权提问卡不能替代账号配置。',
    });
    return JSON.stringify({source:'trusted_desktop_environment', time, interpretation:interpretationRules, capabilityGuidance});
  };
}

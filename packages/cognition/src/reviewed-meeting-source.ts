// MOD-28 P5 Calendar：可信来源版本 → 已提交 Fact ref 的生产绑定口。
// 依据 docs/modules/MOD-28-REVIEWED-REPAIR-01.md「默认 P5 会议链与可信来源交接」：
// 核心认知需要的 `readSourceRevision(event, context)` 生产实现此前只有工厂导出、没有组合。
// 本适配器把（Potato 日历侧的）受信 confirmed 读、同 namespace 当前 Fact 与
// createCommittedMeetingProjectionReader（completed projection 读回）串成一条链；
// 错来源、错版本（sequence 漂移）、缺 `[sourceRevision: sequence]` 标记、摘要不一致、
// Fact 缺失/非 active 全部返回 undefined（fail-closed，回到 requires_review），绝不猜文本。
import {CognitionError} from './impact.js';
import type {MeetingRescheduleEvent} from './meeting-decision.js';
import type {MeetingReviewContext} from './reviewed-meeting.js';

const text = (value: unknown): value is string => typeof value === 'string' && !!value.trim();

/** 受信日历 confirmed 读的绑定结果。由日历宿主（calendar-meeting-host 一侧）注入：
 *  必须来自同一可信配置下 succeeded+confirmed 的单条读取；UID/sequence/UTC 时间的
 *  两次独立读核验（交接验收顺序第 1 步）由提供方完成，本适配器不再复验原始读任务。 */
export interface TrustedCalendarConfirmedRead {
  /** 与 Fact.sourceRef 同源的来源标识（calendarMeetingSourceRef(accountRef, externalId)）。 */
  readonly source: string;
  /** 日历条目 sequence（十进制安全整数字符串）；对应 Fact reason 的 `[sourceRevision: …]` 标记。 */
  readonly sequence: string;
  readonly externalId: string;
  readonly accountRef: string;
  /** 本次 confirmed 读的原始 Evidence 引用，非空。 */
  readonly evidenceRefs: readonly string[];
  /** confirmed 读回的当前条目摘要（新值）。 */
  readonly currentSummary: string;
  /** 读回时间（ISO）；不得晚于当前时钟。 */
  readonly fetchedAt: string;
}

/** 同 namespace 的当前 Fact 读回（kind='fact'、state='active'）。 */
export interface MeetingFactCurrent {
  readonly id: string;
  readonly revision: number;
  readonly sourceRef: string;
  readonly summary: string;
  readonly state: string;
  readonly kind: string;
  /** Graph 节点 reason；必须携带精确 `[sourceRevision: sequence]` 标记（交接文档来源顺序要求）。 */
  readonly reason?: string;
}

export interface TrustedMeetingSourceRevisionReaderOptions {
  readonly namespace: string;
  /** 日历侧受信 confirmed 读（错 UID/NOT_FOUND/取消/同版本读回由提供方按交接文档分别处理）。 */
  readConfirmedCalendarEvent(event: MeetingRescheduleEvent, context: MeetingReviewContext):
    Promise<TrustedCalendarConfirmedRead | undefined>;
  /** 当前 Fact 读回；只读同 namespace，不做任何写。 */
  readMeetingFact(meetingFactId: string, context: MeetingReviewContext): Promise<MeetingFactCurrent | undefined>;
  now?(): number;
}

/**
 * 生产 `readSourceRevision`：供 createCommittedMeetingProjectionReader 组合注入。
 * 返回 undefined = 当前来源/Fact 无法建立可信绑定（P5 保持 requires_review，不启动修复、不写 Graph）。
 */
export function createTrustedMeetingSourceRevisionReader(options: TrustedMeetingSourceRevisionReaderOptions) {
  if (!text(options?.namespace) || typeof options?.readConfirmedCalendarEvent !== 'function'
    || typeof options?.readMeetingFact !== 'function') {
    throw new CognitionError('INVALID_ARGUMENT');
  }
  const now = options.now ?? (() => Date.now());
  return async (event: MeetingRescheduleEvent, context: MeetingReviewContext): Promise<{
    source: string; sourceRevision: string; meetingFact: {id: string; revision: number};
  } | undefined> => {
    const read = await options.readConfirmedCalendarEvent(event, context);
    // 无受信读回：明确不可用，不回退到事件文本
    if (!read) return undefined;
    if (!text(read.source) || !text(read.sequence) || !/^(0|[1-9]\d*)$/.test(read.sequence)
      || !Number.isSafeInteger(Number(read.sequence))) return undefined;
    if (!Array.isArray(read.evidenceRefs) || read.evidenceRefs.length === 0 || !read.evidenceRefs.every(text)) return undefined;
    if (!text(read.currentSummary) || !text(read.fetchedAt) || !Number.isFinite(Date.parse(read.fetchedAt))
      || Date.parse(read.fetchedAt) > now()) return undefined;
    // 来源必须与事件声明一致；sequence 漂移（事件观测后日历又变了）→ 版本不匹配，交回上层重探
    if (read.source !== event.source || read.sequence !== event.sourceRevision) return undefined;
    const fact = await options.readMeetingFact(event.meetingFactId, context);
    if (!fact || fact.kind !== 'fact' || fact.state !== 'active') return undefined;
    if (fact.sourceRef !== read.source || fact.summary !== read.currentSummary || fact.summary !== event.newSummary) return undefined;
    // 来源顺序约束（交接文档）：Fact 的 reason 必须带本 sequence 的精确标记——
    // 缺标记意味着消费顺序错乱（旧 baseline 未被核验或通用投影冒充 Calendar 标记）。
    const marker = /\[sourceRevision:\s*([^\]]+)\]/.exec(fact.reason ?? '')?.[1]?.trim();
    if (marker !== read.sequence) return undefined;
    return {source: read.source, sourceRevision: read.sequence, meetingFact: {id: fact.id, revision: fact.revision}};
  };
}

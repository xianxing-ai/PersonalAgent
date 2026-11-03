import {ProtocolError} from '@personal-agent/contracts';
import {assertPolicyValid, quietHoursActive, type NotificationPolicy} from './policy.js';

export type DeveloperNoticeKind = 'gate' | 'failure' | 'success' | 'progress' | 'timeline';
export type DeveloperNoticeClass = 'interrupt' | 'digest' | 'silent';

export interface DeveloperNotice {
  id: string;
  repo: string;
  kind: DeveloperNoticeKind;
  summary: string;
  at: string;
  evidenceRef?: string;
}

export interface DeveloperSubscription {
  repo: string;
  classes: readonly DeveloperNoticeClass[];
}

export interface DeveloperTimelineEntry {
  id: string;
  at: string;
  repo: string;
  class: DeveloperNoticeClass;
  summary: string;
  delivered: boolean;
  channel: 'desktop' | 'timeline' | 'digest';
  evidenceRef?: string;
  reason: string;
}

export interface DeveloperDigestLimits {
  perHour: number;
  perDay: number;
}

export interface DeveloperDeliveryState {
  subscriptions: DeveloperSubscription[];
  timeline: DeveloperTimelineEntry[];
  digest: DeveloperNotice[];
  lastDigestAt?: number;
  digestSends?: {hourBucket: string; hourCount: number; dayBucket: string; dayCount: number};
  digestLimits?: DeveloperDigestLimits;
}

export interface DesktopNoticeChannel {
  name: 'desktop';
  send(notice: {id: string; title: string; body: string}): Promise<{accepted: boolean; evidenceRef?: string; reason?: string}>;
}

const fail = (message: string): never => {throw new ProtocolError('INVALID_ARGUMENT', message);};

export function defaultNoticeClass(kind: DeveloperNoticeKind): DeveloperNoticeClass {
  if (kind === 'gate' || kind === 'failure' || kind === 'success') return 'interrupt';
  if (kind === 'progress') return 'digest';
  return 'silent';
}

export function emptyDeveloperDelivery(): DeveloperDeliveryState {
  return {subscriptions: [], timeline: [], digest: []};
}

export function setDeveloperSubscription(state: DeveloperDeliveryState, subscription: DeveloperSubscription): DeveloperDeliveryState {
  if (!subscription.repo.trim() || subscription.classes.some(item => !['interrupt', 'digest', 'silent'].includes(item))) fail('Subscription is invalid');
  return {...state, subscriptions: [...state.subscriptions.filter(item => item.repo !== subscription.repo), {repo: subscription.repo, classes: [...subscription.classes]}]};
}

export function setDeveloperDigestLimits(state: DeveloperDeliveryState, limits: DeveloperDigestLimits): DeveloperDeliveryState {
  if (!Number.isInteger(limits.perHour) || limits.perHour < 1 || limits.perHour > 24) fail('Hourly digest limit is invalid');
  if (!Number.isInteger(limits.perDay) || limits.perDay < limits.perHour || limits.perDay > 100) fail('Daily digest limit is invalid');
  return {...state, digestLimits: {perHour: limits.perHour, perDay: limits.perDay}};
}

function subscribed(state: DeveloperDeliveryState, repo: string, noticeClass: DeveloperNoticeClass): boolean {
  const match = state.subscriptions.find(item => item.repo === repo);
  if (!match) return noticeClass === 'interrupt';
  return match.classes.includes(noticeClass);
}

function entry(notice: DeveloperNotice, noticeClass: DeveloperNoticeClass, delivered: boolean, channel: DeveloperTimelineEntry['channel'], reason: string, evidenceRef?: string): DeveloperTimelineEntry {
  return {id: notice.id, at: notice.at, repo: notice.repo, class: noticeClass, summary: notice.summary, delivered, channel, reason, ...(evidenceRef ? {evidenceRef} : {})};
}

/** 打断类走桌面通道；通道接受后时间线记 delivered。静默只进时间线。 */
export async function acceptDeveloperNotice(state: DeveloperDeliveryState, notice: DeveloperNotice, options: {now: number; policy?: NotificationPolicy; channel: DesktopNoticeChannel}): Promise<{state: DeveloperDeliveryState; delivered: boolean; class: DeveloperNoticeClass}> {
  if (!notice.id.trim() || !notice.repo.trim() || !notice.summary.trim()) fail('Notice is invalid');
  if (state.timeline.some(item => item.id === notice.id)) return {state, delivered: state.timeline.find(item => item.id === notice.id)?.delivered === true, class: state.timeline.find(item => item.id === notice.id)?.class ?? 'silent'};
  if (options.policy) assertPolicyValid(options.policy);
  const noticeClass = defaultNoticeClass(notice.kind);
  if (!subscribed(state, notice.repo, noticeClass)) {
    const timeline = [...state.timeline, entry(notice, noticeClass, false, 'timeline', 'subscription does not include this class')];
    return {state: {...state, timeline}, delivered: false, class: noticeClass};
  }
  if (noticeClass === 'silent') {
    return {state: {...state, timeline: [...state.timeline, entry(notice, noticeClass, false, 'timeline', 'silent notices stay on the timeline')]}, delivered: false, class: noticeClass};
  }
  const quiet = options.policy?.quietHours && quietHoursActive(options.policy.quietHours, options.now);
  const paused = options.policy?.pauseUntilUtc !== undefined && Date.parse(options.policy.pauseUntilUtc) > options.now;
  if (noticeClass === 'digest' || (quiet || paused) && notice.kind !== 'gate') {
    return {state: {...state, digest: [...state.digest, notice], timeline: [...state.timeline, entry(notice, 'digest', false, 'digest', quiet || paused ? 'held for quiet hours' : 'held for the digest')]}, delivered: false, class: 'digest'};
  }
  const result = await options.channel.send({id: notice.id, title: notice.kind === 'gate' ? '需要你确认' : '开发者任务', body: notice.summary});
  const delivered = result.accepted === true;
  const evidenceRef = result.evidenceRef ?? notice.evidenceRef;
  return {state: {...state, timeline: [...state.timeline, entry(notice, noticeClass, delivered, 'desktop', delivered ? 'desktop channel accepted' : result.reason ?? 'desktop channel declined', evidenceRef)]}, delivered, class: noticeClass};
}

export async function flushDeveloperDigest(state: DeveloperDeliveryState, options: {now: number; channel: DesktopNoticeChannel; summary: string}): Promise<{state: DeveloperDeliveryState; delivered: boolean}> {
  if (!state.digest.length) return {state, delivered: false};
  const id = `digest:${options.now}`;
  const notice: DeveloperNotice = {id, repo: state.digest[0]?.repo ?? 'digest', kind: 'progress', summary: options.summary, at: new Date(options.now).toISOString()};
  const result = await options.channel.send({id, title: '开发者摘要', body: options.summary});
  const delivered = result.accepted === true;
  return {state: {...state, digest: [], timeline: [...state.timeline, entry(notice, 'digest', delivered, 'desktop', delivered ? 'digest delivered' : 'digest channel declined', result.evidenceRef)]}, delivered};
}

/** 摘要默认一小时最多一条，一天不超过配置上限。窗口没到就留在 digest 里。 */
export async function considerDeveloperDigest(state: DeveloperDeliveryState, options: {now: number; channel: DesktopNoticeChannel; summary?: string; minIntervalMs?: number}): Promise<{state: DeveloperDeliveryState; delivered: boolean; reason: string}> {
  if (!state.digest.length) return {state, delivered: false, reason: 'digest is empty'};
  const limits = state.digestLimits ?? {perHour: 1, perDay: 24};
  const hourBucket = new Date(options.now).toISOString().slice(0, 13);
  const dayBucket = new Date(options.now).toISOString().slice(0, 10);
  const hourCount = state.digestSends?.hourBucket === hourBucket ? state.digestSends.hourCount : 0;
  const dayCount = state.digestSends?.dayBucket === dayBucket ? state.digestSends.dayCount : 0;
  const interval = options.minIntervalMs ?? 3_600_000;
  if (state.lastDigestAt !== undefined && options.now - state.lastDigestAt < interval) return {state, delivered: false, reason: 'digest is inside the hourly window'};
  if (hourCount >= limits.perHour) return {state, delivered: false, reason: 'hourly digest limit reached'};
  if (dayCount >= limits.perDay) return {state, delivered: false, reason: 'daily digest limit reached'};
  const summary = options.summary ?? state.digest.map(item => item.summary).join('；').slice(0, 500);
  const flushed = await flushDeveloperDigest(state, {now: options.now, channel: options.channel, summary});
  return {state: {...flushed.state, lastDigestAt: options.now, digestLimits: limits, digestSends: {hourBucket, hourCount: hourCount + 1, dayBucket, dayCount: dayCount + 1}}, delivered: flushed.delivered, reason: flushed.delivered ? 'digest delivered' : 'digest channel declined'};
}

export interface ElectronNotificationPort {
  isSupported?: () => boolean;
  create(input: {title: string; body: string}): {show?: () => void};
}

/** 不导入 electron。调用方把 Notification 构造能力注进来。 */
export function deliverElectronNotification(notice: {id: string; title: string; body: string}, port: ElectronNotificationPort | undefined): {accepted: boolean; evidenceRef?: string; reason?: string} {
  if (!notice.id.trim() || !notice.title.trim()) fail('Notice is invalid');
  if (!port || port.isSupported?.() === false) return {accepted: false, reason: 'desktop notification unsupported'};
  const created = port.create({title: notice.title, body: notice.body});
  if (typeof created.show === 'function') created.show();
  return {accepted: true, evidenceRef: `desktop:${notice.id}`};
}

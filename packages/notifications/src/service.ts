import { ProtocolError } from '@personal-agent/contracts';
import type { StoragePort, ProtocolContracts } from '@personal-agent/contracts';
import { nextQuietEndMs, quietHoursActive } from './policy.js';
import type { NotificationPolicy } from './policy.js';
import {assertInterruptionState,beginNotificationDelivery,completeNotificationDelivery,emptyInterruptionState,feedEntryActive,
  interruptionBlock,markNotificationFeed,notificationDigest,notificationScopeKey,queryNotificationFeed,reserveNotificationRound,
  resolveInterruptionPolicy,updateNotificationPolicy,validUtc,assertLegacyNotificationPolicy,scopedLegacyPolicies,updateLegacyNotificationPolicy} from './interruption.js';
import type {NotificationAtomicStatePort,NotificationChannel,NotificationFeedQuery,NotificationIngestContext,
  NotificationInterruptionState,NotificationScope,NotificationStage,InterruptionPolicyUpdate,InterruptionReservation,LegacyNotificationPolicyUpdate} from './interruption.js';

type ConnectorItem = ProtocolContracts['connectorItem'];

/** 待裁定事件的持久化形态：原始条目＋到达时刻＋去重键。 */
export interface PendingItem {
  dedupeKey: string;
  source: string;
  receivedAt: string;
  item: ConnectorItem;
}

/** 一次裁定产出：要么立即条目，要么摘要请求。条目引用的是 dedupeKey，不复制内容。 */
export interface NotificationBatch {
  id: string;
  kind: 'immediate' | 'digest';
  itemRefs: string[];
  decidedAt: string;
  heldSince: string;
  reason: string;
  /**
   * 批次生命周期：裁定即 ready_for_delivery（持久化，等待桌面取走）；桌面确认接收后
   * acknowledge() 置 delivered。drain 不会删除未确认批次——崩溃重启后原样取回。
   */
  state: 'ready_for_delivery' | 'delivered';
  /** Written only after the trusted delivery consumer acknowledges its receipt. */
  deliveredAt?: string;
}

export interface DrainReport {
  batches: NotificationBatch[];
  held: {quiet: number; paused: number; digest: number;silent?:number};
}

export interface StatusReport {
  pausedUntil: string | null;
  quietUntil: string | null;
  pending: number;
  nextDigestCloseAt: string | null;
  /** 已裁定但桌面尚未确认接收的批次数（崩溃重启后这些批次会被再次返回）。 */
  unacknowledgedBatches: number;
  interruptionQuotaSafety:'atomic'|'unavailable';
}

export interface NotificationServiceOptions {
  now: () => number;
  idFactory: () => string;
  atomicState?:NotificationAtomicStatePort;
  onStage?:(event:NotificationStage)=>void;
}

/**
 * 全部通知状态的持久化形态，存于**单一存储键**。
 *
 * 原子性（goo122 2026-09-09 复审 P1）：pending 消费、去重标记与批次创建曾写三个键，
 * 写入间隙注入异常会永久丢失通知（重放又被去重拒绝）。现在每次变更都在内存中算出
 * 完整新状态并**一次写入**——存储层崩溃要么完全应用新状态，要么保留旧状态，
 * 不存在「事件被标记已裁但批次未落盘」的窗口。宿主若提供真实事务型存储，
 * 可在 writeState 处替换为事务提交，语义不变。
 */
interface NotificationState {
  pending: PendingItem[];
  batches: NotificationBatch[];
  /** 已交付 dedupeKey 的有界 FIFO（去重窗口），淘汰由宿主按 dedupeKey 吸收。 */
  delivered: string[];
  /** Changes whenever persisted notification state changes, keeping paged batch snapshots consistent. */
  snapshotRevision: number;
  /** Display/unread history, policies and round receipts extend the original state, not pending queues. */
  interruption?:NotificationInterruptionState;
}

const STATE_KEY = 'notifications:state';
/** 已确认批次的保留上限：只作幂等记录，超限淘汰最旧。 */
const DELIVERED_BATCH_LIMIT = 100;
/** 已交付 dedupeKey 的窗口上限。 */
const DELIVERED_KEY_LIMIT = 500;

/**
 * 版本化批次事件（F12 消费端口）：通知域对镜像/云端节点公布的最小投影。
 * 条目只引用 dedupeKey，不复制连接器内容；本类型是数据，不是投递确认。
 */
export interface NotificationBatchEvent {
  eventVersion: 1;
  batchId: string;
  kind: 'immediate' | 'digest';
  itemRefs: readonly string[];
  decidedAt: string;
  heldSince: string;
  reason: string;
  state: 'ready_for_delivery' | 'delivered';
  deliveredAt?: string;
}

export interface NotificationBatchEventsPage {
  eventVersion: 1;
  /** Persisted-state revision for all pages in one consistent snapshot. */
  snapshotRevision: number;
  /** `changed` 要求从第一页重读；`compacted` 表示游标早于已确认批次保留窗口。 */
  cursorState: 'current' | 'compacted' | 'changed';
  events: readonly NotificationBatchEvent[];
  nextCursor: string | null;
  retained: {readyForDelivery: number; delivered: number};
}

/**
 * 通知汇总策略（MOD-23）：只做裁定，不调度、不展示。
 * 宿主按 Runtime 调度调用 drain：安静结束/摘要窗口关闭时（见 planSchedules 的建议），
 * 或任意时刻调用（幂等，无产出时返回空）。去重按 dedupeKey——同一事件重复投递只裁一次。
 */
export class NotificationService {
  private readonly policy: NotificationPolicy;
  private readonly stateRevisions=new WeakMap<object,number|undefined>();

  constructor(
    private readonly storage: StoragePort,
    policy: NotificationPolicy,
    private readonly options: NotificationServiceOptions,
  ) {
    if (!storage) throw new ProtocolError('INVALID_ARGUMENT', 'Notification storage must be explicitly provided');
    if (!policy || typeof policy !== 'object') throw new ProtocolError('INVALID_ARGUMENT', 'Notification policy must be provided');
    this.policy = structuredClone(policy);
  }

  /** 接收标准事件。重复 dedupeKey 静默忽略（计数披露在返回值）。单次状态写入，原子。 */
  ingest(items: readonly ConnectorItem[],context:NotificationIngestContext={}): {accepted: number; duplicates: number} {
    const state = this.readState();
    const extension=this.extension(state),now=this.options.now();
    if(context.scope)notificationScopeKey(context.scope);
    if(context.validUntilUtc!==undefined&&context.validUntilUtc!==null&&!validUtc(context.validUntilUtc)
      ||context.urgent!==undefined&&typeof context.urgent!=='boolean'
      ||context.supersedes!==undefined&&(!Array.isArray(context.supersedes)||context.supersedes.some(id=>typeof id!=='string'||!id)))
      throw new ProtocolError('INVALID_ARGUMENT','Invalid trusted notification ingest metadata');
    // Outstanding batches pin their keys independently of the bounded history
    // window. Reconstruct from stored batches; no second dedupe store is needed.
    const unacknowledgedKeys = new Set(state.batches
      .filter(batch => batch.state === 'ready_for_delivery')
      .flatMap(batch => batch.itemRefs));
    let accepted = 0;
    let duplicates = 0;
    let restored = 0;
    const appendFeed=(item:ConnectorItem)=>extension.feed.push({id:item.dedupeKey,cursor:extension.nextCursor++,source:item.source,contentRef:item.contentRef,
      occurredAt:item.occurredAt,receivedAt:new Date(now).toISOString(),scope:structuredClone(context.scope??{kind:'connector',connectorId:item.source}),
      validUntilUtc:context.validUntilUtc??null,urgent:context.urgent===true});
    for (const item of items) {
      if (!item || typeof item !== 'object' || typeof item.dedupeKey !== 'string' || item.dedupeKey.length === 0) {
        throw new ProtocolError('INVALID_ARGUMENT', 'Ingested items must be ConnectorItems with a dedupeKey');
      }
      if (extension.feed.some(entry=>entry.id===item.dedupeKey)||unacknowledgedKeys.has(item.dedupeKey) || state.delivered.includes(item.dedupeKey)
        || state.pending.some(existing => existing.dedupeKey === item.dedupeKey)) {
        // Old ready batches retained only item IDs. Recover display metadata from the actual
        // source replay, without enqueueing it twice or inventing missing historical content.
        if(unacknowledgedKeys.has(item.dedupeKey)&&!extension.feed.some(entry=>entry.id===item.dedupeKey)) {appendFeed(item);restored++;}
        duplicates += 1;
        continue;
      }
      state.pending.push({dedupeKey: item.dedupeKey, source: item.source, receivedAt: this.isoNow(), item: structuredClone(item)});
      appendFeed(item);
      accepted += 1;
    }
    if (accepted > 0||restored>0) {
      for(const id of context.supersedes??[]){const prior=extension.feed.find(entry=>entry.id===id);if(prior)prior.withdrawnAt??=new Date(now).toISOString();}
      this.writeState(state);this.stage('notification_ingested_to_feed',{accepted,duplicates,restored});
    }
    return {accepted, duplicates};
  }

  /**
   * 裁定并交付。暂停与安静时段 hold 一切（含摘要）；聚合来源等窗口关闭或达上限。
   * 全部状态变更（消费 pending、标记 delivered、创建批次）在**一次状态写入**中生效：
   * 确认前批次保持 `ready_for_delivery`，崩溃重启后原样取回，不重复生成。
   */
  drain(): DrainReport {
    const now = this.options.now();
    const nowIso = this.isoNow();
    const state = this.readState();
    const held: DrainReport['held'] = {quiet: 0, paused: 0, digest: 0};
    const extension=this.extension(state);
    const suppressed=(key:string):boolean=>{
      const entry=extension.feed.find(item=>item.id===key);
      if(!entry)return false; // Legacy batches retain their original readback identity.
      if(!feedEntryActive(entry,now)||entry.readAt)return true;
      return !!interruptionBlock(extension,entry.scope,now,entry.urgent)&&!!extension.policies.global;
    };
    const deliver: PendingItem[] = [];
    const digestPool: PendingItem[] = [];
    const digestGroups=new Map<string,{items:PendingItem[];digest:NonNullable<NotificationPolicy['digest']>}>();
    const keep: PendingItem[] = [];

    for (const entry of state.pending) {
      if(suppressed(entry.dedupeKey)) {
        const feed=extension.feed.find(item=>item.id===entry.dedupeKey);
        if(feed&&feedEntryActive(feed,now)&&!feed.readAt)keep.push(entry);
        held.silent=(held.silent??0)+1;continue;
      }
      const policies=this.legacyPolicies(state,entry.dedupeKey,entry.source);
      if (policies.some(policy=>policy.pauseUntilUtc!==undefined&&Date.parse(policy.pauseUntilUtc)>now)) {
        held.paused += 1;
        keep.push(entry);
        continue;
      }
      const digest=policies.findLast(policy=>policy.digest&&(policy.digest.sources===undefined||policy.digest.sources.includes(entry.source)))?.digest;
      if (digest) {
        digestPool.push(entry);
        const scoped=!!extension.policies.global||!!Object.keys(extension.legacyPolicies??{}).length;
        const key=notificationDigest([scoped?this.scopeOf(state,entry.dedupeKey,entry.source):null,digest]);
        const group=digestGroups.get(key)??{items:[],digest};group.items.push(entry);digestGroups.set(key,group);
        continue;
      }
      if (policies.some(policy=>policy.quietHours!==undefined&&quietHoursActive(policy.quietHours,now))) {
        held.quiet += 1;
        keep.push(entry);
        continue;
      }
      deliver.push(entry);
    }

    const decided: NotificationBatch[] = [];
    // Scoped proactive rounds cannot reserve a batch containing another scope's
    // items. Keep historical batching until an explicit global policy exists.
    const groups = (items:PendingItem[]):PendingItem[][] => {
      if (!extension.policies.global&&!Object.keys(extension.legacyPolicies??{}).length) return items.length ? [items] : [];
      const scoped = new Map<string,PendingItem[]>();
      for (const item of items) {
        const entry = extension.feed.find(value=>value.id===item.dedupeKey);
        const key = notificationScopeKey(entry?.scope??{kind:'connector',connectorId:item.source});
        const group = scoped.get(key)??[];group.push(item);scoped.set(key,group);
      }
      return [...scoped.values()];
    };
    for (const group of groups(deliver)) {
      decided.push({
        id: this.options.idFactory(),
        kind: 'immediate',
        itemRefs: group.map(entry => entry.dedupeKey),
        decidedAt: nowIso,
        heldSince: earliest(group),
        reason: 'immediate',
        state: 'ready_for_delivery',
      });
    }

    for (const {items:pool,digest} of digestGroups.values()) {
      const windowClosesAt = Math.min(...pool.map(entry => Date.parse(entry.receivedAt))) + digest.windowMs;
      const flushes = pool.length >= digest.maxItems;
      const windowElapsed = windowClosesAt <= now;
      // 摘要交付同样尊重安静时段：窗口到了但在安静期，继续持有并披露。
      const quietNow = pool.some(entry=>this.legacyPolicies(state,entry.dedupeKey,entry.source)
        .some(policy=>policy.quietHours!==undefined&&quietHoursActive(policy.quietHours,now)));
      if ((flushes || windowElapsed) && !quietNow) {
        for (const group of groups(pool)) decided.push({
          id: this.options.idFactory(),
          kind: 'digest',
          itemRefs: group.map(entry => entry.dedupeKey),
          decidedAt: nowIso,
          heldSince: earliest(group),
          reason: flushes ? 'digest_max_items' : 'digest_window_closed',
          state: 'ready_for_delivery',
        });
      } else {
        held.digest += pool.length;
        keep.push(...pool);
      }
    }

    // 单次原子写入：消费的条目移出 pending、进入 delivered 窗口与批次列表；失败则整体不生效。
    const nextState: NotificationState = {
      ...state,
      pending: keep,
      batches: trimBatches([...state.batches, ...decided]),
      delivered: [...state.delivered, ...deliver.map(entry => entry.dedupeKey), ...flushedKeys(digestPool, decided)].slice(-DELIVERED_KEY_LIMIT),
    };
    if (decided.length > 0||keep.length!==state.pending.length) this.writeState(nextState,state);

    // 恢复语义优先：未确认批次排在本次新裁定之前返回；不重复生成（id 不变）。
    // 输出边界深拷贝：调用方改动返回批次不得影响存储内的状态（返回对象可能携带内部引用）。
    const outstanding = state.batches.filter(batch => batch.state === 'ready_for_delivery'&&!batch.itemRefs.some(suppressed));
    const prior:NotificationBatch[]=[];
    for(const batch of outstanding) {
      const policies=batch.itemRefs.flatMap(id=>this.legacyPolicies(state,id));
      if(policies.some(policy=>policy.pauseUntilUtc!==undefined&&Date.parse(policy.pauseUntilUtc)>now))held.paused+=batch.itemRefs.length;
      else if(policies.some(policy=>policy.quietHours!==undefined&&quietHoursActive(policy.quietHours,now)))held.quiet+=batch.itemRefs.length;
      else if(this.legacyDigestBlocked(state,batch.itemRefs,now,batch.heldSince))held.digest+=batch.itemRefs.length;
      else prior.push(batch);
    }
    if(held.silent)this.stage('silent_notifications_retained_in_feed',{count:held.silent});
    return {batches: structuredClone([...prior, ...decided]), held};
  }

  /** 桌面确认接收一个批次：置 delivered（幂等，重复确认无副作用）。单次写入，原子。 */
  acknowledge(batchId: string): NotificationBatch {
    if (typeof batchId !== 'string' || batchId.length === 0) {
      throw new ProtocolError('INVALID_ARGUMENT', 'batchId must be a non-empty string');
    }
    const state = this.readState();
    const target = state.batches.find(batch => batch.id === batchId);
    if (target === undefined) throw new ProtocolError('NOT_FOUND', `No notification batch ${batchId}`);
    if (target.state === 'ready_for_delivery') {
      target.state = 'delivered';
      target.deliveredAt = this.isoNow();
      for(const entry of state.interruption?.feed??[])if(target.itemRefs.includes(entry.id))entry.deliveredAt??=target.deliveredAt;
      this.writeState({...state, batches: trimBatches(state.batches)},state);
    }
    return structuredClone(target);
  }

  status(scope?:NotificationScope): StatusReport {
    const now = this.options.now();
    const state = this.readState();
    if(scope)notificationScopeKey(scope);
    const policies=[this.policy,...(scope?scopedLegacyPolicies(this.extension(state),scope):[])];
    const quietEnds=policies.flatMap(policy=>policy.quietHours?[nextQuietEndMs(policy.quietHours,now)].filter((value):value is number=>value!==null):[]);
    const quietEnd=quietEnds.length?Math.max(...quietEnds):null;
    const pauses=policies.flatMap(policy=>policy.pauseUntilUtc&&Date.parse(policy.pauseUntilUtc)>now?[policy.pauseUntilUtc]:[])
      .sort((a,b)=>Date.parse(a)-Date.parse(b));
    const pending=state.pending.filter(entry=>!scope||notificationScopeKey(this.scopeOf(state,entry.dedupeKey,entry.source))===notificationScopeKey(scope));
    let nextDigest: number | null = null;
    for(const entry of pending) {
      const digest=this.legacyPolicies(state,entry.dedupeKey,entry.source)
        .findLast(policy=>policy.digest&&(policy.digest.sources===undefined||policy.digest.sources.includes(entry.source)))?.digest;
      if(digest){const end=Date.parse(entry.receivedAt)+digest.windowMs;nextDigest=nextDigest===null?end:Math.min(nextDigest,end);}
    }
    const report: StatusReport = {
      pausedUntil: pauses.at(-1)??null,
      quietUntil: quietEnd === null ? null : isoInstant(quietEnd),
      pending: pending.length,
      nextDigestCloseAt: nextDigest === null ? null : isoInstant(nextDigest),
      unacknowledgedBatches: state.batches.filter(batch => batch.state === 'ready_for_delivery'&&(!scope
        ||batch.itemRefs.some(id=>notificationScopeKey(this.scopeOf(state,id))===notificationScopeKey(scope)))).length,
      interruptionQuotaSafety:this.options.atomicState?'atomic':'unavailable',
    };
    return report;
  }

  /** 结构兼容 Runtime `ScheduleInput` 的调度建议：安静结束与摘要窗口关闭各一条，错过即补跑一次。 */
  planSchedules(conversationId: string): {scheduleId: string; goal: string; conversationId: string; runAt: string; timeZone: string; missedRunPolicy: 'run_once'; taskIdempotencyKey: string}[] {
    const now = this.options.now();
    const plans: {scheduleId: string; goal: string; conversationId: string; runAt: string; timeZone: string; missedRunPolicy: 'run_once'; taskIdempotencyKey: string}[] = [];
    const quietEnd = this.policy.quietHours === undefined ? null : nextQuietEndMs(this.policy.quietHours, now);
    if (quietEnd !== null) {
      plans.push({
        scheduleId: `notifications:quiet-end:${isoInstant(quietEnd)}`,
        goal: '安静时段结束，裁定被持有的通知',
        conversationId,
        runAt: isoInstant(quietEnd),
        timeZone: 'UTC',
        missedRunPolicy: 'run_once',
        taskIdempotencyKey: `notifications:quiet-end:${isoInstant(quietEnd)}`,
      });
    }
    const status = this.status();
    if (status.pausedUntil !== null && (status.pending > 0 || status.unacknowledgedBatches > 0)) {
      plans.push({
        scheduleId: `notifications:pause-end:${status.pausedUntil}`,
        goal: '通知暂停结束，重新裁定待投递通知',
        conversationId, runAt: status.pausedUntil, timeZone: 'UTC',
        missedRunPolicy: 'run_once', taskIdempotencyKey: `notifications:pause-end:${status.pausedUntil}`,
      });
    }
    if (status.nextDigestCloseAt !== null) {
      plans.push({
        scheduleId: `notifications:digest:${status.nextDigestCloseAt}`,
        goal: '聚合窗口关闭，产出摘要请求',
        conversationId,
        runAt: status.nextDigestCloseAt,
        timeZone: 'UTC',
        missedRunPolicy: 'run_once',
        taskIdempotencyKey: `notifications:digest:${status.nextDigestCloseAt}`,
      });
    }
    if(status.pending>0||status.unacknowledgedBatches>0) {
      const state=this.readState();const ends=new Set(Object.values(this.extension(state).policies)
        .map(record=>record.patch.silentUntilUtc).filter((end):end is string=>typeof end==='string'&&Date.parse(end)>now));
      for(const end of ends)plans.push({scheduleId:`notifications:silence-end:${end}`,goal:'用户静默期限结束，重新核对最新通知策略',conversationId,
        runAt:end,timeZone:'UTC',missedRunPolicy:'run_once',taskIdempotencyKey:`notifications:silence-end:${end}`});
    }
    return plans;
  }

  private paused(now: number): boolean {
    return this.policy.pauseUntilUtc !== undefined && Date.parse(this.policy.pauseUntilUtc) > now;
  }

  private scopeOf(state:NotificationState,id:string,source?:string):NotificationScope {
    return this.extension(state).feed.find(entry=>entry.id===id)?.scope??(source?{kind:'connector',connectorId:source}:{kind:'global'});
  }
  private legacyPolicies(state:NotificationState,id:string,source?:string):NotificationPolicy[] {
    return [this.policy,...scopedLegacyPolicies(this.extension(state),this.scopeOf(state,id,source))];
  }
  private legacyDigestBlocked(state:NotificationState,ids:readonly string[],now:number,fallback?:string):boolean {
    const groups=new Map<string,{count:number;oldest:number;digest:NonNullable<NotificationPolicy['digest']>}>();
    for(const id of ids) {
      const feed=this.extension(state).feed.find(entry=>entry.id===id),source=feed?.source;
      const digest=this.legacyPolicies(state,id,source).findLast(policy=>policy.digest
        &&(policy.digest.sources===undefined||source!==undefined&&policy.digest.sources.includes(source)))?.digest;
      const receivedAt=feed?.receivedAt??fallback;if(!digest||!receivedAt)continue;
      const extension=this.extension(state),scoped=!!extension.policies.global||!!Object.keys(extension.legacyPolicies??{}).length;
      const key=notificationDigest([scoped?feed?.scope??null:null,digest]),group=groups.get(key)??{count:0,oldest:Date.parse(receivedAt),digest};
      group.count++;group.oldest=Math.min(group.oldest,Date.parse(receivedAt));groups.set(key,group);
    }
    return [...groups.values()].some(group=>group.count<group.digest.maxItems&&group.oldest+group.digest.windowMs>now);
  }

  private readState(): NotificationState {
    const cell=this.options.atomicState?.read(STATE_KEY);
    const value = this.options.atomicState?cell?.value:this.storage.get(STATE_KEY);
    if(cell&&(!Number.isSafeInteger(cell.revision)||cell.revision<0))throw new ProtocolError('PROTOCOL_MISMATCH','Invalid atomic notification state revision');
    if (value === undefined || value === null) {const empty={pending: [], batches: [], delivered: [], snapshotRevision:0};this.stateRevisions.set(empty,cell?.revision);return empty;}
    if (typeof value !== 'object' || Array.isArray(value)) throw new ProtocolError('PROTOCOL_MISMATCH','Notification state cannot be silently reset');
    const record = value as Record<string, unknown>;
    const snapshotRevision = record.snapshotRevision === undefined ? 0 : record.snapshotRevision;
    if (typeof snapshotRevision !== 'number' || !Number.isSafeInteger(snapshotRevision) || snapshotRevision < 0)
      throw new ProtocolError('PROTOCOL_MISMATCH','Invalid notification snapshot revision');
    const state: NotificationState = {
      snapshotRevision,
      pending: Array.isArray(record.pending) ? record.pending.filter(isPendingItem) : [],
      batches: Array.isArray(record.batches) ? record.batches.filter(isBatch) : [],
      delivered: Array.isArray(record.delivered) ? record.delivered.filter((key): key is string => typeof key === 'string').slice(-DELIVERED_KEY_LIMIT) : [],
      ...(record.interruption===undefined?{}:{interruption:record.interruption as NotificationInterruptionState}),
    };
    // 读边界整态深拷贝（goo122 2026-09-13 复审 P1）：StoragePort 不保证 get 返回副本，
    // 不拷贝则 acknowledge 对状态对象的就地修改会先于写入生效——写失败也"生效"了。
    if(state.interruption)assertInterruptionState(state.interruption);
    const detached=structuredClone(state);this.stateRevisions.set(detached,cell?.revision);return detached;
  }

  private writeState(state: NotificationState,original:NotificationState=state): void {
    if(state.snapshotRevision>=Number.MAX_SAFE_INTEGER)throw new ProtocolError('PROTOCOL_MISMATCH','Notification snapshot revision exhausted');
    const value={
      snapshotRevision:state.snapshotRevision+1,
      pending: state.pending,
      batches: trimBatches(state.batches),
      delivered: state.delivered.slice(-DELIVERED_KEY_LIMIT),
      ...(state.interruption?{interruption:state.interruption}:{}),
    };
    if(this.options.atomicState) {
      if(!this.stateRevisions.has(original))throw new ProtocolError('REVISION_CONFLICT','Original notification snapshot required');
      if(!this.options.atomicState.compareAndSet(STATE_KEY,this.stateRevisions.get(original),structuredClone(value)))
        throw new ProtocolError('REVISION_CONFLICT','Notification state changed; read original operation before retrying');
    } else this.storage.set(STATE_KEY,value);
  }

  private extension(state:NotificationState):NotificationInterruptionState {
    if(state.interruption)return state.interruption;
    const extension=emptyInterruptionState();
    // Only the original pending queue still contains full source metadata. Never fabricate
    // feed content for legacy batches whose original item has not been read back.
    for(const entry of state.pending)if(!extension.feed.some(item=>item.id===entry.dedupeKey))extension.feed.push({
      id:entry.dedupeKey,cursor:extension.nextCursor++,source:entry.source,contentRef:entry.item.contentRef,occurredAt:entry.item.occurredAt,
      receivedAt:entry.receivedAt,scope:{kind:'connector',connectorId:entry.source},validUntilUtc:null,urgent:false});
    state.interruption=extension;return extension;
  }
  private stage(stage:string,details:Record<string,unknown>):void {
    try{this.options.onStage?.({stage,observedAt:this.isoNow(),details:structuredClone(details)});}catch{/* telemetry never changes persisted outcome */}
  }
  private atomicMutation<T>(stage:string,run:(state:NotificationState,extension:NotificationInterruptionState)=>T):T {
    if(!this.options.atomicState)throw new ProtocolError('UNSUPPORTED_CAPABILITY','Atomic notification state port required; StoragePort is not a quota CAS');
    const state=this.readState(),extension=this.extension(state),before=notificationDigest(extension),result=run(state,extension);
    if(before!==notificationDigest(extension))this.writeState(state);
    this.stage(stage,{});return structuredClone(result);
  }

  getInterruptionPolicy(scope:NotificationScope) {const state=this.readState();return resolveInterruptionPolicy(this.extension(state),scope,this.options.now());}
  getLegacyPolicy(scope:NotificationScope) {
    const state=this.readState(),record=this.extension(state).legacyPolicies?.[notificationScopeKey(scope)];
    return {scope:structuredClone(scope),revision:record?.revision??0,policy:record?structuredClone(record.policy):null};
  }
  /** Trusted one-time import from the original host's saved policy; never overwrites newer CAS settings. */
  importLegacyPolicy(scope:NotificationScope,policy:NotificationPolicy) {
    const key=notificationScopeKey(scope);assertLegacyNotificationPolicy(policy);
    if(key==='global')throw new ProtocolError('INVALID_ARGUMENT','Legacy connector scope required');
    return this.atomicMutation('notification_legacy_policy_restored',(_state,extension)=>{
      const restored=structuredClone(policy),modern=extension.policies[key]?.patch;
      if(modern) {
        if(Object.hasOwn(modern,'mode')||Object.hasOwn(modern,'silentUntilUtc'))delete restored.pauseUntilUtc;
        if(Object.hasOwn(modern,'quietHours'))delete restored.quietHours;
        if(Object.hasOwn(modern,'digestMode'))delete restored.digest;
      }
      extension.legacyPolicies??={};extension.legacyPolicies[key]??={scope:structuredClone(scope),revision:1,policy:restored};
      return structuredClone(extension.legacyPolicies[key]);
    });
  }
  updateLegacyPolicy(input:LegacyNotificationPolicyUpdate) {
    return this.atomicMutation('notification_legacy_policy_updated',(_state,extension)=>updateLegacyNotificationPolicy(extension,structuredClone(input),this.options.now()));
  }
  updateInterruptionPolicy(input:InterruptionPolicyUpdate) {
    return this.atomicMutation('interruption_policy_updated',(_state,extension)=>updateNotificationPolicy(extension,structuredClone(input),this.options.now()));
  }
  notificationFeed(input:NotificationFeedQuery={}) {const state=this.readState();return queryNotificationFeed(this.extension(state),input,this.options.now());}
  acknowledgeRead(input:{operationId:string;itemIds:readonly string[]}) {
    return this.atomicMutation('notification_feed_read_ack',(_state,extension)=>markNotificationFeed(extension,input,this.options.now(),'read'));
  }
  withdrawNotifications(input:{operationId:string;itemIds:readonly string[]}) {
    return this.atomicMutation('notification_feed_withdrawn',(_state,extension)=>markNotificationFeed(extension,input,this.options.now(),'withdraw'));
  }
  /** Pure user-return/demand summary: no channel send and no interruption count. */
  getDigest(input:{trigger:'on_return'|'scheduled'|'on_demand';scope?:NotificationScope}) {
    if(!['on_return','scheduled','on_demand'].includes(input.trigger))throw new ProtocolError('INVALID_ARGUMENT','Explicit digest trigger required');
    const state=this.readState(),extension=this.extension(state),now=this.options.now();
    const queried=queryNotificationFeed(extension,{unreadOnly:true,...(input.scope?{scope:input.scope}:{})},now);
    const items=queried.items.filter(item=>item.validity==='active'&&(input.trigger==='on_demand'
      ||resolveInterruptionPolicy(extension,item.scope,now).effective?.digestMode===input.trigger));
    this.stage('notification_'+input.trigger+'_digest',{count:items.length});
    return {items,observedAt:this.isoNow(),interruptionCount:0};
  }
  reserveInterruption(input:InterruptionReservation) {
    return this.atomicMutation('interruption_quota_reserved',(state,extension)=>{
      const prior=extension.rounds[input.roundId];if(prior)return reserveNotificationRound(extension,structuredClone(input),prior.itemIds,this.options.now());
      const batches=input.batchIds.map(id=>{const batch=state.batches.find(b=>b.id===id);if(!batch)throw new ProtocolError('NOT_FOUND','Original notification batch not found');return batch;});
      const ids=[...new Set(batches.flatMap(batch=>batch.itemRefs))];
      if(input.urgent===true&&ids.some(id=>!extension.feed.find(entry=>entry.id===id)?.urgent))throw new ProtocolError('INVALID_ARGUMENT','Urgency must come from original trusted feed metadata');
      return reserveNotificationRound(extension,structuredClone(input),ids,this.options.now());
    });
  }
  beginDelivery(input:{roundId:string;channel:NotificationChannel}) {
    return this.atomicMutation('notification_before_send_policy_check',(state,extension)=>{
      const now=this.options.now();return beginNotificationDelivery(extension,input,now,this.paused(now)
        ||this.policy.quietHours!==undefined&&quietHoursActive(this.policy.quietHours,now)
        ||this.legacyDigestBlocked(state,extension.rounds[input.roundId]?.itemIds??[],now));
    });
  }
  completeDelivery(input:{roundId:string;channel:NotificationChannel;state:'delivered'|'unknown'|'failed';evidenceRefs:readonly string[]}) {
    return this.atomicMutation('notification_delivery_receipt',(state,extension)=>{
      const round=completeNotificationDelivery(extension,input,this.options.now());
      if(input.state==='delivered')for(const batch of state.batches)if(round.batchIds.includes(batch.id)) {
        batch.state='delivered';batch.deliveredAt??=this.isoNow();
      }
      return round;
    });
  }
  getInterruptionRound(roundId:string) {const state=this.readState();const round=this.extension(state).rounds[roundId];return round?structuredClone(round):undefined;}

  /**
   * 版本化批次事件读回（F12）。只读投影：不触发裁定（drain 归宿主调度点）、
   * 不代替受信桌面的 acknowledge；输出仅用于云端/镜像消费与重放对账。
   */
  readBatchEvents(input: {sinceBatchId?: string; snapshotRevision?: number; limit?: number} = {}): NotificationBatchEventsPage {
    const limit = input.limit ?? 20;
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100
      || (input.snapshotRevision !== undefined
        && (!Number.isSafeInteger(input.snapshotRevision) || input.snapshotRevision < 0))
      || (input.sinceBatchId !== undefined
        && (typeof input.sinceBatchId !== 'string' || !input.sinceBatchId.trim() || input.sinceBatchId.length > 128))) {
      throw new ProtocolError('INVALID_ARGUMENT', 'Notification event page request out of bounds');
    }
    if (input.sinceBatchId !== undefined && input.snapshotRevision === undefined)
      throw new ProtocolError('INVALID_ARGUMENT', 'Notification page cursor requires its snapshot revision');
    const state = this.readState();
    const ordered = [...state.batches].sort((left, right) =>
      left.decidedAt < right.decidedAt ? -1 : left.decidedAt > right.decidedAt ? 1
        : left.id < right.id ? -1 : left.id > right.id ? 1 : 0);
    const readyForDelivery = ordered.filter(batch => batch.state === 'ready_for_delivery').length;
    const retained = {readyForDelivery, delivered: ordered.length - readyForDelivery};
    if (input.snapshotRevision !== undefined && input.snapshotRevision !== state.snapshotRevision) {
      return {eventVersion: 1, snapshotRevision: state.snapshotRevision, cursorState: 'changed', events: [],
        nextCursor: null, retained};
    }
    let start = 0;
    let cursorState: 'current' | 'compacted' = 'current';
    if (input.sinceBatchId !== undefined) {
      const index = ordered.findIndex(batch => batch.id === input.sinceBatchId);
      if (index >= 0) start = index + 1;
      else cursorState = 'compacted';
    }
    const page = ordered.slice(start, start + limit);
    const last = page.at(-1);
    return {
      eventVersion: 1,
      snapshotRevision: state.snapshotRevision,
      cursorState,
      events: page.map(batch => ({eventVersion: 1, batchId: batch.id, kind: batch.kind,
        itemRefs: [...batch.itemRefs], decidedAt: batch.decidedAt, heldSince: batch.heldSince,
        reason: batch.reason, state: batch.state,
        ...(batch.deliveredAt === undefined ? {} : {deliveredAt: batch.deliveredAt})})),
      nextCursor: last !== undefined && start + page.length < ordered.length ? last.id : null,
      retained,
    };
  }

  private isoNow(): string {
    return new Date(this.options.now()).toISOString();
  }
}

/** 已确认批次保留最近 DELIVERED_BATCH_LIMIT 条作幂等记录；未确认批次永不淘汰。 */
function trimBatches(batches: NotificationBatch[]): NotificationBatch[] {
  const unacknowledged = batches.filter(batch => batch.state === 'ready_for_delivery');
  const delivered = batches.filter(batch => batch.state === 'delivered').sort((left, right) =>
    left.decidedAt < right.decidedAt ? -1 : left.decidedAt > right.decidedAt ? 1
      : left.id < right.id ? -1 : left.id > right.id ? 1 : 0);
  return [...unacknowledged, ...delivered.slice(-DELIVERED_BATCH_LIMIT)];
}

/** 被摘要批次的条目键同样进 delivered 窗口（批次已创建即视为已裁）。 */
function flushedKeys(digestPool: readonly PendingItem[], decided: readonly NotificationBatch[]): string[] {
  const hasDigest = decided.some(batch => batch.kind === 'digest');
  return hasDigest ? digestPool.map(entry => entry.dedupeKey) : [];
}

function isPendingItem(value: unknown): value is PendingItem {
  if (!value || typeof value !== 'object') return false;
  const entry = value as Record<string, unknown>;
  return typeof entry.dedupeKey === 'string' && typeof entry.source === 'string' && typeof entry.receivedAt === 'string' && !!entry.item;
}

function isBatch(value: unknown): value is NotificationBatch {
  if (!value || typeof value !== 'object') return false;
  const batch = value as Record<string, unknown>;
  return typeof batch.id === 'string'
    && (batch.kind === 'immediate' || batch.kind === 'digest')
    && Array.isArray(batch.itemRefs)
    && typeof batch.decidedAt === 'string'
    && typeof batch.reason === 'string'
    && (batch.state === 'ready_for_delivery' || batch.state === 'delivered');
}

function earliest(entries: readonly PendingItem[]): string {
  return entries.reduce((min, entry) => entry.receivedAt < min ? entry.receivedAt : min, entries[0]?.receivedAt ?? '');
}

function isoInstant(ms: number): string {
  return new Date(ms).toISOString();
}

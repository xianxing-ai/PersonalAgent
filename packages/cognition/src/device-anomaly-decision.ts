import {createHash} from 'node:crypto';
import {
  LayaActionChoiceService,
  actionArgumentsDigest,
  type LayaActionCandidate,
  type LayaActionChoiceRequest,
  type LayaActionSelection,
} from './laya-action-choice.js';
import type {LayaInferencePort} from './laya-decision.js';
import {CognitionError} from './impact.js';
import {withCognitionDeadline} from './deadline.js';

export interface DeviceAnomalyActionChoicePort {
  choose(request: LayaActionChoiceRequest): Promise<LayaActionSelection>;
}

export interface DeviceSample {
  readonly source: string;
  readonly timestamp: string;
  readonly cpuPercent: number;
  readonly memoryPercent: number;
  readonly diskPercent?: number | undefined;
  readonly samplingIntervalMs: number;
  readonly unavailableMetrics?: readonly string[] | undefined;
}

export interface DeviceNotificationPort {
  sendAdvisoryNotification(notification: {
    readonly id: string;
    readonly source: string;
    readonly title: string;
    readonly message: string;
    readonly advice: string;
    readonly candidateId: string;
    readonly timestamp: string;
  }): Promise<{ readonly delivered: boolean; readonly error?: string }> | { readonly delivered: boolean; readonly error?: string };
}

export interface DeviceAnomalyOptions {
  readonly checkpoint?: DeviceAnomalyCheckpointPort | undefined;
  /** Alert trigger threshold for CPU percentage (default: 90). */
  readonly cpuThresholdPercent?: number | undefined;
  /** Alert trigger threshold for Memory percentage (default: 90). */
  readonly memoryThresholdPercent?: number | undefined;
  /** Hysteresis recovery threshold below which anomaly clears (default: 80). */
  readonly recoveryThresholdPercent?: number | undefined;
  /** Consecutive samples required to confirm an anomaly (default: 3). */
  readonly sustainedSampleCount?: number | undefined;
  /** Minimum interval in milliseconds between repeated alert notifications (default: 300,000 = 5 min). */
  readonly cooldownMs?: number | undefined;
  /** Maximum sampling gap multiplier before consecutive counter resets (default: 2.5). */
  readonly maxSamplingGapMultiplier?: number | undefined;
  readonly notificationPort?: DeviceNotificationPort | undefined;
  readonly now?: (() => number) | undefined;
}

export type DeviceAnomalyStatus =
  | 'normal'
  | 'monitoring'
  | 'alert_triggered'
  | 'alert_active_hysteresis'
  | 'cooldown_suppressed'
  | 'recovered'
  | 'indeterminate'
  | 'replayed';

export interface DeviceAnomalyDecisionReceipt {
  readonly receiptId: string;
  readonly source: string;
  readonly status: DeviceAnomalyStatus;
  readonly isAlertActive: boolean;
  readonly consecutiveElevatedCount: number;
  readonly sample: DeviceSample;
  readonly selection?: LayaActionSelection | undefined;
  readonly selectedCandidate?: LayaActionCandidate | undefined;
  readonly candidates?: readonly LayaActionCandidate[] | undefined;
  readonly safeAdvice: string;
  readonly notificationDelivered?: boolean | undefined;
}

interface SourceState {
  consecutiveElevatedCount: number;
  isAlertActive: boolean;
  lastAlertTimestampMs: number | null;
  lastSampleTimestampMs: number | null;
  sampleCounter: number;
  pendingDelivery?: {id: string; timestampMs: number} | undefined;
  lastReceipt?: DeviceAnomalyDecisionReceipt | undefined;
}

export interface DeviceAnomalyCheckpointPort {
  load(): unknown | Promise<unknown>;
  save(value: {version: 1; configDigest: string; sources: Record<string, SourceState>}): void | Promise<void>;
}

const hash = (text: string): string => createHash('sha256').update(text).digest('hex');

/**
 * Proactive decision service for device anomaly evaluation.
 * - Per-source state isolation
 * - Strict sampling continuity (gap check resets un-alerted consecutive count)
 * - Clear separation of threshold confirmation vs hysteresis hold
 * - Indeterminate handling (unavailable metrics do not masquerade as recovery)
 * - Cooldown updated strictly on confirmed Laya decision
 * - Advisory-only candidates: NO self-signed authorization, NO destructive operations.
 */
export class DeviceAnomalyDecisionService {
  private readonly choiceService: DeviceAnomalyActionChoicePort;
  private readonly cpuThreshold: number;
  private readonly memoryThreshold: number;
  private readonly recoveryThreshold: number;
  private readonly sustainedCount: number;
  private readonly cooldownMs: number;
  private readonly maxGapMultiplier: number;
  private readonly notificationPort?: DeviceNotificationPort | undefined;
  private readonly now: () => number;
  private readonly sourceStates = new Map<string, SourceState>();
  private readonly checkpoint?: DeviceAnomalyCheckpointPort | undefined;
  private readonly configDigest: string;
  private loaded = false;
  private tail: Promise<void> = Promise.resolve();

  constructor(
    inferenceOrChooser: LayaInferencePort | DeviceAnomalyActionChoicePort,
    options: DeviceAnomalyOptions = {}
  ) {
    if (!inferenceOrChooser) throw new CognitionError('INVALID_ARGUMENT');
    if ('choose' in inferenceOrChooser && typeof inferenceOrChooser.choose === 'function') {
      this.choiceService = inferenceOrChooser;
    } else if ('infer' in inferenceOrChooser && typeof (inferenceOrChooser as LayaInferencePort).infer === 'function') {
      this.choiceService = new LayaActionChoiceService(inferenceOrChooser as LayaInferencePort);
    } else {
      throw new CognitionError('INVALID_ARGUMENT');
    }
    this.cpuThreshold = options.cpuThresholdPercent ?? 90;
    this.memoryThreshold = options.memoryThresholdPercent ?? 90;
    this.recoveryThreshold = options.recoveryThresholdPercent ?? 80;
    this.sustainedCount = Math.max(1, options.sustainedSampleCount ?? 3);
    this.cooldownMs = options.cooldownMs ?? 300_000;
    this.maxGapMultiplier = options.maxSamplingGapMultiplier ?? 2.5;
    this.notificationPort = options.notificationPort;
    this.now = options.now ?? Date.now;
    this.checkpoint = options.checkpoint;
    this.configDigest = hash(JSON.stringify([this.cpuThreshold, this.memoryThreshold,
      this.recoveryThreshold, this.sustainedCount, this.cooldownMs, this.maxGapMultiplier]));

    if (!Number.isFinite(this.cpuThreshold) || !Number.isFinite(this.memoryThreshold)
      || !Number.isFinite(this.recoveryThreshold) || this.cpuThreshold > 100 || this.memoryThreshold > 100
      || this.cpuThreshold <= 0 || this.memoryThreshold <= 0 || this.recoveryThreshold < 0
      || !Number.isSafeInteger(this.sustainedCount) || this.sustainedCount < 1
      || !Number.isFinite(this.cooldownMs) || this.cooldownMs < 0
      || !Number.isFinite(this.maxGapMultiplier) || this.maxGapMultiplier < 1
      || this.recoveryThreshold >= this.cpuThreshold || this.recoveryThreshold >= this.memoryThreshold) {
      throw new CognitionError('INVALID_ARGUMENT');
    }
  }

  private async load(): Promise<void> {
    if (this.loaded) return;
    // A rejected checkpoint must not expose a partially loaded source prefix.
    const loadedSources = new Map<string, SourceState>();
    const value = await this.checkpoint?.load();
    if (value !== undefined && value !== null) {
      const saved = value as {version: number; configDigest: string; sources: Record<string, SourceState>};
      if (saved.version !== 1 || saved.configDigest !== this.configDigest
        || !saved.sources || typeof saved.sources !== 'object' || Array.isArray(saved.sources)) {
        throw new CognitionError('INVALID_ARGUMENT');
      }
      for (const [source, state] of Object.entries(saved.sources)) {
        if (!source.trim() || !Number.isSafeInteger(state.consecutiveElevatedCount)
          || state.consecutiveElevatedCount < 0 || typeof state.isAlertActive !== 'boolean'
          || !Number.isSafeInteger(state.sampleCounter) || state.sampleCounter < 0
          || ![state.lastAlertTimestampMs, state.lastSampleTimestampMs].every(time => time === null || Number.isFinite(time))
          || (state.pendingDelivery && (typeof state.pendingDelivery.id !== 'string'
            || !Number.isFinite(state.pendingDelivery.timestampMs)))) throw new CognitionError('INVALID_ARGUMENT');
        loadedSources.set(source, structuredClone(state));
      }
    }
    this.sourceStates.clear();
    for (const [source, state] of loadedSources) this.sourceStates.set(source, state);
    this.loaded = true;
  }

  private async save(): Promise<void> {
    await this.checkpoint?.save({version: 1, configDigest: this.configDigest,
      sources: structuredClone(Object.fromEntries(this.sourceStates))});
  }

  /** Local feedback readback; pending delivery never counts as delivered. */
  async readFeedback(): Promise<readonly {source: string; pendingDeliveryId?: string | undefined;
    receipt?: DeviceAnomalyDecisionReceipt | undefined}[]> {
    const operation = this.tail.then(async () => {
      await this.load();
      return [...this.sourceStates].map(([source, state]) => ({source,
        pendingDeliveryId: state.pendingDelivery?.id, receipt: structuredClone(state.lastReceipt)}));
    });
    this.tail = operation.then(() => {}, () => {});
    return operation;
  }

  /** Only the trusted notification host may reconcile an interrupted delivery. */
  async reconcileDelivery(source: string, deliveryId: string, delivered: boolean): Promise<void> {
    const operation = this.tail.then(async () => {
      await this.load();
      const state = this.sourceStates.get(source);
      if (!state?.pendingDelivery || state.pendingDelivery.id !== deliveryId || typeof delivered !== 'boolean') {
        throw new CognitionError('INVALID_ARGUMENT');
      }
      if (delivered) state.lastAlertTimestampMs = state.pendingDelivery.timestampMs;
      if (state.lastReceipt) state.lastReceipt = {...state.lastReceipt,
        status: delivered ? 'alert_triggered' : 'monitoring', notificationDelivered: delivered,
        safeAdvice: delivered ? '受信通知宿主已读回确认投递，冷却状态已持久化'
          : '受信通知宿主确认未投递，后续新采样可以重试'};
      // Host-state checkpoints require lossless JSON; absent optional state
      // must not be represented by an own property with an undefined value.
      delete state.pendingDelivery;
      try {await this.save();}
      catch (error) {if (this.checkpoint) {this.loaded = false; this.sourceStates.clear();} throw error;}
    });
    this.tail = operation.then(() => {}, () => {});
    return operation;
  }

  private getSourceState(source: string): SourceState {
    let state = this.sourceStates.get(source);
    if (!state) {
      state = {
        consecutiveElevatedCount: 0,
        isAlertActive: false,
        lastAlertTimestampMs: null,
        lastSampleTimestampMs: null,
        sampleCounter: 0,
      };
      this.sourceStates.set(source, state);
    }
    return state;
  }

  /**
   * Evaluates an incoming device sample per source.
   */
  async evaluateSample(
    sample: DeviceSample,
    layaRequest?: {deadline: string; signal: AbortSignal}
  ): Promise<DeviceAnomalyDecisionReceipt> {
    // Capture caller-owned data before waiting for queued work or checkpoint I/O.
    let submittedSample: DeviceSample;
    try { submittedSample = structuredClone(sample); }
    catch { throw new CognitionError('INVALID_ARGUMENT'); }
    const submittedRequest = layaRequest
      ? {deadline: layaRequest.deadline, signal: layaRequest.signal} : undefined;
    const operation = this.tail.then(async () => {
      await this.load();
      try {
        const receipt = await this.evaluateSerial(submittedSample, submittedRequest);
        if (receipt.status !== 'replayed') {
          this.getSourceState(submittedSample.source).lastReceipt = structuredClone(receipt);
          await this.save();
        }
        return structuredClone(receipt);
      } catch (error) {
        if (this.checkpoint) {this.loaded = false; this.sourceStates.clear();}
        throw error;
      }
    });
    this.tail = operation.then(() => {}, () => {});
    return operation;
  }

  private async evaluateSerial(sample: DeviceSample,
    layaRequest?: {deadline: string; signal: AbortSignal}): Promise<DeviceAnomalyDecisionReceipt> {
    if (layaRequest && (!(layaRequest.signal instanceof AbortSignal) || layaRequest.signal.aborted
      || !Number.isFinite(Date.parse(layaRequest.deadline))
      || this.now() >= Date.parse(layaRequest.deadline))) throw new CognitionError('INVALID_ARGUMENT');
    if (!sample || typeof sample.source !== 'string' || !sample.source.trim()
      || !Number.isFinite(Date.parse(sample.timestamp))
      || !Number.isFinite(sample.cpuPercent) || sample.cpuPercent < 0 || sample.cpuPercent > 100
      || !Number.isFinite(sample.memoryPercent) || sample.memoryPercent < 0 || sample.memoryPercent > 100
      || !Number.isSafeInteger(sample.samplingIntervalMs) || sample.samplingIntervalMs <= 0) {
      throw new CognitionError('INVALID_ARGUMENT');
    }

    const sampleTimeMs = Date.parse(sample.timestamp);
    const state = this.getSourceState(sample.source);
    if (state.pendingDelivery) {
      return {...state.lastReceipt, receiptId: state.pendingDelivery.id, source: sample.source, status: 'indeterminate',
        isAlertActive: state.isAlertActive, consecutiveElevatedCount: state.consecutiveElevatedCount,
        sample: state.lastReceipt?.sample ?? sample, notificationDelivered: false,
        safeAdvice: '上次通知投递结果待受信宿主核实，保留反馈且不重复投递'};
    }

    // Monotonicity / Replay check for this source
    if (state.lastSampleTimestampMs !== null && sampleTimeMs <= state.lastSampleTimestampMs) {
      return {
        receiptId: hash(`replay:${sample.source}:${sample.timestamp}`),
        source: sample.source,
        status: 'replayed',
        isAlertActive: state.isAlertActive,
        consecutiveElevatedCount: state.consecutiveElevatedCount,
        sample,
        safeAdvice: '忽略非递增时间戳或重复到达的旧采样数据',
      };
    }

    // Sampling continuity check: if gap exceeds samplingInterval * multiplier, reset un-alerted consecutive count
    if (state.lastSampleTimestampMs !== null) {
      const gap = sampleTimeMs - state.lastSampleTimestampMs;
      if (gap > sample.samplingIntervalMs * this.maxGapMultiplier) {
        state.consecutiveElevatedCount = 0;
      }
    }
    state.lastSampleTimestampMs = sampleTimeMs;
    state.sampleCounter++;

    const isCpuUnavailable = sample.unavailableMetrics?.includes('cpu') ?? false;
    const isMemoryUnavailable = sample.unavailableMetrics?.includes('memory') ?? false;

    // Both key metrics unavailable: indeterminate status
    if (isCpuUnavailable && isMemoryUnavailable) {
      state.consecutiveElevatedCount = 0;
      return {
        receiptId: hash(`indeterminate:${sample.source}:${sample.timestamp}:${state.sampleCounter}`),
        source: sample.source,
        status: 'indeterminate',
        isAlertActive: state.isAlertActive,
        consecutiveElevatedCount: state.consecutiveElevatedCount,
        sample,
        safeAdvice: 'CPU与内存监测指标均不可用，维持现有状态，不执行恢复或告警触发',
      };
    }

    const cpuExceeded = !isCpuUnavailable && sample.cpuPercent >= this.cpuThreshold;
    const memoryExceeded = !isMemoryUnavailable && sample.memoryPercent >= this.memoryThreshold;
    const isElevated = cpuExceeded || memoryExceeded;

    if (isElevated) {
      state.consecutiveElevatedCount++;

      // Check if sustained sample requirement is reached
      if (state.consecutiveElevatedCount >= this.sustainedCount) {
        // Sustained anomaly confirmed: check cooldown suppression
        if (state.isAlertActive && state.lastAlertTimestampMs !== null
          && (sampleTimeMs - state.lastAlertTimestampMs < this.cooldownMs)) {
          return {
            receiptId: hash(`cooldown:${sample.source}:${sample.timestamp}:${state.sampleCounter}`),
            source: sample.source,
            status: 'cooldown_suppressed',
            isAlertActive: true,
            consecutiveElevatedCount: state.consecutiveElevatedCount,
            sample,
            safeAdvice: `系统资源持续高负荷（CPU: ${sample.cpuPercent}%, 内存: ${sample.memoryPercent}%），已在冷却窗口（${Math.round(this.cooldownMs / 1000)}s）内抑制重复通知。`,
          };
        }

        const expiresAt = new Date(this.now() + 120_000).toISOString();
        const candidates = this.buildSafeCandidates(sample, expiresAt, state.sampleCounter);

        const context = `[设备性能状态] 来源: ${sample.source}, 时间: ${sample.timestamp}, CPU使用率: ${sample.cpuPercent}%, 内存使用率: ${sample.memoryPercent}%, 采样间隔: ${sample.samplingIntervalMs}ms. 连续超标采样次数: ${state.consecutiveElevatedCount}.`;

        const deadline = layaRequest?.deadline ?? new Date(this.now() + 60_000).toISOString();
        const signal = layaRequest?.signal ?? new AbortController().signal;

        let selection: LayaActionSelection;
        try {
          selection = await withCognitionDeadline({deadline, signal}, bounded =>
            this.choiceService.choose({context, candidates, ...bounded}), this.now);
        } catch {
          // If inference fails, do NOT update cooldown timestamp so subsequent attempts can proceed
          return {
            receiptId: hash(`inference_failed:${sample.source}:${sample.timestamp}:${state.sampleCounter}`),
            source: sample.source,
            status: 'monitoring',
            isAlertActive: state.isAlertActive,
            consecutiveElevatedCount: state.consecutiveElevatedCount,
            sample,
            safeAdvice: 'Laya 推理决策暂时不可用，保持持续监测，未锁定冷却窗口',
          };
        }

        if (selection.state === 'abstain') {
          return {
            receiptId: hash(`inference_failed:${sample.source}:${sample.timestamp}:${state.sampleCounter}`),
            source: sample.source,
            status: 'monitoring',
            isAlertActive: state.isAlertActive,
            consecutiveElevatedCount: state.consecutiveElevatedCount,
            sample,
            selection,
            safeAdvice: `Laya 推理暂未产生有效决议 (${selection.reason})，保持持续监测，未锁定冷却窗口`,
          };
        }

        const selectedCandidate = candidates.find(c => c.id === selection.selected?.id);
        const safeAdvice = this.formatAdvice(selectedCandidate, selection);

        if (selection.state !== 'selected' || !selection.eligibleForRuntime || !selectedCandidate
          || selectedCandidate.revision !== selection.selected?.revision || signal.aborted
          || this.now() >= Date.parse(deadline)) {
          return {receiptId: hash(`review:${sample.source}:${sample.timestamp}`), source: sample.source,
            status: 'monitoring', isAlertActive: state.isAlertActive,
            consecutiveElevatedCount: state.consecutiveElevatedCount, sample, selection, candidates,
            safeAdvice: 'Laya 选择待复核或已取消，未执行动作，未锁定冷却窗口', notificationDelivered: false};
        }

        let deliveryConfirmed = false;
        let notificationDelivered: boolean | undefined = undefined;
        if (this.notificationPort) {
          const deliveryId = hash(`notify:${sample.source}:${sample.timestamp}:${state.sampleCounter}`);
          state.isAlertActive = true;
          state.pendingDelivery = {id: deliveryId, timestampMs: sampleTimeMs};
          state.lastReceipt = {receiptId: deliveryId, source: sample.source, status: 'indeterminate',
            isAlertActive: true, consecutiveElevatedCount: state.consecutiveElevatedCount,
            sample, selection, selectedCandidate, candidates, notificationDelivered: false,
            safeAdvice: '通知投递意图已保存，结果尚待宿主确认'};
          // Persist intent before delivery. A crash or final checkpoint failure
          // retains an unknown result that requires host readback, never resend.
          await this.save();
          if (signal.aborted || this.now() >= Date.parse(deadline)) {
            // This intent was created above and delivery has not been attempted.
            if (state.pendingDelivery?.id === deliveryId) delete state.pendingDelivery;
            return {receiptId: deliveryId, source: sample.source, status: 'monitoring',
              isAlertActive: state.isAlertActive, consecutiveElevatedCount: state.consecutiveElevatedCount,
              sample, selection, selectedCandidate, candidates, notificationDelivered: false,
              safeAdvice: '本次请求已取消或到期，通知未投递，继续监测且未锁定冷却窗口'};
          }
          try {
            const deliveryResult = await withCognitionDeadline({deadline, signal}, () =>
              Promise.resolve(this.notificationPort!.sendAdvisoryNotification({
              id: deliveryId,
              source: sample.source,
              title: `系统资源高负荷告警 (${sample.source})`,
              message: `CPU使用率: ${sample.cpuPercent}%, 内存使用率: ${sample.memoryPercent}%`,
              advice: safeAdvice,
              candidateId: selectedCandidate?.id ?? 'none',
              timestamp: sample.timestamp,
              })), this.now);
            deliveryConfirmed = deliveryResult.delivered === true;
            notificationDelivered = deliveryConfirmed;
          } catch {
            return {receiptId: deliveryId, source: sample.source, status: 'indeterminate',
              isAlertActive: true, consecutiveElevatedCount: state.consecutiveElevatedCount,
              sample, selection, candidates, safeAdvice: '通知投递未确认，结果待受信宿主核实，未锁定冷却且不盲目重发',
              notificationDelivered: false};
          }
        } else {
          deliveryConfirmed = false;
          notificationDelivered = false;
        }

        state.isAlertActive = true;
        if (deliveryConfirmed) {
          state.lastAlertTimestampMs = sampleTimeMs;
        }
        delete state.pendingDelivery;

        let adviceText = safeAdvice;
        if (!this.notificationPort) {
          adviceText = `${safeAdvice} (未配置通知端口，通知未投递，未锁定冷却窗口)`;
        } else if (!deliveryConfirmed) {
          adviceText = `${safeAdvice} (桌面通知投递失败，未锁定冷却窗口以待后续重试)`;
        }

        return {
          receiptId: hash(`alert:${sample.source}:${sample.timestamp}:${state.sampleCounter}`),
          source: sample.source,
          status: 'alert_triggered',
          isAlertActive: true,
          consecutiveElevatedCount: state.consecutiveElevatedCount,
          sample,
          selection,
          selectedCandidate,
          candidates,
          safeAdvice: adviceText,
          notificationDelivered,
        };
      }

      // Elevated but still accumulating consecutive samples
      return {
        receiptId: hash(`monitoring:${sample.source}:${sample.timestamp}:${state.sampleCounter}`),
        source: sample.source,
        status: 'monitoring',
        isAlertActive: state.isAlertActive,
        consecutiveElevatedCount: state.consecutiveElevatedCount,
        sample,
        safeAdvice: `检测到系统指标超标（CPU: ${sample.cpuPercent}%, 内存: ${sample.memoryPercent}%），连续采样确认中 (${state.consecutiveElevatedCount}/${this.sustainedCount})。`,
      };
    }

    // Sample is NOT elevated (below threshold)
    // If not in active alert: consecutive count resets immediately to 0
    if (!state.isAlertActive) {
      state.consecutiveElevatedCount = 0;
    }

    // Check recovery: ONLY if neither is unavailable AND both strictly below recovery threshold
    const canCheckRecovery = !isCpuUnavailable && !isMemoryUnavailable;
    const isBelowRecovery = canCheckRecovery
      && sample.cpuPercent < this.recoveryThreshold
      && sample.memoryPercent < this.recoveryThreshold;

    if (isBelowRecovery) {
      const wasActive = state.isAlertActive;
      state.isAlertActive = false;
      state.consecutiveElevatedCount = 0;

      if (wasActive) {
        return {
          receiptId: hash(`recovered:${sample.source}:${sample.timestamp}:${state.sampleCounter}`),
          source: sample.source,
          status: 'recovered',
          isAlertActive: false,
          consecutiveElevatedCount: 0,
          sample,
          safeAdvice: `系统资源负载已降至安全恢复阈值以下（CPU: ${sample.cpuPercent}%, 内存: ${sample.memoryPercent}% < ${this.recoveryThreshold}%），告警状态已解除。`,
        };
      }

      return {
        receiptId: hash(`normal:${sample.source}:${sample.timestamp}:${state.sampleCounter}`),
        source: sample.source,
        status: 'normal',
        isAlertActive: false,
        consecutiveElevatedCount: 0,
        sample,
        safeAdvice: `系统资源利用率正常（CPU: ${sample.cpuPercent}%, 内存: ${sample.memoryPercent}%）。`,
      };
    }

    // Inside hysteresis band (< threshold but >= recovery threshold)
    return {
      receiptId: hash(`hysteresis:${sample.source}:${sample.timestamp}:${state.sampleCounter}`),
      source: sample.source,
      status: state.isAlertActive ? 'alert_active_hysteresis' : 'normal',
      isAlertActive: state.isAlertActive,
      consecutiveElevatedCount: state.consecutiveElevatedCount,
      sample,
      safeAdvice: `系统指标处于迟滞区间（CPU: ${sample.cpuPercent}%, 内存: ${sample.memoryPercent}%），保持现有${state.isAlertActive ? '告警' : '常规'}状态。`,
    };
  }

  /**
   * Constructs exactly 3 safe, reversible candidate options.
   * STRICT GUARDRAIL: Advisory candidates only. NO self-signed authorizations, NO process killing, NO file deletion.
   */
  private buildSafeCandidates(sample: DeviceSample, expiresAt: string, revision: number): readonly LayaActionCandidate[] {
    const sourceRef = {id: sample.source, revision};
    const emptyDigest = actionArgumentsDigest({});

    // Candidate 1: Remind user to inspect via desktop notification advice
    const candidate1: LayaActionCandidate = {
      id: 'remind_user_inspect',
      revision: 1,
      kind: 'escalate',
      description: '生成桌面通知建议，提醒用户检查高占用任务；保持系统应用与进程运行状态不变',
      sources: [sourceRef],
      scopeRef: 'desktop:notify_advisory',
      expiresAt,
      risk: 'low',
      argumentsDigest: emptyDigest,
    };

    // Candidate 2: Defer background syncing / indexing tasks
    const candidate2: LayaActionCandidate = {
      id: 'defer_background_tasks',
      revision: 1,
      kind: 'defer',
      description: '通知用户建议暂缓非关键后台任务；本候选只投递建议，不调用调度器或自动暂停任务',
      sources: [sourceRef],
      scopeRef: 'agent:background_scheduler_advisory',
      expiresAt,
      risk: 'low',
      argumentsDigest: emptyDigest,
    };

    // Candidate 3: Capture diagnostic snapshot for review
    const candidate3: LayaActionCandidate = {
      id: 'escalate_diagnostics',
      revision: 1,
      kind: 'escalate',
      description: '记录瞬时性能指标快照呈报用户复核，不对操作系统环境做任何写操作',
      sources: [sourceRef],
      scopeRef: 'diagnostics:review_advisory',
      expiresAt,
      risk: 'low',
      argumentsDigest: emptyDigest,
    };

    return Object.freeze([candidate1, candidate2, candidate3]);
  }

  private formatAdvice(
    candidate: LayaActionCandidate | undefined,
    selection: LayaActionSelection
  ): string {
    if (!candidate || selection.state !== 'selected') {
      return 'Laya 建议保持当前状态并由用户人工核实（未执行任何自动化系统修改）。';
    }
    switch (candidate.id) {
      case 'remind_user_inspect':
        return 'Laya 建议通过桌面通知提醒用户检查资源占用情况；仅生成建议卡片，未中止任何应用或进程。';
      case 'defer_background_tasks':
        return 'Laya 建议用户暂缓非关键后台同步；当前只投递建议，尚未暂停或修改任何任务。';
      case 'escalate_diagnostics':
        return 'Laya 建议记录诊断指标快照供用户复核，不对系统环境做任何非授权修改。';
      default:
        return `Laya 建议执行可逆安全建议: ${candidate.description}`;
    }
  }
}

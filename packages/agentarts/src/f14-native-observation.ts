// F14 原生观察能力：desktop.current_observation 与 runtime.desktop_input_lock 的生产 host 端口。
// 对应 OPEN_WORK zemeng 第 3 项「F14 原生观察能力：browser.observe、输入锁、会话绑定」（UI 归 lab）。
// 两个端口都是 WorkflowHostPort（只读/检查语义，不授予任何权限、不执行写操作）：
//  · 观察口：包装既有受控 browser/desktop 只读观察（playwright 链），输出有界、带摘要与会话绑定；
//  · 输入锁口：在既有主进程输入租约（computer-control-lease 语义）上做会话绑定互斥检查——
//    锁被其他会话持有时 fail-closed；真正的串行执行仍走 desktop.registered_input/submit 写节点与原 Policy。
import {createHash} from 'node:crypto';
import type {WorkflowHostPort, WorkflowNodeContext} from './owned-workflows.js';

const text = (value: unknown): value is string => typeof value === 'string' && !!value.trim();

/** 一次受控观察的有界结果。文本与元素数量都有上限；不包含输入框当前值等敏感态。 */
export interface DesktopObservation {
  readonly source: string;
  readonly url: string;
  readonly title: string;
  readonly textExcerpt: string;
  readonly elements: readonly {readonly ref: string; readonly role: string; readonly label: string}[];
  readonly truncated: boolean;
  readonly capturedAt: string;
  readonly observationSha256: string;
}

export interface DesktopObservationOptions {
  /** 受控只读观察（现有 browser/desktop 观察链）。返回 undefined = 当前不可观察。 */
  observe(request: {readonly maxTextBytes: number; readonly maxElements: number}, context: WorkflowNodeContext):
    Promise<{source: string; url: string; title: string; text: string; elements: DesktopObservation['elements']} | undefined>;
  readonly maxTextBytes?: number;
  readonly maxElements?: number;
}

/** F14_N01：desktop.current_observation——有界、带指纹、与会话命名空间绑定。 */
export function createDesktopObservationHostPort(options: DesktopObservationOptions): WorkflowHostPort {
  const maxTextBytes = options.maxTextBytes ?? 16_000;
  const maxElements = options.maxElements ?? 64;
  if (typeof options?.observe !== 'function') throw new TypeError('createDesktopObservationHostPort 需要观察端口');
  return {
    capabilities: ['desktop.current_observation'],
    async read(context: WorkflowNodeContext) {
      try {
        const observed = await options.observe({maxTextBytes, maxElements}, context);
        if (!observed) return {state: 'unavailable' as const, value: {reason: 'observation_source_unavailable'}};
        if (!text(observed.source) || !text(observed.url) || !Array.isArray(observed.elements)) {
          return {state: 'failed' as const, value: {reason: 'observation_malformed'}};
        }
        const truncated = Buffer.byteLength(observed.text ?? '', 'utf8') > maxTextBytes || observed.elements.length > maxElements;
        const textExcerpt = Buffer.from(observed.text ?? '', 'utf8').subarray(0, maxTextBytes).toString('utf8');
        const elements = observed.elements.slice(0, maxElements);
        const capturedAt = new Date().toISOString();
        const observationSha256 = createHash('sha256').update(JSON.stringify({
          source: observed.source, url: observed.url, title: observed.title ?? '', textExcerpt, elements, namespace: context.namespace,
        })).digest('hex');
        const value: DesktopObservation = {
          source: observed.source, url: observed.url, title: observed.title ?? '', textExcerpt, elements,
          truncated, capturedAt, observationSha256,
        };
        return {state: 'completed' as const, value};
      } catch (error) {
        if (context.signal.aborted || Date.parse(context.deadline) <= Date.now()) throw error;
        return {state: 'failed' as const, value: {reason: 'observation_failed'}};
      }
    },
  };
}

/** 输入租约的最小受信面（由既有主进程输入租约适配提供；不新增权限语义）。 */
export interface DesktopInputLeasePort {
  /** 尝试为该会话取得输入互斥；已被同一会话持有时返回现有令牌。其他会话持有 → undefined。 */
  acquire(holder: {readonly sessionId: string; readonly taskId: string; readonly nodeId: string},
    context: WorkflowNodeContext): Promise<{token: string; expiresAt: string} | undefined>;
  /** 当前持有者读回（无持有 → undefined）。 */
  current(context: WorkflowNodeContext): Promise<{sessionId: string; taskId: string; expiresAt: string} | undefined>;
}

/** F14_N02：runtime.desktop_input_lock——会话绑定的输入互斥检查；无租约端口时明确 unavailable。 */
export function createDesktopInputLockHostPort(options: {lease?: DesktopInputLeasePort}): WorkflowHostPort {
  return {
    capabilities: ['runtime.desktop_input_lock'],
    async read(context: WorkflowNodeContext) {
      const lease = options?.lease;
      if (!lease || typeof lease.acquire !== 'function' || typeof lease.current !== 'function') {
        return {state: 'unavailable' as const, value: {reason: 'input_lease_port_unavailable'}};
      }
      const sessionId = context.namespace;
      const taskId = context.requestId;
      try {
        const current = await lease.current(context);
        if (current && current.sessionId !== sessionId) {
          return {state: 'failed' as const, value: {reason: 'input_lock_held_by_other_session', holderSessionId: current.sessionId}};
        }
        if (current && Date.parse(current.expiresAt) <= Date.now()) {
          return {state: 'failed' as const, value: {reason: 'input_lock_expired'}};
        }
        const acquired = await lease.acquire({sessionId, taskId, nodeId: context.node.id}, context);
        if (!acquired) return {state: 'failed' as const, value: {reason: 'input_lock_not_acquired'}};
        if (!text(acquired.token) || !Number.isFinite(Date.parse(acquired.expiresAt))) {
          return {state: 'failed' as const, value: {reason: 'input_lock_receipt_malformed'}};
        }
        return {state: 'completed' as const, value: {token: acquired.token, expiresAt: acquired.expiresAt, sessionId}};
      } catch (error) {
        if (context.signal.aborted || Date.parse(context.deadline) <= Date.now()) throw error;
        return {state: 'failed' as const, value: {reason: 'input_lock_check_failed'}};
      }
    },
  };
}

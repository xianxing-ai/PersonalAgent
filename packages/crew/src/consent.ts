import {CrewError} from './errors.js';
import {
  CREW_DRIVER_IDS,
  CrewStore,
  type CrewConsentGrantRecordInput,
  type CrewConsentLoginKind,
  type CrewConsentRecord,
  type CrewDriverId,
} from './store.js';

const LOGIN_KINDS: readonly CrewConsentLoginKind[] = ['local-login', 'api-key'];

export interface CrewConsentGrantInput {
  readonly driverId: CrewDriverId;
  /** 登录方式：本机已登录官方 CLI（订阅）或用户自己的 API key。 */
  readonly loginKind: CrewConsentLoginKind;
  /** 同意时向用户展示过的条款要点（厂商条款、额度从哪里扣）。 */
  readonly termsSummary: string;
  /** 同意者标识，例如 'user'。 */
  readonly grantedBy: string;
}

/**
 * 订阅使用同意接口（合规边界）。
 *
 * 首次启用一家订阅来源（驱动）前，必须由用户明确同意；同意记录写入 crew 自己的
 * SQLite 存储（`crew_consents` 表），可随时撤销。任何驱动的 `start` 都必须先经
 * `requireGranted` 确认：未同意或已撤销时必须拒绝（`CONSENT_REQUIRED`），
 * 不得降级放行、不得用默认值假装已同意。
 *
 * 本 PR 只定义接口并交付 crew 存储上的实现；设置页等宿主接线由前端负责人
 * 按设计页分期接入，不在此 PR 范围内。
 */
export interface CrewConsentProvider {
  /** 读取一家驱动的同意记录；从未登记时返回 undefined。 */
  getConsent(driverId: CrewDriverId): CrewConsentRecord | undefined;
  /** 未同意或已撤销时抛 `CONSENT_REQUIRED`；已同意时返回当前记录。 */
  requireGranted(driverId: CrewDriverId): CrewConsentRecord;
  /** 记录用户同意（宿主在用户明确同意后调用；重新同意会覆盖上一次撤销）。 */
  grant(input: CrewConsentGrantInput): CrewConsentRecord;
  /** 撤销同意；撤销后对应驱动的 start 必须拒绝。 */
  revoke(driverId: CrewDriverId, reason: string): CrewConsentRecord;
}

/**
 * crew 独立 SQLite 存储上的同意记录实现：写入 `crew_consents` 表，
 * 与任务/信箱共用同一个 crew 数据库，随 SQLite 持久、重启不丢。
 * 只存合规元数据（登录方式、条款要点），不存储任何凭据。
 */
export class CrewStoreConsentProvider implements CrewConsentProvider {
  private readonly store: CrewStore;

  constructor(store: CrewStore) {
    this.store = store;
  }

  getConsent(driverId: CrewDriverId): CrewConsentRecord | undefined {
    return this.store.getConsentRecord(driverId);
  }

  requireGranted(driverId: CrewDriverId): CrewConsentRecord {
    const record = this.store.getConsentRecord(driverId);
    if (!record) {
      throw new CrewError('CONSENT_REQUIRED', `首次使用 ${driverId} 订阅来源前需要用户明确同意（登录方式与条款要点见设计页订阅合规边界）；同意前驱动 start 必须拒绝`);
    }
    if (!record.granted) {
      throw new CrewError('CONSENT_REQUIRED', `${driverId} 的订阅使用同意已被撤销（${record.revokedAt ?? '未知时间'}），如需继续使用请用户重新同意`);
    }
    return record;
  }

  grant(input: CrewConsentGrantInput): CrewConsentRecord {
    if (!CREW_DRIVER_IDS.includes(input.driverId)) {
      throw new CrewError('INVALID_INPUT', `driverId must be one of ${CREW_DRIVER_IDS.join(', ')}`);
    }
    if (!LOGIN_KINDS.includes(input.loginKind)) {
      throw new CrewError('INVALID_INPUT', `loginKind must be one of ${LOGIN_KINDS.join(', ')}`);
    }
    const recordInput: CrewConsentGrantRecordInput = {
      driverId: input.driverId,
      loginKind: input.loginKind,
      termsSummary: input.termsSummary,
      grantedBy: input.grantedBy,
    };
    return this.store.saveConsentGrant(recordInput);
  }

  revoke(driverId: CrewDriverId, reason: string): CrewConsentRecord {
    return this.store.saveConsentRevoke({driverId, reason});
  }
}

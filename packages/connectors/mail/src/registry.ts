import { ProtocolError } from '@personal-agent/contracts';
import type { ProtocolContracts } from '@personal-agent/contracts';
import type {
  MailFetchInput,
  MailArchiveInput,
  MailFolder,
  MailMarkSeenInput,
  MailMessage,
  MailOperationContext,
  MailPage,
  MailProvider,
  MailSendInput,
  MailSendResult,
} from './provider.js';

/** 一个已绑定的邮箱账号：标识 + 提供商实例 + 非敏感展示标签（邮箱地址）。 */
export interface BoundMailAccount {
  accountRef: string;
  provider: MailProvider;
  label: string;
}

/**
 * 多账号注册表：同一实例绑定多个邮箱（如多个 QQ 邮箱）。绑定/解绑由宿主
 * （桌面设置 UI）直接调用——凭据的持久化与加密存储归宿主，本注册表只在
 * 运行时持有已构造好的提供商实例。同 accountRef 重复 bind 为换绑（替换实例）。
 */
export class MailAccountRegistry {
  private readonly accounts = new Map<string, BoundMailAccount>();

  bind(accountRef: string, provider: MailProvider, label?: string): {rebound: boolean} {
    if (typeof accountRef !== 'string' || accountRef.length === 0) {
      throw new ProtocolError('INVALID_ARGUMENT', 'accountRef must be a non-empty string');
    }
    if (!provider) throw new ProtocolError('INVALID_ARGUMENT', 'provider is required to bind a mail account');
    const rebound = this.accounts.has(accountRef);
    this.accounts.set(accountRef, {accountRef, provider, label: label ?? accountRef});
    return {rebound};
  }

  unbind(accountRef: string): boolean {
    return this.accounts.delete(accountRef);
  }

  list(): {accountRef: string; label: string}[] {
    return [...this.accounts.values()].map(account => ({accountRef: account.accountRef, label: account.label}));
  }

  size(): number {
    return this.accounts.size;
  }

  resolve(accountRef: string): MailProvider {
    const account = this.accounts.get(accountRef);
    if (account === undefined) {
      const bound = [...this.accounts.keys()].join(', ') || 'none';
      throw new ProtocolError('UNAUTHORIZED', `Mail account "${accountRef}" is not bound (bound: ${bound})`);
    }
    return account.provider;
  }

  /** 构造时按已绑定集合给出诚实的 verification：全部是 Fake 才是 mock。 */
  verificationOf(): 'mock' | 'conditional' {
    for (const account of this.accounts.values()) {
      if (account.provider.providerKind !== 'fixture') return 'conditional';
    }
    return 'mock';
  }
}

/**
 * 注册表的 MailProvider 门面：按 accountRef 分发到对应账号的提供商，
 * 使 MailService/工具层无需感知单账号还是多账号。仅绑定一个账号时，
 * 该账号同时充当默认账号（省略 account 入参即用它）。
 */
export class RegistryMailProvider implements MailProvider {
  readonly providerKind = 'qq';
  readonly verification: 'mock' | 'conditional';

  constructor(
    private readonly registry: MailAccountRegistry,
    private readonly defaultAccountRef?: string,
  ) {
    this.verification = registry.verificationOf();
  }

  /** 显式默认账号（仍绑定时优先）；否则唯一绑定即默认；无默认且多账号 → undefined（调用方必须指定）。 */
  defaultAccount(): string | undefined {
    const refs = this.registry.list().map(account => account.accountRef);
    if (this.defaultAccountRef !== undefined && refs.includes(this.defaultAccountRef)) return this.defaultAccountRef;
    return refs.length === 1 ? refs[0] : undefined;
  }

  listFolders(accountRef: string): MailFolder[] | Promise<MailFolder[]> {
    return this.registry.resolve(accountRef).listFolders(accountRef);
  }

  fetchPage(accountRef: string, input: MailFetchInput): MailPage | Promise<MailPage> {
    return this.registry.resolve(accountRef).fetchPage(accountRef, input);
  }

  getMessage(accountRef: string, folder: string, uid: number): MailMessage | undefined | Promise<MailMessage | undefined> {
    return this.registry.resolve(accountRef).getMessage(accountRef, folder, uid);
  }

  markSeen(accountRef: string, input: MailMarkSeenInput, context?: MailOperationContext): {uid: number; seen: boolean} | Promise<{uid: number; seen: boolean}> {
    return this.registry.resolve(accountRef).markSeen(accountRef, input, context);
  }

  send(accountRef: string, input: MailSendInput & {idempotencyKey: string},context?:MailOperationContext): MailSendResult | Promise<MailSendResult> {
    return this.registry.resolve(accountRef).send(accountRef, input,context);
  }

  async archive(accountRef:string,input:MailArchiveInput,context?:MailOperationContext):Promise<ProtocolContracts['connectorAction']> {
    const provider=this.registry.resolve(accountRef);
    if(!provider.archive)throw new ProtocolError('UNSUPPORTED_CAPABILITY','This mail provider cannot archive messages');
    return provider.archive(accountRef,input,context);
  }

  async saveDraft(accountRef: string, input: MailSendInput & {idempotencyKey: string}, context?: MailOperationContext): Promise<ProtocolContracts['connectorAction']> {
    const provider = this.registry.resolve(accountRef);
    if (!provider.saveDraft) throw new ProtocolError('UNSUPPORTED_CAPABILITY', 'This mail provider cannot save drafts');
    return provider.saveDraft(accountRef, input, context);
  }

  async reconcileSend(accountRef: string, messageId: string, idempotencyKey: string): Promise<MailSendResult> {
    const provider = this.registry.resolve(accountRef);
    if (!provider.reconcileSend) throw new ProtocolError('UNSUPPORTED_CAPABILITY', 'This mail provider cannot reconcile sent mail');
    return provider.reconcileSend(accountRef, messageId, idempotencyKey);
  }

  assertSendIdentity(accountRef: string, messageId: string, idempotencyKey: string): void {
    const provider = this.registry.resolve(accountRef);
    if (!provider.assertSendIdentity) throw new ProtocolError('UNSUPPORTED_CAPABILITY', 'Original send identity binding is unavailable');
    provider.assertSendIdentity(accountRef, messageId, idempotencyKey);
  }
}

import { ProtocolError } from '@personal-agent/contracts';
import type { RegisteredTool, ToolDescriptor, ToolHost } from '@personal-agent/contracts';
import { MailConnector, MAIL_CONNECTOR_VERSION } from './connector.js';
import { MailService } from './service.js';
import type { MailProvider } from './provider.js';
import { decodeMailCursor } from './provider.js';
import { MailAccountRegistry, RegistryMailProvider } from './registry.js';
import {registerMailWriteTools} from './write-tools.js';

export { MailConnector, MAIL_CONNECTOR_VERSION } from './connector.js';
export { MailService, messageToItem } from './service.js';
export { FakeMailProvider, defaultMailFixtures } from './fake-provider.js';
export { QQMailProvider, messageFromImap } from './qq.js';
export type { QQMailOptions } from './qq.js';
export { MailAccountRegistry, RegistryMailProvider } from './registry.js';
export type { BoundMailAccount } from './registry.js';
export { decodeMailCursor, encodeMailCursor } from './provider.js';
export type {
  MailCursor, MailFetchInput, MailFolder, MailMarkSeenInput, MailArchiveInput, MailMessage, MailOperationContext, MailPage,
  MailProvider, MailSendInput, MailSendResult,
} from './provider.js';

const PROTOCOL_ID = 'https://personalagent.local/protocol/1.0.0';

const inboxInputSchema: ToolDescriptor['inputSchema'] = {
  type: 'object',
  description: '增量读取邮件（缺省收件箱）。绑定多个邮箱账号时必须给出 account（可用 mail.accounts 查询已绑定列表）；只绑定一个账号时可省略。游标按账号隔离，取该账号上一页返回的 nextCursor（`uidValidity:lastUid`）；uidValidity 变化返回 CURSOR_EXPIRED，需从头同步。邮件内容敏感（sensitivity: private），条目只含发件人/主题/已读状态。',
  properties: {
    account: {type: 'string', minLength: 1, description: '要读取的已绑定账号标识；省略时若恰好只绑定一个账号则用它。'},
    cursor: {type: 'string', minLength: 1, description: '上一页的 nextCursor；空串或省略表示从头开始。'},
    limit: {type: 'integer', minimum: 1, maximum: 100, description: '单页条数上限，默认 20。'},
    folder: {type: 'string', minLength: 1, description: 'IMAP 文件夹路径，默认 INBOX。'},
  },
  additionalProperties: false,
};

const inboxOutputSchema: ToolDescriptor['outputSchema'] = {
  type: 'object',
  required: ['items', 'nextCursor', 'hasMore', 'folder', 'account'],
  additionalProperties: false,
  properties: {
    items: {type: 'array', items: {$ref: `${PROTOCOL_ID}#/definitions/ConnectorItem`}},
    nextCursor: {type: 'string'},
    hasMore: {type: 'boolean'},
    folder: {type: 'string', minLength: 1},
    account: {type: 'string', minLength: 1},
  },
};

const accountsOutputSchema: ToolDescriptor['outputSchema'] = {
  type: 'object',
  required: ['accounts'],
  additionalProperties: false,
  properties: {
    accounts: {
      type: 'array',
      items: {
        type: 'object',
        required: ['accountRef', 'label'],
        additionalProperties: false,
        properties: {
          accountRef: {type: 'string', minLength: 1},
          label: {type: 'string', minLength: 1},
        },
      },
    },
  },
};

export interface MailModuleOptions {
  provider: MailProvider;
  accountRef?: string;
  now?: () => number;
  /**
   * 多账号模式：传入由宿主维护的注册表（桌面设置 UI bind/unbind），
   * `provider` 将作为默认账号绑定进去。省略时内部创建注册表并只绑定 `provider`。
   */
  registry?: MailAccountRegistry;
}

export function register(host: ToolHost, options: MailModuleOptions): () => void {
  if (!options?.provider) throw new ProtocolError('INVALID_ARGUMENT', 'Mail provider must be explicitly configured; fake providers are test-only');
  const registry = options.registry ?? new MailAccountRegistry();
  const defaultAccountRef = options.accountRef ?? 'local';
  registry.bind(defaultAccountRef, options.provider);
  const provider = new RegistryMailProvider(registry, defaultAccountRef);
  const service = new MailService(provider, {now: options.now ?? Date.now});
  const connector = new MailConnector(service, MAIL_CONNECTOR_VERSION);
  connector.connect();

  const inboxTool: RegisteredTool = {
    descriptor: {
      name: 'mail.inbox',
      version: MAIL_CONNECTOR_VERSION,
      inputSchema: inboxInputSchema,
      outputSchema: inboxOutputSchema,
      sideEffect: 'read',
      requiredScopes: ['mail:read'],
      idempotencySupport: true,
      recoverySupport: true,
      requiresPresence: false,
    },
    execute: async (input: unknown, context) => {
      const raw = input as {account?: string; cursor?: string; limit?: number; folder?: string};
      const accountRef = typeof raw.account === 'string' && raw.account.length > 0
        ? raw.account
        : provider.defaultAccount();
      if (accountRef === undefined) {
        const bound = registry.list().map(account => account.accountRef).join(', ');
        throw new ProtocolError('INVALID_ARGUMENT', `Multiple mail accounts are bound; pass one of: ${bound}`);
      }
      const cursor = typeof raw.cursor === 'string' && raw.cursor.length > 0
        ? decodeMailCursor(raw.cursor)
        : undefined;
      const fetchArgs: {cursor?: ReturnType<typeof decodeMailCursor>; limit?: number; folder?: string; signal?: AbortSignal} = {signal: context.signal};
      if (cursor !== undefined) fetchArgs.cursor = cursor;
      if (raw.limit !== undefined) fetchArgs.limit = raw.limit;
      if (typeof raw.folder === 'string') fetchArgs.folder = raw.folder;
      const page = await service.fetchInbox(accountRef, fetchArgs);
      return {...page, account: accountRef};
    },
  };

  const accountsTool: RegisteredTool = {
    descriptor: {
      name: 'mail.accounts',
      version: MAIL_CONNECTOR_VERSION,
      inputSchema: {
        type: 'object',
        description: '列出当前绑定的邮箱账号（标识与展示标签）。凭据不在此暴露。',
        additionalProperties: false,
        properties: {},
      },
      outputSchema: accountsOutputSchema,
      sideEffect: 'read',
      requiredScopes: ['mail:read'],
      idempotencySupport: true,
      recoverySupport: true,
      requiresPresence: false,
    },
    execute: async () => ({accounts: registry.list()}),
  };

  const unregisterInbox = host.register(inboxTool);
  const unregisterAccounts = host.register(accountsTool);
  const extra: (() => void)[] = [];
  const resolveAccount = (raw: {account?: string}): string => {
    const account = raw.account ?? provider.defaultAccount();
    if (!account) throw new ProtocolError('INVALID_ARGUMENT', 'An explicitly bound mail account is required');
    return account;
  };
  extra.push(registerMailWriteTools(host,provider,service,resolveAccount));
  extra.push(host.register({
    descriptor: {
      name: 'mail.mark_seen', version: MAIL_CONNECTOR_VERSION,
      inputSchema: {type: 'object', additionalProperties: false, required: ['folder', 'uid'],
        properties: {account: {type: 'string', minLength: 1}, folder: {type: 'string', minLength: 1},
          uid: {type: 'integer', minimum: 1}}},
      outputSchema: {$ref: `${PROTOCOL_ID}#/definitions/ConnectorAction`},
      sideEffect: 'external_write', requiredScopes: ['mail:write'], idempotencySupport: true,
      recoverySupport: true, requiresPresence: false,
    },
    execute: async (input, context) => {
      if (context.signal.aborted) throw new ProtocolError('CANCELLED', 'Mail mark_seen cancelled before execution');
      const raw = input as {account?: string; folder: string; uid: number};
      return service.markSeen(resolveAccount(raw), {folder: raw.folder, uid: raw.uid, idempotencyKey: context.runId}, context);
    },
  }));
  if (options.provider.saveDraft) {
    extra.push(host.register({
      descriptor: {
        name: 'mail.save_draft', version: MAIL_CONNECTOR_VERSION,
        inputSchema: {type: 'object', additionalProperties: false, required: ['to', 'subject', 'text'],
          properties: {account: {type: 'string', minLength: 1}, to: {type: 'string', minLength: 3},
            subject: {type: 'string', minLength: 1, maxLength: 500}, text: {type: 'string'}}},
        outputSchema: {$ref: `${PROTOCOL_ID}#/definitions/ConnectorAction`},
        sideEffect: 'external_write', requiredScopes: ['mail:draft'], idempotencySupport: true,
        recoverySupport: false, requiresPresence: false,
      },
      execute: async (input, context) => {
        if (context.signal.aborted) throw new ProtocolError('CANCELLED', 'Mail draft cancelled before execution');
        const raw = input as {account?: string; to: string; subject: string; text: string};
        return service.saveDraft(resolveAccount(raw), {...raw, idempotencyKey: context.runId}, context);
      },
    }));
  }
  if (options.provider.reconcileSend) {
    extra.push(host.register({
      descriptor: {
        name: 'mail.reconcile_send', version: MAIL_CONNECTOR_VERSION,
        inputSchema: {type: 'object', additionalProperties: false, required: ['messageId', 'idempotencyKey'],
          properties: {account: {type: 'string', minLength: 1}, messageId: {type: 'string', minLength: 3},
            idempotencyKey: {type: 'string', minLength: 1}}},
        outputSchema: {$ref: `${PROTOCOL_ID}#/definitions/ConnectorAction`},
        sideEffect: 'read', requiredScopes: ['mail:read'], idempotencySupport: true,
        recoverySupport: true, requiresPresence: false,
      },
      execute: async (input, context) => {
        if (context.signal.aborted) throw new ProtocolError('CANCELLED', 'Mail reconciliation cancelled before execution');
        const raw = input as {account?: string; messageId: string; idempotencyKey: string};
        const result = await service.reconcileSend(resolveAccount(raw), raw.messageId, raw.idempotencyKey);
        if (context.signal.aborted) throw new ProtocolError('CANCELLED', 'Mail reconciliation cancelled');
        return result;
      },
    }));
  }
  return () => {
    extra.forEach(unregister => unregister());
    unregisterInbox();
    unregisterAccounts();
    connector.disconnect();
  };
}

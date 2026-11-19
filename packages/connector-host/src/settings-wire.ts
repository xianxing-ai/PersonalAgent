import {ProtocolError} from '@personal-agent/contracts';
import type {ConnectorHost, ConnectorStatus} from './index.js';

/** MOD-13 production settings/connector wire contract (host side).
 *
 * Publishes the operation catalog a production settings surface may call to
 * observe and drive the ConnectorHost — without implementing any business
 * connector here and without weakening host guarantees:
 * - unregistered connector ids answer UNSUPPORTED_CAPABILITY (fail-closed),
 *   they are never reported as available;
 * - connect failures of the real factory propagate unchanged (no fake
 *   success, no silent fallback);
 * - results are JSON-safe metadata only; secrets stay inside the host.
 *
 * Contract revision: see docs/interfaces/CONNECTOR_SETTINGS_WIRE_CONTRACT.md.
 */

export const SETTINGS_CONNECTOR_WIRE_REVISION = 1;

export const SETTINGS_CONNECTOR_OPERATIONS = Object.freeze([
  'settings.connector.list',
  'settings.connector.describe',
  'settings.connector.connect',
  'settings.connector.disconnect',
]);

export type SettingsConnectorOperation = typeof SETTINGS_CONNECTOR_OPERATIONS[number];

export interface SettingsConnectorRequestContext {
  signal: AbortSignal;
}

export interface SettingsConnectorSummary {
  id: string;
  version: string;
  capabilities: string[];
  authentication: string;
  verification: string;
  syncStrategy: string;
  health: ConnectorStatus['health'];
}

const summary = (status: ConnectorStatus): SettingsConnectorSummary => ({
  id: status.manifest.id,
  version: status.manifest.version,
  capabilities: [...status.manifest.capabilities],
  authentication: status.manifest.authentication,
  verification: status.manifest.verification,
  syncStrategy: status.manifest.syncStrategy,
  health: structuredClone(status.health),
});

const connectorId = (payload: Record<string, unknown>): string => {
  const value = payload.connectorId;
  if (typeof value !== 'string') throw new ProtocolError('INVALID_ARGUMENT', 'connectorId 必须是字符串');
  return value;
};

export class SettingsConnectorWireApi {
  constructor(private readonly host: ConnectorHost) {}

  async handle(operation: string, payload: unknown, context: SettingsConnectorRequestContext): Promise<unknown> {
    if (!SETTINGS_CONNECTOR_OPERATIONS.includes(operation as SettingsConnectorOperation)) {
      throw new ProtocolError('INVALID_ARGUMENT', '不支持的 settings/connector 操作');
    }
    if (payload !== undefined && payload !== null && (typeof payload !== 'object' || Array.isArray(payload))) {
      throw new ProtocolError('INVALID_ARGUMENT', 'settings/connector 载荷格式无效');
    }
    const input = (payload ?? {}) as Record<string, unknown>;
    const allowed = operation === 'settings.connector.list' ? [] : ['connectorId'];
    const unknown = Object.keys(input).filter(key => !allowed.includes(key));
    if (unknown.length) throw new ProtocolError('INVALID_ARGUMENT', `settings/connector 载荷包含无效字段：${unknown.join(',')}`);

    if (operation === 'settings.connector.list') {
      return {revision: SETTINGS_CONNECTOR_WIRE_REVISION, connectors: this.host.list().map(summary)};
    }
    const id = connectorId(input);
    if (operation === 'settings.connector.describe') {
      const status = this.host.list().find(item => item.manifest.id === id);
      // Unknown ids stay explicitly unavailable: a settings surface must never
      // mistake an unregistered business connector for a usable one.
      if (!status) throw new ProtocolError('UNSUPPORTED_CAPABILITY', `Connector ${id} is not registered`);
      return {revision: SETTINGS_CONNECTOR_WIRE_REVISION, connector: summary(status),
        proactiveSources: this.host.listProactiveSources().filter(source => source.connectorId === id)};
    }
    if (operation === 'settings.connector.connect') {
      if (context.signal.aborted) throw new ProtocolError('CANCELLED', 'Connector connection was cancelled');
      const result = await this.host.connect(id, context.signal);
      return {revision: SETTINGS_CONNECTOR_WIRE_REVISION, connectorId: id, ...structuredClone(result)};
    }
    const result = await this.host.disconnect(id);
    return {revision: SETTINGS_CONNECTOR_WIRE_REVISION, connectorId: id, ...structuredClone(result)};
  }
}

import assert from 'node:assert/strict';
import test from 'node:test';
import {ConnectorHost, SettingsConnectorWireApi, SETTINGS_CONNECTOR_OPERATIONS, SETTINGS_CONNECTOR_WIRE_REVISION} from '../dist/index.js';

const manifest = {
  id: 'fixture',
  version: '1.0.0',
  accountTypes: ['fixture'],
  capabilities: ['search'],
  configSchema: {type: 'object'},
  authentication: 'token',
  requiresPresence: false,
  syncStrategy: 'manual',
  verification: 'mock',
};

class FixtureConnector {
  manifest = manifest;
  connected = false;
  connect() { this.connected = true; return {sessionRef: 'fixture-session', interactionRequired: false}; }
  disconnect() { this.connected = false; return {disconnected: true, cleanupState: 'complete'}; }
  getCapabilities() { return ['search']; }
  health() { return {state: this.connected ? 'ready' : 'disconnected'}; }
  fetchChanges() { throw new Error('not used'); }
  search() { return []; }
  getItem() { throw new Error('not used'); }
  performAction() { throw new Error('not used'); }
}

const signal = () => new AbortController().signal;
const rejects = async (promise, code) => {
  const match = typeof code === 'function' ? code : error => error instanceof Object && error.code === code;
  await assert.rejects(promise, match);
};

test('wire catalog is published with a revision', () => {
  assert.deepEqual([...SETTINGS_CONNECTOR_OPERATIONS], [
    'settings.connector.list', 'settings.connector.describe',
    'settings.connector.connect', 'settings.connector.disconnect']);
  assert.equal(SETTINGS_CONNECTOR_WIRE_REVISION, 1);
});

test('list reports registered connectors only, without secrets', async () => {
  const host = new ConnectorHost({read: () => 'secret-value'});
  const wire = new SettingsConnectorWireApi(host);
  assert.deepEqual(await wire.handle('settings.connector.list', null, {signal: signal()}),
    {revision: 1, connectors: []}, 'zero registrations stay honestly empty');
  host.register({manifest, create: async () => new FixtureConnector()}, {secretRefs: ['fixture-token']});
  const listed = await wire.handle('settings.connector.list', undefined, {signal: signal()});
  assert.equal(listed.connectors.length, 1);
  assert.deepEqual(listed.connectors[0], {id: 'fixture', version: '1.0.0', capabilities: ['search'],
    authentication: 'token', verification: 'mock', syncStrategy: 'manual', health: {state: 'disconnected'}});
  assert.equal(JSON.stringify(listed).includes('secret-value'), false);
});

test('describe answers metadata and proactive sources, unknown ids stay unavailable', async () => {
  const host = new ConnectorHost({read: () => 'secret-value'});
  const wire = new SettingsConnectorWireApi(host);
  await rejects(wire.handle('settings.connector.describe', {connectorId: 'fixture'}, {signal: signal()}), 'UNSUPPORTED_CAPABILITY');
  host.register({manifest, create: async () => new FixtureConnector()},
    {proactive: [{sourceId: 'fixture-source', accountRef: 'acc-1', configurationRevision: 'rev-1', kind: 'other', mode: 'manual-only'}]});
  const described = await wire.handle('settings.connector.describe', {connectorId: 'fixture'}, {signal: signal()});
  assert.equal(described.connector.id, 'fixture');
  assert.deepEqual(described.proactiveSources.map(source => source.sourceId), ['fixture-source']);
  assert.equal(described.proactiveSources[0].mode, 'manual-only');
  await rejects(wire.handle('settings.connector.describe', {connectorId: 'unregistered'}, {signal: signal()}), 'UNSUPPORTED_CAPABILITY');
});

test('connect surfaces the real factory result or its real failure — no fake success', async () => {
  const host = new ConnectorHost({read: () => 'secret-value'});
  const wire = new SettingsConnectorWireApi(host);
  await rejects(wire.handle('settings.connector.connect', {connectorId: 'fixture'}, {signal: signal()}), 'UNSUPPORTED_CAPABILITY');
  host.register({manifest, create: async context => {
    await context.readSecret('fixture-token');
    return new FixtureConnector();
  }}, {secretRefs: ['fixture-token']});
  assert.deepEqual(await wire.handle('settings.connector.connect', {connectorId: 'fixture'}, {signal: signal()}),
    {revision: 1, connectorId: 'fixture', sessionRef: 'fixture-session', interactionRequired: false});
  const broken = new ConnectorHost({read: () => 'secret-value'});
  const brokenWire = new SettingsConnectorWireApi(broken);
  broken.register({manifest, create: async () => { throw new Error('mail connector not implemented in production'); }});
  await rejects(brokenWire.handle('settings.connector.connect', {connectorId: 'fixture'}, {signal: signal()}),
    error => /not implemented/.test(error.message), 'factory failures propagate unchanged');
});

test('disconnect reports host cleanup state verbatim', async () => {
  const host = new ConnectorHost({read: () => 'secret-value'});
  const wire = new SettingsConnectorWireApi(host);
  host.register({manifest, create: async () => new FixtureConnector()});
  assert.deepEqual(await wire.handle('settings.connector.disconnect', {connectorId: 'fixture'}, {signal: signal()}),
    {revision: 1, connectorId: 'fixture', disconnected: true, cleanupState: 'not_started'});
  await wire.handle('settings.connector.connect', {connectorId: 'fixture'}, {signal: signal()});
  assert.deepEqual(await wire.handle('settings.connector.disconnect', {connectorId: 'fixture'}, {signal: signal()}),
    {revision: 1, connectorId: 'fixture', disconnected: true, cleanupState: 'complete'});
});

test('malformed operations and payloads fail closed with coded errors', async () => {
  const host = new ConnectorHost({read: () => 'secret-value'});
  const wire = new SettingsConnectorWireApi(host);
  const context = {signal: signal()};
  await rejects(wire.handle('settings.connector.restart', null, context), 'INVALID_ARGUMENT');
  await rejects(wire.handle('settings.connector.list', ['x'], context), 'INVALID_ARGUMENT');
  await rejects(wire.handle('settings.connector.list', {connectorId: 'x'}, context), 'INVALID_ARGUMENT');
  await rejects(wire.handle('settings.connector.connect', {connectorId: 5}, context), 'INVALID_ARGUMENT');
  await rejects(wire.handle('settings.connector.connect', {connectorId: 'fixture', extra: 1}, context), 'INVALID_ARGUMENT');
  const controller = new AbortController();
  controller.abort();
  await rejects(wire.handle('settings.connector.connect', {connectorId: 'fixture'}, {signal: controller.signal}), 'CANCELLED');
});

import assert from 'node:assert/strict';
import test from 'node:test';
import {mkdtempSync, readFileSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createAgentArtsObservationConfig} from '../electron/agentarts-observation-config.js';
import {
  createAgentArtsObservationRequestAuth,
  resolveDesktopAgentArtsObservation,
} from '../electron/agentarts-observation-auth.js';

const HOST = 'agentarts.cn-southwest-2.myhuaweicloud.com';
const credentials = {
  accessKey: 'SYNTHETICACCESSKEY',
  secretKey: 'synthetic-observation-secret-never-real',
  applicationId: 'pa-app-synthetic',
};
const safeStorage = {
  isEncryptionAvailable: () => true,
  encryptString: value => Buffer.from(value).reverse(),
  decryptString: value => Buffer.from(value).reverse().toString(),
};

function openConfig(t, environment = {}) {
  const userData = mkdtempSync(path.join(tmpdir(), 'pa-obs-'));
  t.after(() => rmSync(userData, {recursive: true, force: true}));
  return {
    userData,
    config: createAgentArtsObservationConfig({userData, safeStorage, environment}),
  };
}

test('absent observation settings resolve to undefined (explicit unavailable, no Fake)', t => {
  const {config} = openConfig(t);
  assert.equal(resolveDesktopAgentArtsObservation(config), undefined);
  assert.equal(config.snapshot().configured, false);
  assert.match(config.snapshot().reason, /unavailable|未配置/);
});

test('encrypted AK/SK + applicationId persist; snapshot never leaks secrets', t => {
  const {userData, config} = openConfig(t);
  config.configure(credentials);
  const restored = createAgentArtsObservationConfig({userData, safeStorage, environment: {}});
  assert.deepEqual(restored.readCredentials(), {
    accessKey: credentials.accessKey,
    secretKey: credentials.secretKey,
  });
  assert.equal(restored.readApplicationId(), credentials.applicationId);
  const snap = JSON.stringify(restored.snapshot());
  assert.equal(snap.includes(credentials.secretKey), false);
  assert.equal(snap.includes(credentials.accessKey), false);
  assert.equal(readFileSync(path.join(userData, 'agentarts-observation-config.json'), 'utf8')
    .includes(credentials.secretKey), false);
});

test('resolve injects Fake signer authorization and applicationId without Bearer reuse', t => {
  const {config} = openConfig(t);
  config.configure(credentials);
  const signed = [];
  const fakeAuthorizer = input => {
    assert.equal(input.accessKey, credentials.accessKey);
    assert.equal(input.secretKey, credentials.secretKey);
    assert.equal('authorization' in input, false);
    return {
      async authorize(request) {
        signed.push(request.url);
        return {
          Host: HOST,
          'Content-Type': 'application/json',
          Accept: 'application/json',
          Authorization: 'SDK-HMAC-SHA256 Access=SYNTHETICACCESSKEY, SignedHeaders=accept;content-type;host;x-sdk-date, Signature=' + '0'.repeat(64),
          'X-Sdk-Date': '20261028T000000Z',
        };
      },
    };
  };
  const options = resolveDesktopAgentArtsObservation(config, {createAuthorizer: fakeAuthorizer});
  assert.equal(options.observationApplicationId, credentials.applicationId);
  assert.equal(typeof options.observationAuthorization.authorize, 'function');
  assert.equal(JSON.stringify(options).includes('Bearer'), false);
  assert.equal(JSON.stringify(options).includes(credentials.secretKey), false);
});

test('HMAC signer scopes observation GETs and rejects invoke-style misuse', async () => {
  const auth = createAgentArtsObservationRequestAuth(credentials, {
    now: () => Date.parse('2026-10-28T00:00:00Z'),
  });
  const request = {
    url: `https://${HOST}/v1/ops/observation/traces/offline-42`,
    method: 'GET',
    body: '',
    headers: Object.freeze({Host: HOST, 'Content-Type': 'application/json', Accept: 'application/json'}),
    deadline: '2030-01-01T00:00:00Z',
    signal: new AbortController().signal,
  };
  const headers = await auth.authorize(request);
  assert.equal(headers['X-Sdk-Date'], '20261028T000000Z');
  assert.match(headers.Authorization,
    /^SDK-HMAC-SHA256 Access=SYNTHETICACCESSKEY, SignedHeaders=accept;content-type;host;x-sdk-date, Signature=[a-f0-9]{64}$/);
  assert.equal(JSON.stringify(headers).includes(credentials.secretKey), false);
  for (const change of [
    {url: 'https://example.com/v1/ops/observation/traces/offline-42'},
    {url: request.url + '?redirect=1'},
    {method: 'POST'},
    {body: 'Bearer invoke-token'},
    {deadline: '2020-01-01T00:00:00Z'},
    {signal: AbortSignal.abort()},
  ]) {
    await assert.rejects(auth.authorize({...request, ...change}));
  }
});

test('environment AK/SK pair enables resolve; incomplete pair stays unavailable', t => {
  const ok = openConfig(t, {
    PA_AGENTARTS_OBSERVATION_ACCESS_KEY: credentials.accessKey,
    PA_AGENTARTS_OBSERVATION_SECRET_KEY: credentials.secretKey,
    PA_AGENTARTS_OBSERVATION_APPLICATION_ID: credentials.applicationId,
  });
  const options = resolveDesktopAgentArtsObservation(ok.config);
  assert.equal(options.observationApplicationId, credentials.applicationId);
  assert.equal(typeof options.observationAuthorization.authorize, 'function');

  const broken = openConfig(t, {
    PA_AGENTARTS_OBSERVATION_ACCESS_KEY: credentials.accessKey,
  });
  assert.equal(resolveDesktopAgentArtsObservation(broken.config), undefined);
  assert.equal(broken.config.snapshot().configured, false);
});

test('applicationId alone does not invent a signer', t => {
  const {config} = openConfig(t, {
    PA_AGENTARTS_OBSERVATION_APPLICATION_ID: credentials.applicationId,
  });
  const options = resolveDesktopAgentArtsObservation(config);
  assert.deepEqual(options, {observationApplicationId: credentials.applicationId});
  assert.equal('observationAuthorization' in options, false);
});

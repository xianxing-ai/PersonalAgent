import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, readFileSync, rmSync} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createAgentArtsObservationConfig} from '../electron/agentarts-observation-config.js';
import {
  createAgentArtsObservationRequestAuth,
  resolveDesktopAgentArtsObservation,
} from '../electron/agentarts-observation-auth.js';

function safeStorage() {
  return {
    isEncryptionAvailable: () => true,
    encryptString: value => Buffer.from(value).reverse(),
    decryptString: value => Buffer.from(value).reverse().toString(),
  };
}

function fixture(t, environment = {}) {
  const userData = mkdtempSync(path.join(os.tmpdir(), 'pa-observation-'));
  t.after(() => rmSync(userData, {recursive: true, force: true}));
  return {
    userData,
    file: path.join(userData, 'agentarts-observation-config.json'),
    config: createAgentArtsObservationConfig({userData, safeStorage: safeStorage(), environment}),
  };
}

test('absent observation settings omit Runtime options and stay explicitly unavailable', t => {
  const f = fixture(t);
  assert.equal(f.config.snapshot().configured, false);
  assert.equal(f.config.readCredentials(), undefined);
  assert.equal(f.config.readApplicationId(), undefined);
  assert.equal(resolveDesktopAgentArtsObservation(f.config), undefined);
  assert.match(f.config.snapshot().reason, /unavailable|不复用 invoke Bearer/);
});

test('encrypted AK/SK + applicationId inject observationAuthorization without Bearer reuse', async t => {
  const f = fixture(t);
  const input = {
    accessKey: 'ABCDEFGHIJKLMNOP',
    secretKey: 'synthetic-observation-secret-key',
    applicationId: 'app-resource-001',
  };
  f.config.configure(input);
  assert.equal(f.config.snapshot().configured, true);
  assert.equal(f.config.snapshot().applicationId, 'app-resource-001');
  assert.doesNotMatch(JSON.stringify(f.config.snapshot()), /synthetic-observation-secret|ABCDEFGHIJKLMNOP/);
  assert.doesNotMatch(readFileSync(f.file, 'utf8'), /synthetic-observation-secret|ABCDEFGHIJKLMNOP/);

  const signed = [];
  const options = resolveDesktopAgentArtsObservation(f.config, {
    createAuthorizer: credentials => {
      assert.equal(credentials.accessKey, input.accessKey);
      assert.equal(credentials.secretKey, input.secretKey);
      assert.doesNotMatch(JSON.stringify(credentials), /Bearer/);
      return {
        async authorize(request) {
          signed.push(request.url);
          return {
            ...request.headers,
            Authorization: 'SDK-HMAC-SHA256 Access=fake, SignedHeaders=accept;content-type;host;x-sdk-date, Signature=0',
            'X-Sdk-Date': '20261028T000000Z',
          };
        },
      };
    },
  });
  assert.equal(options.observationApplicationId, 'app-resource-001');
  assert.equal(typeof options.observationAuthorization.authorize, 'function');
  const headers = await options.observationAuthorization.authorize({
    url: 'https://agentarts.cn-southwest-2.myhuaweicloud.com/v1/ops/observation/traces/trace-1',
    method: 'GET',
    body: '',
    headers: {
      Host: 'agentarts.cn-southwest-2.myhuaweicloud.com',
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    deadline: new Date(Date.now() + 60_000).toISOString(),
    signal: new AbortController().signal,
  });
  assert.equal(signed.length, 1);
  assert.match(headers.Authorization, /^SDK-HMAC-SHA256 /);
  assert.doesNotMatch(headers.Authorization, /Bearer/);
});

test('production signer scopes observation GETs and never emits Bearer', async t => {
  const auth = createAgentArtsObservationRequestAuth({
    accessKey: 'ABCDEFGHIJKLMNOP',
    secretKey: 'synthetic-observation-secret-key',
  });
  const headers = await auth.authorize({
    url: 'https://agentarts.cn-southwest-2.myhuaweicloud.com/v1/ops/observation/traces/trace-1',
    method: 'GET',
    body: '',
    headers: {
      Host: 'agentarts.cn-southwest-2.myhuaweicloud.com',
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    deadline: new Date(Date.now() + 60_000).toISOString(),
    signal: new AbortController().signal,
  });
  assert.match(headers.Authorization, /^SDK-HMAC-SHA256 Access=ABCDEFGHIJKLMNOP, SignedHeaders=/);
  assert.doesNotMatch(headers.Authorization, /Bearer/i);
  await assert.rejects(auth.authorize({
    url: 'https://agentarts.cn-southwest-2.myhuaweicloud.com/v1/runtimes/x/invocations',
    method: 'GET',
    body: '',
    headers: {
      Host: 'agentarts.cn-southwest-2.myhuaweicloud.com',
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    deadline: new Date(Date.now() + 60_000).toISOString(),
    signal: new AbortController().signal,
  }), /outside the configured scope/);
});

test('environment applicationId alone does not invent Fake authorization', t => {
  const f = fixture(t, {PA_AGENTARTS_OBSERVATION_APPLICATION_ID: 'env-app-1'});
  assert.equal(f.config.snapshot().configured, false);
  assert.equal(f.config.snapshot().applicationIdConfigured, true);
  const options = resolveDesktopAgentArtsObservation(f.config);
  assert.equal(options.observationApplicationId, 'env-app-1');
  assert.equal(options.observationAuthorization, undefined);
});

test('revoke clears encrypted observation credentials', t => {
  const f = fixture(t);
  f.config.configure({
    accessKey: 'ABCDEFGHIJKLMNOP',
    secretKey: 'synthetic-observation-secret-key',
    applicationId: 'app-resource-001',
  });
  f.config.revoke();
  assert.equal(f.config.snapshot().configured, false);
  assert.equal(resolveDesktopAgentArtsObservation(f.config), undefined);
});

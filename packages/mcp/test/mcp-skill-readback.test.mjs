import assert from 'node:assert/strict';
import test from 'node:test';
import {createHash} from 'node:crypto';
import {
  assertMcpReadbackReceipt,
  assertSkillReadbackReceipt,
  planMcpSkillReadbackAcceptance,
  normalizeMcpReadResult,
  MCP_FILESYSTEM_PACKAGE_VERSION,
  PENDING_ACCEPTANCE_ITEMS,
  PENDING_ACCEPTANCE_REASON,
} from '../dist/index.js';

const sha256 = text => createHash('sha256').update(text).digest('hex');
const VALID_DIGEST = 'a'.repeat(64);
const VALID_DIGEST_2 = 'b'.repeat(64);

test('assertMcpReadbackReceipt accepts valid text and markdown receipts with matching digest', () => {
  const sampleText = 'Workspace competition reference excerpt\nSecond line.\n';
  const digest = sha256(sampleText);

  const receipt = {
    path: 'reference.md',
    text: sampleText,
    contentDigest: digest,
    source: 'mcp',
    serverVersion: MCP_FILESYSTEM_PACKAGE_VERSION,
  };

  const validated = assertMcpReadbackReceipt(receipt);
  assert.equal(validated.source, 'mcp');
  assert.equal(validated.serverVersion, MCP_FILESYSTEM_PACKAGE_VERSION);
  assert.equal(validated.path, 'reference.md');
  assert.equal(validated.contentDigest, digest);

  // Subdirectory path with .txt extension
  const txtReceipt = {
    path: 'docs/public/overview.txt',
    text: 'Overview text',
    contentDigest: sha256('Overview text'),
    source: 'mcp',
    serverVersion: MCP_FILESYSTEM_PACKAGE_VERSION,
  };
  assert.doesNotThrow(() => assertMcpReadbackReceipt(txtReceipt));

  // Receipt without optional text field
  const minimalReceipt = {
    path: 'reference.md',
    contentDigest: VALID_DIGEST,
    source: 'mcp',
    serverVersion: MCP_FILESYSTEM_PACKAGE_VERSION,
  };
  assert.doesNotThrow(() => assertMcpReadbackReceipt(minimalReceipt));
});

test('assertMcpReadbackReceipt rejects non-object or missing mandatory fields with INVALID_ARGUMENT', () => {
  assert.throws(() => assertMcpReadbackReceipt(null), {code: 'INVALID_ARGUMENT'});
  assert.throws(() => assertMcpReadbackReceipt(undefined), {code: 'INVALID_ARGUMENT'});
  assert.throws(() => assertMcpReadbackReceipt('not an object'), {code: 'INVALID_ARGUMENT'});
  assert.throws(() => assertMcpReadbackReceipt([]), {code: 'INVALID_ARGUMENT'});

  // Missing path
  assert.throws(
    () => assertMcpReadbackReceipt({
      contentDigest: VALID_DIGEST,
      source: 'mcp',
      serverVersion: MCP_FILESYSTEM_PACKAGE_VERSION,
    }),
    {code: 'INVALID_ARGUMENT'}
  );

  // Empty path
  assert.throws(
    () => assertMcpReadbackReceipt({
      path: '',
      contentDigest: VALID_DIGEST,
      source: 'mcp',
      serverVersion: MCP_FILESYSTEM_PACKAGE_VERSION,
    }),
    {code: 'INVALID_ARGUMENT'}
  );

  // Missing contentDigest
  assert.throws(
    () => assertMcpReadbackReceipt({
      path: 'reference.md',
      source: 'mcp',
      serverVersion: MCP_FILESYSTEM_PACKAGE_VERSION,
    }),
    {code: 'INVALID_ARGUMENT'}
  );
});

test('assertMcpReadbackReceipt rejects incompatible source or serverVersion with PROTOCOL_MISMATCH', () => {
  const base = {
    path: 'reference.md',
    contentDigest: VALID_DIGEST,
    source: 'mcp',
    serverVersion: MCP_FILESYSTEM_PACKAGE_VERSION,
  };

  // Bad source
  assert.throws(() => assertMcpReadbackReceipt({...base, source: 'skills'}), {code: 'PROTOCOL_MISMATCH'});
  assert.throws(() => assertMcpReadbackReceipt({...base, source: 'local'}), {code: 'PROTOCOL_MISMATCH'});
  assert.throws(() => assertMcpReadbackReceipt({...base, source: 'http'}), {code: 'PROTOCOL_MISMATCH'});

  // Bad serverVersion
  assert.throws(() => assertMcpReadbackReceipt({...base, serverVersion: '1.0.0'}), {code: 'PROTOCOL_MISMATCH'});
  assert.throws(() => assertMcpReadbackReceipt({...base, serverVersion: '2025.1.1'}), {code: 'PROTOCOL_MISMATCH'});
  assert.throws(() => assertMcpReadbackReceipt({...base, serverVersion: 'unsupported'}), {code: 'PROTOCOL_MISMATCH'});
});

test('assertMcpReadbackReceipt rejects non-text surfaces, absolute paths, backslashes, colons, and traversals', () => {
  const base = {
    contentDigest: VALID_DIGEST,
    source: 'mcp',
    serverVersion: MCP_FILESYSTEM_PACKAGE_VERSION,
  };

  const invalidPaths = [
    '/root/reference.md',
    '/etc/passwd.txt',
    'C:/workspace/reference.md',
    'C:\\workspace\\reference.md',
    'docs\\reference.md',
    'scheme:reference.md',
    '../reference.md',
    'docs/../../reference.md',
    './reference.md',
    'docs/./reference.md',
    'docs//reference.md',
    'reference.md/',
    'reference.json',
    'reference.yaml',
    'reference.sh',
    'reference.exe',
    'reference.bin',
  ];

  for (const path of invalidPaths) {
    assert.throws(
      () => assertMcpReadbackReceipt({...base, path}),
      {code: 'INVALID_ARGUMENT'},
      `Expected ${path} to be rejected with INVALID_ARGUMENT`
    );
  }
});

test('assertMcpReadbackReceipt rejects sensitive paths and private keys', () => {
  const base = {
    contentDigest: VALID_DIGEST,
    source: 'mcp',
    serverVersion: MCP_FILESYSTEM_PACKAGE_VERSION,
  };

  const sensitivePaths = [
    '.env',
    '.env.local',
    '.env.production.txt',
    'subdir/.env.md',
    '.git/config.txt',
    '.codex/history.txt',
    '.agents/secret.txt',
    '.ssh/id_rsa.txt',
    '.ssh/known_hosts.txt',
    '.aws/credentials.txt',
    '.azure/token.md',
    '.kube/config.txt',
    '.npmrc.txt',
    'credentials.txt',
    'credentials.md',
    'subdir/credentials.json.txt',
    'secret.txt',
    'secrets.md',
    'passwords.txt',
    'tokens.md',
    'id_rsa.txt',
    'id_rsa',
    'id_ed25519.txt',
    'id_ecdsa.md',
  ];

  for (const path of sensitivePaths) {
    assert.throws(
      () => assertMcpReadbackReceipt({...base, path}),
      {code: 'INVALID_ARGUMENT'},
      `Expected sensitive path ${path} to be rejected`
    );
  }

  // Private key content in text
  const privateKeyText = '-----BEGIN RSA PRIVATE KEY-----\nMIIEowIBAAKCAQEA...\n-----END RSA PRIVATE KEY-----';
  assert.throws(
    () => assertMcpReadbackReceipt({
      ...base,
      path: 'reference.md',
      text: privateKeyText,
      contentDigest: sha256(privateKeyText),
    }),
    {code: 'INVALID_ARGUMENT'}
  );
});

test('assertMcpReadbackReceipt validates 64hex digest and checks consistency with text', () => {
  const base = {
    path: 'reference.md',
    source: 'mcp',
    serverVersion: MCP_FILESYSTEM_PACKAGE_VERSION,
  };

  // Invalid hex formats
  assert.throws(() => assertMcpReadbackReceipt({...base, contentDigest: 'a'.repeat(63)}), {code: 'INVALID_ARGUMENT'});
  assert.throws(() => assertMcpReadbackReceipt({...base, contentDigest: 'a'.repeat(65)}), {code: 'INVALID_ARGUMENT'});
  assert.throws(() => assertMcpReadbackReceipt({...base, contentDigest: 'A'.repeat(64)}), {code: 'INVALID_ARGUMENT'});
  assert.throws(() => assertMcpReadbackReceipt({...base, contentDigest: 'g'.repeat(64)}), {code: 'INVALID_ARGUMENT'});

  // Text provided but digest does not match
  assert.throws(
    () => assertMcpReadbackReceipt({
      ...base,
      text: 'Actual content',
      contentDigest: sha256('Different content'),
    }),
    {code: 'INVALID_ARGUMENT'}
  );
});

test('assertSkillReadbackReceipt accepts valid confirmed, pending, and unknown receipts', () => {
  // Confirmed SkillOutcome style (from createReferenceSummarySkill)
  const outcomeReceipt = {
    state: 'confirmed',
    evidenceRefs: ['evidence-001'],
    sources: [{path: 'reference.md', contentDigest: VALID_DIGEST}],
    resultSummary: `Public excerpt [source=reference.md; sha256=${VALID_DIGEST}]`,
  };
  const validatedOutcome = assertSkillReadbackReceipt(outcomeReceipt);
  assert.equal(validatedOutcome.state, 'confirmed');

  // Confirmed CloudSkillReceipt style (from createCloudSkillSelectionPort)
  const cloudReceipt = {
    state: 'confirmed',
    selectionRef: 'sel-ref-001',
    sourceRef: 'src-ref-001',
    contentDigest: VALID_DIGEST,
    summaryDigest: VALID_DIGEST_2,
    content: 'Two lines of reference summary',
  };
  const validatedCloud = assertSkillReadbackReceipt(cloudReceipt);
  assert.equal(validatedCloud.state, 'confirmed');

  // Pending receipt
  const pendingReceipt = {
    state: 'pending',
    selectionRef: 'sel-ref-002',
    sourceRef: 'src-ref-002',
  };
  assert.doesNotThrow(() => assertSkillReadbackReceipt(pendingReceipt));

  // Unknown receipt
  const unknownReceipt = {
    state: 'unknown',
    evidenceRefs: ['evidence-002'],
  };
  assert.doesNotThrow(() => assertSkillReadbackReceipt(unknownReceipt));
});

test('assertSkillReadbackReceipt rejects fabricated success on mock/synthetic runs with UNAUTHORIZED', () => {
  const base = {
    state: 'confirmed',
    sources: [{path: 'reference.md', contentDigest: VALID_DIGEST}],
  };

  assert.throws(() => assertSkillReadbackReceipt({...base, mock: true}), {code: 'UNAUTHORIZED'});
  assert.throws(() => assertSkillReadbackReceipt({...base, synthetic: true}), {code: 'UNAUTHORIZED'});
  assert.throws(() => assertSkillReadbackReceipt({...base, fake: true}), {code: 'UNAUTHORIZED'});
  assert.throws(() => assertSkillReadbackReceipt({...base, isFake: true}), {code: 'UNAUTHORIZED'});
  assert.throws(() => assertSkillReadbackReceipt({...base, isMock: true}), {code: 'UNAUTHORIZED'});
  assert.throws(() => assertSkillReadbackReceipt({...base, verification: 'mock'}), {code: 'UNAUTHORIZED'});
  assert.throws(() => assertSkillReadbackReceipt({...base, verification: 'synthetic'}), {code: 'UNAUTHORIZED'});
});

test('assertSkillReadbackReceipt rejects confirmed receipts lacking real execution proof', () => {
  // No sources and no contentDigest
  assert.throws(() => assertSkillReadbackReceipt({state: 'confirmed'}), {code: 'INVALID_ARGUMENT'});
  assert.throws(() => assertSkillReadbackReceipt({state: 'confirmed', selectionRef: 's1'}), {code: 'INVALID_ARGUMENT'});

  // Empty sources array
  assert.throws(() => assertSkillReadbackReceipt({state: 'confirmed', sources: []}), {code: 'INVALID_ARGUMENT'});

  // Invalid source path (sensitive or invalid extension)
  assert.throws(
    () => assertSkillReadbackReceipt({
      state: 'confirmed',
      sources: [{path: '.env.txt', contentDigest: VALID_DIGEST}],
    }),
    {code: 'INVALID_ARGUMENT'}
  );
  assert.throws(
    () => assertSkillReadbackReceipt({
      state: 'confirmed',
      sources: [{path: 'script.sh', contentDigest: VALID_DIGEST}],
    }),
    {code: 'INVALID_ARGUMENT'}
  );

  // Invalid contentDigest in source
  assert.throws(
    () => assertSkillReadbackReceipt({
      state: 'confirmed',
      sources: [{path: 'reference.md', contentDigest: 'short'}],
    }),
    {code: 'INVALID_ARGUMENT'}
  );

  // Invalid state string
  assert.throws(() => assertSkillReadbackReceipt({state: 'succeeded'}), {code: 'INVALID_ARGUMENT'});
  assert.throws(() => assertSkillReadbackReceipt({state: 'completed'}), {code: 'INVALID_ARGUMENT'});
  assert.throws(() => assertSkillReadbackReceipt({state: 'ok'}), {code: 'INVALID_ARGUMENT'});
});

test('planMcpSkillReadbackAcceptance returns closedLoop:false, pending items, and fixed reason', () => {
  // Default invocation
  const plan = planMcpSkillReadbackAcceptance();

  assert.equal(plan.closedLoop, false, 'closedLoop must be strictly false');
  assert.deepEqual(plan.pending, PENDING_ACCEPTANCE_ITEMS);
  assert.equal(plan.reason, PENDING_ACCEPTANCE_REASON);
  assert.equal(plan.reason, '待真机/真云验收');
  assert.equal(plan.offlineVerified, true);
  assert.equal(plan.pendingCount, 4);

  // Specifically verify on Linux platform
  if (process.platform === 'linux') {
    assert.equal(plan.platform, 'linux');
  }

  // Caller passing input with claimed cloud/deployment cannot force closedLoop: true
  const planWithClaimedCloud = planMcpSkillReadbackAcceptance({
    platform: 'linux',
    hasRealCloud: true,
    hasDeployment: true,
    hasTargetSystem: true,
  });
  assert.equal(planWithClaimedCloud.closedLoop, false, 'closedLoop MUST remain false even with claimed cloud');
  assert.equal(planWithClaimedCloud.reason, '待真机/真云验收');
  assert.deepEqual(planWithClaimedCloud.pending, [
    'real-mcp',
    'real-skill',
    'agentarts-deployment',
    'target-system',
  ]);
});

test('normalizeMcpReadResult aligns fixture receipts to McpReadResult shape', () => {
  const fixture = {
    path: 'reference.md',
    text: 'Synthetic fixture reference excerpt.\n',
  };

  const normalized = normalizeMcpReadResult(fixture);
  assert.equal(normalized.source, 'mcp');
  assert.equal(normalized.serverVersion, MCP_FILESYSTEM_PACKAGE_VERSION);
  assert.equal(normalized.path, 'reference.md');
  assert.equal(normalized.text, 'Synthetic fixture reference excerpt.\n');
  assert.equal(normalized.contentDigest, sha256('Synthetic fixture reference excerpt.\n'));

  // The normalized output must pass assertMcpReadbackReceipt
  assert.doesNotThrow(() => assertMcpReadbackReceipt(normalized));

  // Normalizing fixture with sensitive path throws INVALID_ARGUMENT
  assert.throws(
    () => normalizeMcpReadResult({path: '.env.txt', text: 'SECRET=1'}),
    {code: 'INVALID_ARGUMENT'}
  );
});

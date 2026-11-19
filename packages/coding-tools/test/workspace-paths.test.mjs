import test from 'node:test';
import assert from 'node:assert/strict';
import {
  MAX_RELATIVE_PATH_LENGTH,
  canonicalRelativePath,
  canonicalRelativeDirectoryPath,
  isSensitivePath,
  pathIsAtOrWithinRoot,
  pathIsWithinRoot,
  sameCanonicalPath,
} from '../dist/workspace-paths.js';

test('MAX_RELATIVE_PATH_LENGTH matches the documented 1024-byte ceiling', () => {
  assert.equal(MAX_RELATIVE_PATH_LENGTH, 1024);
});

test('canonicalRelativePath accepts canonical child segments on both separators', () => {
  assert.deepEqual(canonicalRelativePath('src/index.ts'), {normalized: 'src/index.ts', segments: ['src', 'index.ts']});
  assert.deepEqual(canonicalRelativePath('src\\lib\\main.ts'), {normalized: 'src/lib/main.ts', segments: ['src', 'lib', 'main.ts']});
  assert.deepEqual(canonicalRelativePath('a'.repeat(MAX_RELATIVE_PATH_LENGTH)), {
    normalized: 'a'.repeat(MAX_RELATIVE_PATH_LENGTH),
    segments: ['a'.repeat(MAX_RELATIVE_PATH_LENGTH)],
  });
  // COM10 is not a reserved device name; only COM1-9 are blocked.
  assert.deepEqual(canonicalRelativePath('com10.txt'), {normalized: 'com10.txt', segments: ['com10.txt']});
});

test('canonicalRelativePath rejects absolute, drive, stream and non-canonical paths', () => {
  const invalid = [
    '',                                     // empty segment
    'a'.repeat(MAX_RELATIVE_PATH_LENGTH + 1), // over the length ceiling
    'a\0b',                                 // NUL byte
    '/absolute',                            // POSIX absolute
    'C:/absolute',                          // drive-qualified
    '\\\\server\\share',                    // UNC
    '\\temp',                               // root-relative Windows path
    'a:b',                                  // alternate data stream separator
    'a//b',                                 // empty segment
    'a/./b',                                // current-directory segment
    'a/../b',                               // parent segment
    './a',
    '../a',
    'a/',                                   // trailing empty segment
    'a/b.',                                 // trailing dot segment
    'a/b ',                                 // trailing space segment
    'CON',                                  // reserved device name
    'com1',                                 // reserved device name, case-insensitive
    'aux.txt',                              // reserved device name before an extension
    'lpt9',                                 // reserved device name
  ];
  for (const value of invalid) {
    assert.throws(() => canonicalRelativePath(value), error => error.code === 'INVALID_ARGUMENT', `expected rejection for ${JSON.stringify(value)}`);
  }
});

test('canonicalRelativeDirectoryPath allows only the trusted root marker as a directory alias', () => {
  assert.deepEqual(canonicalRelativeDirectoryPath('.'), {normalized: '.', segments: []});
  assert.deepEqual(canonicalRelativeDirectoryPath('src'), {normalized: 'src', segments: ['src']});
  assert.throws(() => canonicalRelativeDirectoryPath('..'), error => error.code === 'INVALID_ARGUMENT');
});

test('pathIsWithinRoot excludes the root itself and sibling prefixes', () => {
  const root = '/workspace/root';
  assert.equal(pathIsWithinRoot(root, '/workspace/root/child/file.txt'), true);
  assert.equal(pathIsWithinRoot(root, '/workspace/root/child'), true);
  assert.equal(pathIsWithinRoot(root, '/workspace/root'), false);           // root itself is not "within"
  assert.equal(pathIsWithinRoot(root, '/workspace'), false);
  assert.equal(pathIsWithinRoot(root, '/workspace/root/../elsewhere'), false);
  assert.equal(pathIsWithinRoot(root, '/workspace/root2'), false);          // sibling with a shared prefix
});

test('pathIsAtOrWithinRoot additionally admits the root itself', () => {
  const root = '/workspace/root';
  assert.equal(pathIsAtOrWithinRoot(root, '/workspace/root'), true);
  assert.equal(pathIsAtOrWithinRoot(root, '/workspace/root/child'), true);
  assert.equal(pathIsAtOrWithinRoot(root, '/workspace/root/child/file.txt'), true);
  assert.equal(pathIsAtOrWithinRoot(root, '/workspace/root/../elsewhere'), false);
  assert.equal(pathIsAtOrWithinRoot(root, '/workspace/root2'), false);
});

test('sameCanonicalPath is exact on case-sensitive platforms and case-insensitive on Windows', () => {
  assert.equal(sameCanonicalPath('/w/root', '/w/root'), true);
  assert.equal(sameCanonicalPath('/w/root', '/w/other'), false);
  assert.equal(sameCanonicalPath('/w/Root', '/w/root'), process.platform === 'win32');
});

test('isSensitivePath blocks credentials, private keys and DotEnv material case-insensitively', () => {
  const sensitive = [
    '.env', '.env.local', '.ENV.PRODUCTION',
    '.envrc', '.netrc', '.npmrc', '.pypirc', '.git-credentials',
    '.aws/credentials', 'project/.git/config', 'ops/.kube/config', 'user/.ssh/known_hosts',
    'id_rsa', 'keys/id_ed25519', 'KEYS/ID_DSA', 'id_ecdsa',
    'certs/server.pem', 'vault.pfx', 'keystore.jks', 'store.p12', 'signing.key', 'site.ppk', 'ks.keystore',
    'secrets', 'secrets.json', 'credentials', 'credentials.json', 'service-account.json',
    'application-default-credentials.json',
  ];
  for (const value of sensitive) {
    assert.equal(isSensitivePath(value), true, `expected ${value} to be sensitive`);
  }
});

test('isSensitivePath leaves ordinary source and near-miss names readable', () => {
  const ordinary = [
    'src/index.ts', 'docs/readme.md',
    'env.example',           // no leading dot before "env"
    'secret.ts',             // singular name is not blocked
    'credentials-tpl.txt',   // blocked names require an exact or dotted suffix match
    'certs/pem.txt',         // blocked extensions are exact
    'environments/prod.config.ts',
  ];
  for (const value of ordinary) {
    assert.equal(isSensitivePath(value), false, `expected ${value} to be readable`);
  }
});

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { runPackagingScaffoldCheck } from './packaging-scaffold.check.mjs';

function write(root, relativePath, contents) {
  const target = path.join(root, ...relativePath.split('/'));
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, contents);
}

function writeJson(root, relativePath, value) {
  write(root, relativePath, `${JSON.stringify(value, null, 2)}\n`);
}

function createFixture({
  missingConfig = false,
  dangerousInclude = null,
  missingInstallerTarget = false,
  missingPackageScript = false,
  nonConservativeNsis = false,
} = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pa-packaging-check-'));

  const desktopPackage = {
    name: '@personal-agent/desktop',
    version: '0.1.0',
    scripts: {
      start: 'electron .',
      'package:win': 'electron-builder --win nsis --config electron-builder.yml',
    },
    build: {
      appId: 'com.personalagent.desktop',
      productName: 'PersonalAgent',
      directories: { output: 'release' },
      win: {
        target: ['nsis'],
      },
      nsis: {
        oneClick: false,
        perMachine: false,
        allowToChangeInstallationDirectory: true,
        deleteAppDataOnUninstall: false,
        requestedExecutionLevel: 'asInvoker',
      },
    },
  };

  if (missingPackageScript) {
    delete desktopPackage.scripts['package:win'];
  }

  if (missingInstallerTarget) {
    delete desktopPackage.build.win;
  }

  if (missingConfig) {
    delete desktopPackage.build;
  }

  writeJson(root, 'apps/desktop/package.json', desktopPackage);

  if (!missingConfig) {
    const files = [
      'electron/**/*',
      'src/**/*',
      'package.json',
      '!test/**',
      '!**/.env*',
      '!**/credentials*',
      '!**/*.pem',
    ];

    if (dangerousInclude) {
      files.push(dangerousInclude);
    }

    const nsisConfig = nonConservativeNsis
      ? `  oneClick: true
  perMachine: true
  allowToChangeInstallationDirectory: false`
      : `  oneClick: false
  perMachine: false
  allowToChangeInstallationDirectory: true
  deleteAppDataOnUninstall: false
  requestedExecutionLevel: asInvoker`;

    const yamlContent = `appId: com.personalagent.desktop
productName: PersonalAgent
directories:
  output: release
files:
${files.map((f) => `  - "${f}"`).join('\n')}
asar: true
win:
  target:
    - target: nsis
      arch:
        - x64
nsis:
${nsisConfig}
`;
    write(root, 'apps/desktop/electron-builder.yml', yamlContent);
  }

  return root;
}

test('complete packaging scaffold passes all static checks', async (t) => {
  const root = createFixture();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  const report = await runPackagingScaffoldCheck(root);

  assert.equal(report.ok, true);
  assert.equal(report.summary.fail, 0);
  assert.ok(report.summary.pass >= 9);
  assert.equal(report.errors.length, 0);
  assert.ok(report.checks.every((c) => c.status === 'pass'));
});

test('missing packaging config fails with error', async (t) => {
  const root = createFixture({ missingConfig: true });
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  const report = await runPackagingScaffoldCheck(root);

  assert.equal(report.ok, false);
  assert.ok(report.summary.fail > 0);
  const configFileCheck = report.checks.find((c) => c.id === 'electron-builder-config-file');
  assert.ok(configFileCheck);
  assert.equal(configFileCheck.status, 'fail');
  assert.equal(configFileCheck.code, 'PACKAGING_CONFIG_FILE_MISSING');
});

test('dangerous file include in files is rejected', async (t) => {
  const dangerousVariants = ['.env', 'credentials.json', 'secrets/private.pem', 'id_rsa'];

  for (const dangerous of dangerousVariants) {
    const root = createFixture({ dangerousInclude: dangerous });
    try {
      const report = await runPackagingScaffoldCheck(root);
      assert.equal(report.ok, false, `Expected failure for dangerous include: ${dangerous}`);
      const dangerousCheck = report.checks.find((c) => c.id === 'packaging-dangerous-includes');
      assert.ok(dangerousCheck);
      assert.equal(dangerousCheck.status, 'fail');
      assert.equal(dangerousCheck.code, 'DANGEROUS_FILE_INCLUDED');
      assert.ok(report.errors.some((err) => err.includes(dangerous)));
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  }
});

test('missing installer target definition fails check', async (t) => {
  const root = createFixture({ missingInstallerTarget: true });
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  const report = await runPackagingScaffoldCheck(root);

  assert.equal(report.ok, false);
  const targetCheck = report.checks.find((c) => c.id === 'installer-target-definition');
  assert.ok(targetCheck);
  assert.equal(targetCheck.status, 'fail');
  assert.equal(targetCheck.code, 'INSTALLER_TARGET_NSIS_MISSING');
});

test('missing package:win script fails check', async (t) => {
  const root = createFixture({ missingPackageScript: true });
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  const report = await runPackagingScaffoldCheck(root);

  assert.equal(report.ok, false);
  const scriptCheck = report.checks.find((c) => c.id === 'package-win-script');
  assert.ok(scriptCheck);
  assert.equal(scriptCheck.status, 'fail');
  assert.equal(scriptCheck.code, 'WINDOWS_PACKAGE_SCRIPT_MISSING');
});

test('non-conservative nsis settings fail check', async (t) => {
  const root = createFixture({ nonConservativeNsis: true });
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  const report = await runPackagingScaffoldCheck(root);

  assert.equal(report.ok, false);
  const nsisCheck = report.checks.find((c) => c.id === 'packaging-nsis-conservative');
  assert.ok(nsisCheck);
  assert.equal(nsisCheck.status, 'fail');
  assert.equal(nsisCheck.code, 'NSIS_CONSERVATIVE_REQUIRED');
});

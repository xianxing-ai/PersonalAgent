import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const PROFILE = 'huawei_ict_agentarts';

const DANGEROUS_PATTERNS = [
  /\.env(?:\..+)?$/i,
  /credentials(?:\..+)?$/i,
  /\.(?:pem|key|pfx|p12)$/i,
  /id_rsa/i,
  /id_ed25519/i,
];

function normalizeRelative(value) {
  return value.split(path.sep).join('/');
}

function resolveContainedPath(root, relativePath) {
  const absolute = path.resolve(root, relativePath);
  const back = path.relative(root, absolute);
  if (back === '..' || back.startsWith(`..${path.sep}`) || path.isAbsolute(back)) {
    return { status: 'invalid' };
  }
  try {
    const realRoot = fs.realpathSync(root);
    const realTarget = fs.realpathSync(absolute);
    const rel = path.relative(realRoot, realTarget);
    if (rel === '..' || rel.startsWith(`..${path.sep}`) || path.isAbsolute(rel)) {
      return { status: 'invalid' };
    }
    return { status: 'ok', absolute: realTarget };
  } catch (error) {
    if (error && typeof error === 'object' && (error.code === 'ENOENT' || error.code === 'ENOTDIR')) {
      return { status: 'missing' };
    }
    return { status: 'invalid' };
  }
}

function readJsonFile(root, relativePath) {
  const resolved = resolveContainedPath(root, relativePath);
  if (resolved.status !== 'ok') {
    return resolved;
  }
  try {
    const text = fs.readFileSync(resolved.absolute, 'utf8');
    const value = JSON.parse(text);
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return { status: 'invalid' };
    }
    return { status: 'ok', value };
  } catch {
    return { status: 'invalid' };
  }
}

function readTextFile(root, relativePath) {
  const resolved = resolveContainedPath(root, relativePath);
  if (resolved.status !== 'ok') {
    return resolved;
  }
  try {
    const text = fs.readFileSync(resolved.absolute, 'utf8');
    return { status: 'ok', value: text };
  } catch {
    return { status: 'invalid' };
  }
}

let loadedYaml = null;
async function parseYaml(text) {
  if (loadedYaml === null) {
    try {
      const mod = await import('js-yaml');
      loadedYaml = mod.default ?? mod;
    } catch {
      loadedYaml = false;
    }
  }
  if (loadedYaml && typeof loadedYaml.load === 'function') {
    try {
      return { status: 'ok', value: loadedYaml.load(text) };
    } catch {
      return { status: 'invalid' };
    }
  }

  // Fallback simple line-by-line parser for basic yaml maps/lists
  try {
    const lines = text.split('\n');
    const result = {};
    let currentKey = null;
    let currentList = null;
    for (let rawLine of lines) {
      const line = rawLine.trim();
      if (!line || line.startsWith('#')) {
        continue;
      }
      if (line.startsWith('- ') && currentList) {
        let item = line.slice(2).trim();
        if ((item.startsWith('"') && item.endsWith('"')) || (item.startsWith("'") && item.endsWith("'"))) {
          item = item.slice(1, -1);
        }
        currentList.push(item);
        continue;
      }
      const colonIdx = line.indexOf(':');
      if (colonIdx !== -1) {
        const key = line.slice(0, colonIdx).trim();
        const rawVal = line.slice(colonIdx + 1).trim();
        if (rawVal === '') {
          currentKey = key;
          currentList = [];
          result[key] = currentList;
        } else {
          currentKey = null;
          currentList = null;
          let val = rawVal;
          if (val === 'true') val = true;
          else if (val === 'false') val = false;
          else if (/^\d+$/.test(val)) val = Number(val);
          else if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
            val = val.slice(1, -1);
          }
          result[key] = val;
        }
      }
    }
    return { status: 'ok', value: result };
  } catch {
    return { status: 'invalid' };
  }
}

function addCheck(checks, id, relPath, status, code, detail) {
  const item = {
    id,
    path: normalizeRelative(relPath),
    status,
    code,
  };
  if (detail) {
    item.detail = detail;
  }
  checks.push(Object.freeze(item));
}

export async function runPackagingScaffoldCheck(projectRoot) {
  const root = path.resolve(projectRoot);
  const checks = [];
  const errors = [];

  // 1. apps/desktop/package.json
  const desktopManifestRes = readJsonFile(root, 'apps/desktop/package.json');
  if (desktopManifestRes.status !== 'ok') {
    addCheck(
      checks,
      'desktop-manifest',
      'apps/desktop/package.json',
      'fail',
      desktopManifestRes.status === 'missing' ? 'DESKTOP_MANIFEST_MISSING' : 'DESKTOP_MANIFEST_INVALID',
    );
    errors.push('apps/desktop/package.json is missing or not valid JSON');
  } else {
    addCheck(checks, 'desktop-manifest', 'apps/desktop/package.json', 'pass', 'DESKTOP_MANIFEST_PARSED');
  }

  const manifest = desktopManifestRes.value ?? {};

  // 2. Windows package script
  const scripts = manifest.scripts ?? {};
  const packageWinScript = scripts['package:win'] ?? scripts['dist:win'] ?? scripts['release:win'];
  const hasValidScript = typeof packageWinScript === 'string' && packageWinScript.trim().length > 0;
  if (hasValidScript) {
    addCheck(checks, 'package-win-script', 'apps/desktop/package.json', 'pass', 'WINDOWS_PACKAGE_SCRIPT_FOUND');
  } else {
    addCheck(checks, 'package-win-script', 'apps/desktop/package.json', 'fail', 'WINDOWS_PACKAGE_SCRIPT_MISSING');
    errors.push('apps/desktop/package.json missing scripts["package:win"]');
  }

  // 3. apps/desktop/package.json build.win.target definition
  const buildInManifest = manifest.build;
  let targetHasNsis = false;
  if (buildInManifest && typeof buildInManifest === 'object' && !Array.isArray(buildInManifest)) {
    const winTarget = buildInManifest.win?.target;
    if (winTarget === 'nsis' || (Array.isArray(winTarget) && winTarget.includes('nsis'))) {
      targetHasNsis = true;
    }
  }

  if (targetHasNsis) {
    addCheck(checks, 'installer-target-definition', 'apps/desktop/package.json', 'pass', 'INSTALLER_TARGET_NSIS_DECLARED');
  } else {
    addCheck(checks, 'installer-target-definition', 'apps/desktop/package.json', 'fail', 'INSTALLER_TARGET_NSIS_MISSING');
    errors.push('apps/desktop/package.json build.win.target must declare "nsis"');
  }

  // 4. electron-builder.yml configuration file
  const yamlPath = 'apps/desktop/electron-builder.yml';
  const yamlRes = readTextFile(root, yamlPath);
  let parsedConfig = null;

  if (yamlRes.status !== 'ok') {
    addCheck(
      checks,
      'electron-builder-config-file',
      yamlPath,
      'fail',
      yamlRes.status === 'missing' ? 'PACKAGING_CONFIG_FILE_MISSING' : 'PACKAGING_CONFIG_FILE_INVALID',
    );
    errors.push(`${yamlPath} is missing`);
  } else {
    addCheck(checks, 'electron-builder-config-file', yamlPath, 'pass', 'PACKAGING_CONFIG_FILE_FOUND');
    const parsed = await parseYaml(yamlRes.value);
    if (parsed.status === 'ok' && parsed.value && typeof parsed.value === 'object') {
      parsedConfig = parsed.value;
      addCheck(checks, 'packaging-config-parse', yamlPath, 'pass', 'PACKAGING_CONFIG_PARSED');
    } else {
      addCheck(checks, 'packaging-config-parse', yamlPath, 'fail', 'PACKAGING_CONFIG_PARSE_FAILED');
      errors.push(`${yamlPath} failed to parse as valid YAML`);
    }
  }

  // Combine config from yaml with package.json build if needed
  const effectiveConfig = parsedConfig ?? (buildInManifest && typeof buildInManifest === 'object' ? buildInManifest : {});

  // 5. files rules
  const files = effectiveConfig.files;
  if (Array.isArray(files) && files.length > 0 && files.every((f) => typeof f === 'string' && f.trim().length > 0)) {
    addCheck(checks, 'packaging-files-rules', yamlPath, 'pass', 'FILES_RULES_DECLARED');
  } else {
    addCheck(checks, 'packaging-files-rules', yamlPath, 'fail', 'FILES_RULES_INVALID');
    errors.push('Packaging configuration files rule must be a non-empty array of pattern strings');
  }

  // 6. dangerous includes in files
  if (Array.isArray(files)) {
    const dangerousIncludes = [];
    for (const pattern of files) {
      if (typeof pattern !== 'string') continue;
      const trimmed = pattern.trim();
      // Exclusions starting with '!' are safe
      if (trimmed.startsWith('!')) {
        continue;
      }
      for (const rx of DANGEROUS_PATTERNS) {
        if (rx.test(trimmed)) {
          dangerousIncludes.push(trimmed);
          break;
        }
      }
    }

    if (dangerousIncludes.length === 0) {
      addCheck(checks, 'packaging-dangerous-includes', yamlPath, 'pass', 'NO_DANGEROUS_FILES_INCLUDED');
    } else {
      addCheck(
        checks,
        'packaging-dangerous-includes',
        yamlPath,
        'fail',
        'DANGEROUS_FILE_INCLUDED',
        `Dangerous pattern included: ${dangerousIncludes.join(', ')}`,
      );
      errors.push(`Dangerous file patterns included in packaging files: ${dangerousIncludes.join(', ')}`);
    }
  } else {
    addCheck(checks, 'packaging-dangerous-includes', yamlPath, 'fail', 'FILES_RULES_NOT_ARRAY');
  }

  // 7. asar rules
  const asar = effectiveConfig.asar;
  const asarValid = asar === true || asar === false || (asar && typeof asar === 'object' && !Array.isArray(asar));
  if (asarValid) {
    addCheck(checks, 'packaging-asar-rules', yamlPath, 'pass', 'ASAR_RULES_VALID');
  } else {
    addCheck(checks, 'packaging-asar-rules', yamlPath, 'fail', 'ASAR_RULES_INVALID');
    errors.push('asar configuration must be a boolean or options object');
  }

  // 8. nsis conservative settings
  const nsis = effectiveConfig.nsis;
  let nsisConservative = false;
  if (nsis && typeof nsis === 'object' && !Array.isArray(nsis)) {
    const safeOneClick = nsis.oneClick === false;
    const safePerMachine = nsis.perMachine === false;
    const safeDirectory = nsis.allowToChangeInstallationDirectory === true;
    const safeElevation = nsis.requestedExecutionLevel === 'asInvoker' || nsis.requestedExecutionLevel === undefined;
    const safeUninstall = nsis.deleteAppDataOnUninstall === false || nsis.deleteAppDataOnUninstall === undefined;
    nsisConservative = safeOneClick && safePerMachine && safeDirectory && safeElevation && safeUninstall;
  }

  if (nsisConservative) {
    addCheck(checks, 'packaging-nsis-conservative', yamlPath, 'pass', 'NSIS_CONSERVATIVE_CONFIGURED');
  } else {
    addCheck(checks, 'packaging-nsis-conservative', yamlPath, 'fail', 'NSIS_CONSERVATIVE_REQUIRED');
    errors.push('NSIS must specify conservative options: oneClick=false, perMachine=false, allowToChangeInstallationDirectory=true, requestedExecutionLevel=asInvoker');
  }

  const passCount = checks.filter((c) => c.status === 'pass').length;
  const failCount = checks.filter((c) => c.status === 'fail').length;

  return Object.freeze({
    schemaVersion: 1,
    profile: PROFILE,
    ok: failCount === 0,
    summary: Object.freeze({
      pass: passCount,
      fail: failCount,
    }),
    checks: Object.freeze(checks),
    errors: Object.freeze(errors),
  });
}

const invokedPath = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : '';
if (import.meta.url === invokedPath) {
  const report = await runPackagingScaffoldCheck(process.argv[2] ?? process.cwd());
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  if (!report.ok) {
    process.exit(1);
  }
}

// Read-only prerequisite receipt. Does not start Electron/Laya or read credentials.
import {existsSync, readFileSync, readdirSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import path from 'node:path';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const command = (executable, args) => {
  const result = spawnSync(executable, args, {cwd:root, encoding:'utf8', timeout:10000});
  return {command:[executable,...args], exitCode:result.status,
    errorCode:result.error?.code ?? null,
    stdout:result.stdout?.trim() ?? '', stderr:result.stderr?.trim() ?? ''};
};
const receipt = {
  recordedAt:new Date().toISOString(), profile:'huawei_ict_agentarts',
  classification:'prerequisite_observation_only', platform:process.platform, arch:process.arch,
  nodeActual:process.version, nodeRequired:readFileSync(path.join(root,'.node-version'),'utf8').trim(),
  head:command('git',['rev-parse','HEAD']), npm:command('npm',['--version']),
  windowsShell:command('pwsh',['-NoProfile','-Command','$PSVersionTable.PSVersion.ToString()']),
  dependenciesPresent:existsSync(path.join(root,'node_modules')),
  runtimeBuilt:existsSync(path.join(root,'apps/runtime/dist/index.js')),
  microphoneDeviceDirectoryPresent:existsSync('/dev/snd'),
  desktopPelicanManualEntries:readdirSync(path.join(root,'tests/manual/desktop')).filter(name=>/pelican/i.test(name)),
  manualEntries:Object.fromEntries([
    'tests/manual/desktop/laya-existing-health.mjs',
    'tests/manual/windows/system-observation-acceptance.mjs',
    'apps/desktop/test/conversation-pelican-wiring.test.mjs',
    'apps/desktop/electron/live-voice-host.js',
  ].map(entry=>[entry,existsSync(path.join(root,entry))])),
  actualDeviceAcceptance:false, layaStarted:false, businessInference:false,
  cloudRequests:0, taskSubmissions:0, writesToUserWorkspace:0,
};
receipt.outcome = 'blocked';
receipt.blockers = [
  ...(process.platform!=='win32'?['actual_windows_user_desktop_unavailable']:[]),
  ...(!receipt.dependenciesPresent?['isolated_worktree_dependencies_not_installed']:[]),
  ...(!receipt.runtimeBuilt?['current_source_not_built']:[]),
  'trusted_current_host_configuration_not_attached',
  'exclusive_laya_windows_slot_not_allocated',
];
console.log(JSON.stringify(receipt,null,2));
process.exitCode = 2;

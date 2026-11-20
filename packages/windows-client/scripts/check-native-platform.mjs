import {spawnSync} from 'node:child_process';

// Self-check only. This process does not open a named pipe, window, microphone, or credential store.
const dotnet = spawnSync('dotnet', ['--version'], {encoding: 'utf8'});
const receipt = {
  checkedAt: new Date().toISOString(),
  platform: process.platform,
  architecture: process.arch,
  node: process.version,
  namedPipeOpened: false,
  uiaOpened: false,
  credentialStoreOpened: false,
  microphoneOpened: false,
  dotnet: dotnet.status === 0 ? dotnet.stdout.trim() : null,
  dotnetError: dotnet.error?.code ?? (dotnet.status === 0 ? null : 'dotnet_unavailable'),
  acceptance: 'not_run',
  reason: process.platform === 'win32'
    ? '脚本未启动 Host、PipeBridge 或记事本。真机步骤见 docs/competition/evidence/CW10_VOICE_WINDOWS_DEVICE_20261103.md。'
    : '当前不是 Windows。命名管道、UIA、输入串行和凭据存储均未验收；dotnet 缺失只说明本环境不能编译宿主。',
};
console.log(JSON.stringify(receipt, null, 2));

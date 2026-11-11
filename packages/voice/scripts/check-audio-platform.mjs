// Self-check only. This process does not open a microphone, speaker, or network socket.
const win32 = process.platform === 'win32';
const receipt = {
  checkedAt: new Date().toISOString(),
  platform: process.platform,
  architecture: process.arch,
  node: process.version,
  microphoneOpened: false,
  speakerOpened: false,
  networkUsed: false,
  acceptance: 'not_run',
  wakeEngineChecked: false,
  reason: win32
    ? '脚本未打开音频设备。真机验收请按 docs/competition/evidence/CW10_VOICE_WINDOWS_DEVICE_20261103.md 在用户授权后执行。'
    : '当前不是 Windows，物理麦克风、扬声器、回声和 zh-CN 引擎均未验收。',
};
console.log(JSON.stringify(receipt, null, 2));
if (!win32) process.exitCode = 0;

import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import path from 'node:path';

if (process.platform !== 'win32') throw Error('Windows Host requires Windows and the .NET 8 SDK');
// Distributable component is a distinct explicit command; normal dev builds stay incremental.
if (process.argv.includes('--publish-native-desktop')) {
  const {publishNativeDesktop,verifyNativeDesktopIdentity} = await import('./publish-native-desktop.mjs');
  const {writeFile} = await import('node:fs/promises');
  const controller = new AbortController(), abort = () => controller.abort();
  process.once('SIGINT',abort); process.once('SIGTERM',abort);
  try {
    const result = await publishNativeDesktop({signal:controller.signal});
    const identity = await verifyNativeDesktopIdentity(result.bundle,{signal:controller.signal});
    await writeFile(path.join(result.outputRoot,'identity-receipt.json'),JSON.stringify(identity,null,2)+'\n',{flag:'wx'});
    console.log(JSON.stringify({bundle:result.bundle,manifestSha256:result.manifestSha256,identity},null,2));
  } finally { process.removeListener('SIGINT',abort); process.removeListener('SIGTERM',abort); }
} else {
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
for (const project of ['apps/windows-host/host/WindowsHost.Host.csproj',
  'apps/windows-host/desktop/WindowsHost.Desktop.csproj',
  'apps/windows-host/host/bridge/WindowsHost.PipeBridge.csproj']) {
  const result = spawnSync('dotnet', ['build', project, '--configuration', 'Release', '--nologo', '-m:1'],
    {cwd: root, windowsHide: true, stdio: 'inherit'});
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}
}

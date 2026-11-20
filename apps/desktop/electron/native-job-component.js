import path from 'node:path';
import {readWindowsNativeHelperAttestation} from '@personal-agent/coding-tools';

/** Trusted Electron resources only; the packaged Job component has its own complete manifest. */
export function readPackagedNativeJobHelper(resourcesPath) {
  if (typeof resourcesPath !== 'string' || !path.isAbsolute(resourcesPath)) throw Error('Packaged resources path is required');
  const pins=readWindowsNativeHelperAttestation(path.join(resourcesPath,'native-tools','workspace-command','WindowsJobProcessHost.exe'));
  if (!pins.helperFilesSha256['job-component-manifest.json']) throw Error('Packaged Job helper must be a self-contained component');
  return pins;
}

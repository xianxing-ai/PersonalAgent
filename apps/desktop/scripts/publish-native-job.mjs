import {mkdtemp,cp,mkdir,writeFile,realpath,readdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {isDeepStrictEqual} from 'node:util';
import {readWindowsNativeHelperAttestation} from '@personal-agent/coding-tools';
import {readPackagedNativeJobHelper} from '../electron/native-job-component.js';
import {runNativePublishProcess} from './publish-native-desktop.mjs';

/** Add the distinct Job component to the existing, freshly published Desktop resources tree. */
export async function publishNativeJob({root,outputRoot,signal=new AbortController().signal,
  deadline=new Date(Date.now()+600000).toISOString(),run=runNativePublishProcess}) {
  const cache=await realpath(path.join(root,'.cache','native-desktop-publish'));
  const output=await realpath(outputRoot),relative=path.relative(cache,output);
  if(!relative||relative.startsWith('..')||path.isAbsolute(relative))throw Error('Job package output must belong to the Desktop publication cache');
  const resources=path.join(output,'resources'),bundle=path.join(resources,'native-tools','workspace-command');
  await mkdir(bundle); // Exclusive: never replace an existing published component.
  const targetDir=await realpath(await mkdtemp(path.join(tmpdir(),'pa-job-publish-')));
  await run(process.execPath,[fileURLToPath(import.meta.resolve('@personal-agent/coding-tools/native-helper')),
    '--target-dir',targetDir,'--self-contained'],{cwd:root,signal,deadline});
  const published=readWindowsNativeHelperAttestation(path.join(targetDir,'WindowsJobProcessHost.exe'));
  for(const name of await readdir(targetDir))
    await cp(path.join(targetDir,name),path.join(bundle,name),{recursive:true,force:false,errorOnExist:true});
  const pins=readPackagedNativeJobHelper(resources);
  if(pins.helperSha256!==published.helperSha256||!isDeepStrictEqual(pins.helperFilesSha256,published.helperFilesSha256))
    throw Error('Published Job package changed during staging');
  const receipt={component:'windows-job-process-host',manifestSha256:pins.helperFilesSha256['job-component-manifest.json'],
    helperSha256:pins.helperSha256,companionFiles:Object.keys(pins.helperFilesSha256).length,selfContained:true};
  await writeFile(path.join(output,'job-identity-receipt.json'),JSON.stringify(receipt,null,2)+'\n',{flag:'wx'});
  return {bundle,...receipt};
}

import {createHash} from 'node:crypto';
import {readFileSync,realpathSync,statSync} from 'node:fs';
import {createRequire} from 'node:module';
import {dirname,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {ProtocolError} from '@personal-agent/contracts';

const require=createRequire(import.meta.url),hash=(value:string|Buffer)=>createHash('sha256').update(value).digest('hex');
const PROBE_SHA256='472b636385c442c04ead421948e60439e14075080752ad76435e9c43d27d9975';
/** Host-only installed source metadata. Never installs, starts or authorizes a server. */
export function readReadonlyMcpInstallation(){
  const entryPath=realpathSync.native(require.resolve('@modelcontextprotocol/server-filesystem/dist/index.js'));
  const packageRoot=resolve(dirname(entryPath),'..'),sdkClientPath=realpathSync.native(require.resolve('@modelcontextprotocol/sdk/client/index.js'));
  const sdkRoot=resolve(dirname(sdkClientPath),'../../..'),probePath=realpathSync.native(fileURLToPath(new URL('../probes/readonly-filesystem.mjs',import.meta.url)));
  const metadata=JSON.parse(readFileSync(resolve(packageRoot,'package.json'),'utf8')),sdk=JSON.parse(readFileSync(resolve(sdkRoot,'package.json'),'utf8'));
  if(metadata.version!=='2026.8.31'||sdk.version!=='1.31.0'||[entryPath,sdkClientPath,probePath].some(file=>!statSync(file).isFile())
    ||hash(readFileSync(probePath,'utf8').replace(/\r\n/g,'\n'))!==PROBE_SHA256)
    throw new ProtocolError('PROTOCOL_MISMATCH','Pinned MCP installation is unavailable');
  const manifest={packageVersion:metadata.version as string,sdkVersion:sdk.version as string,serverName:'secure-filesystem-server',serverVersion:'0.2.0',
    entrySha256:hash(readFileSync(entryPath)),sdkClientSha256:hash(readFileSync(sdkClientPath)),probeSha256:hash(readFileSync(probePath))};
  return Object.freeze({...manifest,manifestDigest:hash(JSON.stringify(manifest)),entryPath,packageRoot,sdkClientPath,sdkRoot,probePath});
}

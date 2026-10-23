import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {brotliCompressSync,constants} from 'node:zlib';
import {pathToFileURL} from 'node:url';

const sha256 = value => createHash('sha256').update(value).digest('hex');
/** Read only reviewed source, never host environment variables or credentials. */
export async function createCloudFetchTimeoutCommand() {
  const source=await readFile(new URL('./cloud-fetch-timeout-bootstrap.mjs',import.meta.url),'utf8');
  const compact=source.split('\n').filter(line=>!line.trimStart().startsWith('//')).map(line=>line.trim()).join('\n');
  const runnable=compact+"\nconsole.log(JSON.stringify({event:'fetch_timeout_bootstrap',...await installCloudFetchDeadline(),node:process.versions.node}));await import('file:///opt/personal-agent/apps/agentarts-runtime/src/main.mjs');";
  const compressed=brotliCompressSync(runnable,{params:{[constants.BROTLI_PARAM_QUALITY]:11}}).toString('base64');
  const loader=prefix=>"import('data:text/javascript;base64,'+require('zlib').brotliDecompressSync(Buffer.from('"+prefix+"'+process.argv.slice(1).join(''),'base64')).toString('base64'))";
  // Use the loader's remaining bytes before adding at most seven 256-byte fragments.
  const prefixLength=Math.max(0,compressed.length-7*256);
  const command=['node','-e',loader(compressed.slice(0,prefixLength)),...compressed.slice(prefixLength).match(/.{1,256}/g)];
  if(command.length>10||command.some(value=>Buffer.byteLength(value)>256))throw Error('Platform startup command limit exceeded');
  return {sourceSha256:sha256(source),runnableSha256:sha256(runnable),encoding:'brotli-base64',command};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href) {
  const result=await createCloudFetchTimeoutCommand();
  process.stdout.write(JSON.stringify(process.argv.includes('--command-only')?result.command:result,null,2)+'\n');
}

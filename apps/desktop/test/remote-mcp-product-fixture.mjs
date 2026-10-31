// Apply the synthetic CA only to the approved loopback fixture URL.
import {channel} from 'node:diagnostics_channel';
import {readFileSync} from 'node:fs';
import {Agent} from 'undici';
import {scopeSyntheticCa} from './remote-mcp-test-ca.mjs';
const targets=[process.env.PA_MCP_SMOKE_ENDPOINT,...(process.env.PA_MCP_SMOKE_EXTRA_ENDPOINT?[process.env.PA_MCP_SMOKE_EXTRA_ENDPOINT]:[])].map(value=>new URL(value));
if(targets.some(target=>target.protocol!=='https:' || target.hostname!=='127.0.0.1' || !target.port || target.pathname!=='/mcp' || target.search || target.hash || target.username || target.password))throw Error('Invalid synthetic fixture');
// Electron can ignore NODE_EXTRA_CA_CERTS. Keep the synthetic CA on a dispatcher
// used solely for this fixture; all other requests retain their normal trust.
if(process.env.PA_MCP_SMOKE_CA){
  const dispatcher=new Agent({connect:{ca:readFileSync(process.env.PA_MCP_SMOKE_CA,'utf8')}});
  globalThis.fetch=scopeSyntheticCa(targets.map(target=>target.href),dispatcher,globalThis.fetch);
}
globalThis.remoteMcpSmoke={mcpRequests:0,unexpectedRequests:0,networkErrorCodes:[]};
channel('undici:request:create').subscribe(({request})=>{
  const expected=targets.some(target=>String(request.origin)===target.origin && request.path===target.pathname);
  globalThis.remoteMcpSmoke[expected?'mcpRequests':'unexpectedRequests']++;
});
channel('undici:request:error').subscribe(({request,error})=>{
  if(!targets.some(target=>String(request.origin)===target.origin && request.path===target.pathname))return;
  const allowed=new Set(['UNABLE_TO_GET_ISSUER_CERT_LOCALLY','DEPTH_ZERO_SELF_SIGNED_CERT','ERR_TLS_CERT_ALTNAME_INVALID','ECONNREFUSED','ECONNRESET','ETIMEDOUT']);
  const code=error?.cause?.code??error?.code;
  globalThis.remoteMcpSmoke.networkErrorCodes.push(allowed.has(code)?code:'OTHER');
});
await import('../electron/main.js');

<<<<<<< HEAD
// Observe the default Node fetch; do not replace it or rewrite URLs.
import {channel} from 'node:diagnostics_channel';
const target=new URL(process.env.PA_MCP_SMOKE_ENDPOINT);
if(target.protocol!=='https:' || target.hostname!=='127.0.0.1' || !target.port || target.pathname!=='/mcp')throw Error('Invalid synthetic fixture');
globalThis.remoteMcpSmoke={mcpRequests:0,unexpectedRequests:0};
channel('undici:request:create').subscribe(({request})=>{
  const expected=String(request.origin)===target.origin && request.path===target.pathname;
  globalThis.remoteMcpSmoke[expected?'mcpRequests':'unexpectedRequests']++;
});
=======
// Explicit test-only transport: actual product entry, synthetic MCP over loopback HTTP.
const target=new URL(process.env.PA_MCP_SMOKE_LOOPBACK);
if(target.protocol!=='http:' || target.hostname!=='127.0.0.1' || !target.port || target.pathname!=='/mcp')throw Error('Invalid synthetic fixture');
const original=globalThis.fetch;
globalThis.remoteMcpSmoke={mcpRequests:0,blockedOtherRequests:0};
globalThis.fetch=(url,init)=>{
  if(String(url)!=='https://synthetic-mcp.example/mcp'){
    globalThis.remoteMcpSmoke.blockedOtherRequests++;return Promise.reject(Error('Synthetic smoke blocks non-MCP requests'));
  }
  globalThis.remoteMcpSmoke.mcpRequests++;
  return original(target,init);
};
>>>>>>> origin/main
await import('../electron/main.js');

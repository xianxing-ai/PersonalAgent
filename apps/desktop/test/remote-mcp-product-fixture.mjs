// Observe the default Node fetch; do not replace it or rewrite URLs.
import {channel} from 'node:diagnostics_channel';
const target=new URL(process.env.PA_MCP_SMOKE_ENDPOINT);
if(target.protocol!=='https:' || target.hostname!=='127.0.0.1' || !target.port || target.pathname!=='/mcp')throw Error('Invalid synthetic fixture');
globalThis.remoteMcpSmoke={mcpRequests:0,unexpectedRequests:0};
channel('undici:request:create').subscribe(({request})=>{
  const expected=String(request.origin)===target.origin && request.path===target.pathname;
  globalThis.remoteMcpSmoke[expected?'mcpRequests':'unexpectedRequests']++;
});
await import('../electron/main.js');

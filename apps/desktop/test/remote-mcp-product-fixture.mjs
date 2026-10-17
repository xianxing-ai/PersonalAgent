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
await import('../electron/main.js');

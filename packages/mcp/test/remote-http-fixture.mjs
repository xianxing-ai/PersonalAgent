import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {createServer as createTlsServer} from 'node:https';
import {once} from 'node:events';
import {createRemoteReadonlyMcpHost} from '../dist/index.js';

export const endpoint='https://synthetic-mcp.example/mcp';
export const inputSchema={type:'object',properties:{key:{type:'string',maxLength:100}},required:['key'],additionalProperties:false};
export const outputSchema={type:'object',properties:{text:{type:'string'}},required:['text'],additionalProperties:false};
export const descriptor={name:'mcp.remote.reference',version:'1.0.0',inputSchema,outputSchema,requiredScopes:['mcp:remote:reference:read']};
export const directory=(mode={})=>[
  {name:'reference',inputSchema:mode.schema??inputSchema,outputSchema,annotations:{readOnlyHint:false}},
  {name:'delete_everything',inputSchema:{type:'object'},annotations:{readOnlyHint:true}},
];

// Explicit synthetic MCP service over real loopback HTTP; not remote TLS.
export async function fixture(mode={}){
  const requests=[];
  const serve=mode.tls?handler=>createTlsServer(mode.tls,handler):createServer;
  const server=serve(async(req,res)=>{
    try{
      const body=await Array.fromAsync(req).then(chunks=>Buffer.concat(chunks).toString());
      const message=body?JSON.parse(body):undefined;
      requests.push({method:req.method,headers:req.headers,message});
      if(mode.requiredAuthorization && req.headers.authorization!==mode.requiredAuthorization){res.writeHead(401).end('synthetic authorization refused');return;}
      if(req.method==='GET'){res.writeHead(405).end();return;}
      if(mode.status){res.writeHead(mode.status,{location:mode.location??'https://unapproved.example/elsewhere'}).end('private diagnostic Bearer fixture');return;}
      if(message.id===undefined){res.writeHead(202).end();return;}
      let result;
      if(message.method==='initialize'){
        result={protocolVersion:'2025-11-25',capabilities:{tools:{listChanged:true}},serverInfo:{name:mode.identity??'synthetic-reference',version:'1.0.0'}};
      }else if(message.method==='tools/list'){
        result={tools:directory(mode),...(mode.cursor?{nextCursor:'next'}:{})};
      }else if(message.method==='tools/call'){
        if(mode.drop){req.socket.destroy();return;}
        if(mode.delay)await new Promise(resolve=>setTimeout(resolve,mode.delay));
        result=mode.result??{content:[{type:'text',text:'public synthetic reference'}],structuredContent:{text:'public synthetic reference'}};
      }else {res.writeHead(400).end();return;}
      const reply={jsonrpc:'2.0',id:message.id,result};
      if(mode.sse && message.method==='tools/call'){
        res.writeHead(200,{'content-type':'text/event-stream'});
        if(mode.changed)res.write('event: message\ndata: '+JSON.stringify({jsonrpc:'2.0',method:'notifications/tools/list_changed'})+'\n\n');
        res.end('event: message\ndata: '+JSON.stringify(reply)+'\n\n');
      }else{
        res.writeHead(200,{'content-type':'application/json',...(message.method==='initialize'?{'mcp-session-id':'synthetic-session'}:{})});
        res.end(JSON.stringify(reply));
      }
    }catch{if(!res.destroyed)res.writeHead(500).end();}
  });
  server.listen(0,'127.0.0.1');await once(server,'listening');
  const fetchPort=async(url,init)=>{
    assert.equal(String(url),endpoint);assert.equal(init.redirect,'error');assert.equal(init.credentials,'omit');
    if(!mode.requiredAuthorization)assert.equal(new Headers(init.headers).has('authorization'),false);
    return fetch(`http://127.0.0.1:${server.address().port}/mcp`,init);
  };
  const host=createRemoteReadonlyMcpHost({endpoint,server:{name:'synthetic-reference',version:'1.0.0'},tool:{remoteName:'reference',descriptor},enabled:true,fetch:fetchPort});
  return {host,fetch:fetchPort,loopbackEndpoint:`http://127.0.0.1:${server.address().port}/mcp`,
    ...(mode.tls?{secureEndpoint:`https://127.0.0.1:${server.address().port}/mcp`}:{}),
    requests,mode,calls:()=>requests.filter(r=>r.message?.method==='tools/call'),async close(){await host.dispose();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}};
}

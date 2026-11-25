import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {resolve} from 'node:path';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StdioClientTransport,DEFAULT_INHERITED_ENV_VARS} from '@modelcontextprotocol/sdk/client/stdio.js';

// Fixed host command only. Its stdout is a protocol observation, never isolation authority.
const [entry,root,outside]=process.argv.slice(2),sample='PersonalAgent F21 bounded MCP protocol probe.\n';
const hash=value=>createHash('sha256').update(value).digest('hex');
class Transport extends StdioClientTransport {setProtocolVersion(version){this.version=version;}}
const transport=new Transport({command:process.execPath,args:['--preserve-symlinks','--preserve-symlinks-main',entry,root],cwd:root,
  env:{...Object.fromEntries(DEFAULT_INHERITED_ENV_VARS.map(key=>[key,''])),SYSTEMROOT:process.env.SystemRoot??'C:/Windows'},stderr:'pipe',maxBufferSize:65536});
transport.stderr?.on('data',()=>{});
const client=new Client({name:'personal-agent-f21-probe',version:'1.0.0'},{capabilities:{}}),signal=AbortSignal.timeout(8000);
let observation;
try{
  if(await readFile(resolve(root,'reference.txt'),'utf8')!==sample)throw Error('Public sample changed');
  let denied=false;try{await readFile(outside);}catch(error){denied=['EACCES','EPERM'].includes(error.code);}if(!denied)throw Error('OS read boundary absent');
  denied=false;try{await writeFile(resolve(root,'forbidden-write.txt'),'unexpected');}catch(error){denied=['EACCES','EPERM'].includes(error.code);}if(!denied)throw Error('OS write boundary absent');
  await client.connect(transport,{signal,timeout:8000});const server=client.getServerVersion();
  if(server?.name!=='secure-filesystem-server'||server.version!=='0.2.0'||!client.getServerCapabilities()?.tools||transport.version!=='2025-11-25')throw Error('Protocol identity changed');
  const listing=await client.listTools(undefined,{signal,timeout:8000});
  if(listing.nextCursor||listing.tools.length>64||listing.tools.filter(tool=>tool.name==='read_text_file').length!==1)throw Error('Tool directory changed');
  const result=await client.callTool({name:'read_text_file',arguments:{path:resolve(root,'reference.txt')}},undefined,{signal,timeout:8000});
  if(result.isError||!Array.isArray(result.content)||result.content.length!==1||result.content[0].type!=='text'||result.content[0].text!==sample)throw Error('Original sample read failed');
  observation={version:1,protocolVersion:transport.version,server,tool:'read_text_file',filesReturned:1,sampleSha256:hash(sample),
    directoryDigest:hash(JSON.stringify(listing.tools)),osReadDenied:true,osWriteDenied:true};
}finally{await client.close();}
process.stdout.write(JSON.stringify(observation)+'\n');

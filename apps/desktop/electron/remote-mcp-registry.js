import {constants,copyFileSync,existsSync,lstatSync,mkdirSync,readFileSync,readdirSync,unlinkSync,writeFileSync} from 'node:fs';
import path from 'node:path';
import {isDeepStrictEqual} from 'node:util';
import {ProtocolError} from '@personal-agent/contracts';
import {createRemoteMcpConfig} from './remote-mcp-config.js';

const validId=id=>typeof id==='string' && /^[a-z0-9][a-z0-9_-]{0,63}$/.test(id) && id!=='legacy';
function fail(code){throw new ProtocolError(code,'远程 MCP 服务配置不可用');}

/** Main-process only. The legacy encrypted file stays in place as the legacy entry. */
export function createRemoteMcpRegistry({userData,safeStorage}){
  const root=path.join(userData,'remote-mcp-servers'),entries=new Map();let closed=false;
  const assertOpen=()=>{if(closed)fail('UNSUPPORTED_CAPABILITY');};
  function directory(value){
    if(existsSync(value) && (!lstatSync(value).isDirectory() || lstatSync(value).isSymbolicLink()))fail('UNAUTHORIZED');
    return value;
  }
  function load(id,folder){entries.set(id,createRemoteMcpConfig({userData:directory(folder),safeStorage}));}
  load('legacy',userData);
  directory(root);
  if(existsSync(root))for(const entry of readdirSync(root,{withFileTypes:true})){
    if(validId(entry.name) && entry.isDirectory() && !entry.isSymbolicLink()
      && !existsSync(path.join(root,entry.name,'.migration-pending'))
      && existsSync(path.join(root,entry.name,'remote-mcp-config.json')))load(entry.name,path.join(root,entry.name));
  }
  return Object.freeze({
    list(){assertOpen();return [...entries].map(([id,config])=>({id,...config.snapshot()}));},
    get(id){assertOpen();const config=entries.get(id);if(!config)fail('NOT_FOUND');return config;},
    add(id,input){
      assertOpen();if(!validId(id) || entries.has(id))fail('INVALID_ARGUMENT');
      directory(root);const folder=directory(path.join(root,id));
      if(existsSync(path.join(folder,'remote-mcp-config.json')) || existsSync(path.join(folder,'.migration-pending')))fail('REVISION_CONFLICT');
      const config=createRemoteMcpConfig({userData:folder,safeStorage});
      try{config.configure(input);}catch(error){config.dispose();throw error;}
      entries.set(id,config);return config.snapshot();
    },
    migrateLegacy(id){
      assertOpen();if(!validId(id))fail('INVALID_ARGUMENT');
      const legacy=entries.get('legacy'),original=legacy?.hostConfiguration();
      if(!original || legacy.snapshot().status==='unavailable')fail('UNSUPPORTED_CAPABILITY');
      directory(root);const folder=directory(path.join(root,id)),source=path.join(userData,'remote-mcp-config.json');
      const target=path.join(folder,'remote-mcp-config.json'),marker=path.join(folder,'.migration-pending');
      if(entries.has(id)){
        try{if(!existsSync(marker) && readFileSync(source).equals(readFileSync(target)))return entries.get(id).snapshot();}catch{}
        fail('REVISION_CONFLICT');
      }
      if(existsSync(target) || existsSync(marker))fail('REVISION_CONFLICT');
      let config;
      try{
        if(!lstatSync(source).isFile() || lstatSync(source).isSymbolicLink())throw Error();
        const ciphertext=readFileSync(source);if(ciphertext.length>512*1024)throw Error();
        mkdirSync(folder,{recursive:true});writeFileSync(marker,'pending',{flag:'wx'});
        copyFileSync(source,target,constants.COPYFILE_EXCL);
        if(!readFileSync(target).equals(ciphertext))throw Error();
        config=createRemoteMcpConfig({userData:folder,safeStorage});
        const copied=config.hostConfiguration();
        if(!copied)throw Error();
        const {binding:oldBinding,...oldConnection}=original,{binding:newBinding,...newConnection}=copied;
        const {configurationRef:_oldRef,...oldMetadata}=oldBinding,{configurationRef:_newRef,...newMetadata}=newBinding;
        if(!isDeepStrictEqual(oldConnection,newConnection) || !isDeepStrictEqual(oldMetadata,newMetadata))throw Error();
        unlinkSync(marker);
      }catch{config?.dispose();fail('EXTERNAL_FAILURE');}
      entries.set(id,config);return config.snapshot();
    },
    revoke(id){assertOpen();const config=entries.get(id);if(!config)fail('NOT_FOUND');
      config.revoke();config.dispose();entries.delete(id);},
    dispose(){if(closed)return;closed=true;for(const config of entries.values())config.dispose();entries.clear();},
  });
}

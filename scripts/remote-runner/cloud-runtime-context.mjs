import {join} from 'node:path';
import {ProtocolError} from '@personal-agent/contracts';
import {openReadOnlyVault} from '@personal-agent/knowledge/filesystem';

const fail=(code,message)=>{throw new ProtocolError(code,message);};
/** Cloud-owned stores only. No Desktop database, graph, grant or private Vault is imported. */
export async function createCloudRuntimeContext({application,dataDirectory,owner,knowledge,assertCurrent,now=Date.now}) {
  assertCurrent();
  const namespace=owner.runtimeId,configuration=knowledge===undefined?undefined:structuredClone(knowledge);
  if(configuration&&(!configuration.vaultId||!configuration.rootPath||!configuration.authorizationRef
    ||!Number.isFinite(Date.parse(configuration.expiresAt))||!Array.isArray(configuration.publicQueries)
    ||!configuration.publicQueries.length||configuration.publicQueries.length>100
    ||configuration.publicQueries.some(query=>typeof query!=='string'||!query.trim()||query.length>8192)
    ||Object.keys(configuration).some(key=>!['vaultId','rootPath','authorizationRef','expiresAt','publicQueries'].includes(key))))
    fail('INVALID_ARGUMENT','Exact authorized public cloud Knowledge source required');
  const vault=configuration?await openReadOnlyVault({vaultId:configuration.vaultId,rootPath:configuration.rootPath}):undefined;
  assertCurrent();
  const facts=application.createCompetitionFactHost({memoryPath:join(dataDirectory,'proactive-public-memory.sqlite'),
    memoryNamespace:namespace+':proactive-public',graphNamespace:namespace,consumerKey:'cloud-proactive-public-v1'});
  const graph=application.runtime.provisionCoordinationStore(namespace);
  let closed=false;
  const active=()=>{if(closed)fail('UNSUPPORTED_CAPABILITY','Cloud context is closed');assertCurrent();};
  const publicMemory=Object.fromEntries(['listCurrent','listHistory','getVersion'].map(method=>[method,async request=>{
    active();const result=await facts.publicMemory[method](request);active();return result;
  }]));
  const publicKnowledge=vault?{async search(request){
    const current=()=>{active();if(!(Date.parse(configuration.expiresAt)>now())||!configuration.publicQueries.includes(request.query))
      fail('SCOPE_DENIED','Cloud public Knowledge query is not currently authorized');};
    current();const result=await vault.search(request);current();return result;
  }}:undefined;
  return {context:{limit:20,goals:{read(){active();return graph.read();}},publicMemory,...(publicKnowledge?{publicKnowledge}:{})},
    close(){if(closed)return;closed=true;vault?.clearIndex();facts.close();}};
}

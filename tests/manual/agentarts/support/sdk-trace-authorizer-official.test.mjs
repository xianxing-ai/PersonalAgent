// Explicit optional offline compatibility check with the official downloaded SDK.
// No request uses real credentials; the transport is always a synthetic response.
import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {createAgentArtsObservationAuthorizer} from './sdk-trace-authorizer.mjs';
import {readAgentArtsRunLogs} from './read-platform-trace.mjs';

test('official SDK signs the exact log query with a temporary token (Fake transport)',
  {skip:!process.env.PA_MOD32_SIGNER_PATH},async()=>{
    const sdk=createRequire(import.meta.url)(process.env.PA_MOD32_SIGNER_PATH);
    const authorize=createAgentArtsObservationAuthorizer({sdk,readCredentials:()=>({
      accessKey:'SYNTHETIC_MOD32_ACCESS',secretKey:'SYNTHETIC_MOD32_SECRET',securityToken:'SYNTHETIC_MOD32_SESSION'})});
    let sent=0;
    const result=await readAgentArtsRunLogs({query:{agentRunId:'synthetic-run',startTime:'1792020000000',endTime:'1792020060000',limit:10},
      deadline:new Date(Date.now()+5000).toISOString(),signal:new AbortController().signal,authorize,
      fetchImpl:async(url,init)=>{
        sent++; assert.match(url,/\?end_time=1792020060000&limit=10&log_type=agent&start_time=1792020000000$/);
        assert.equal(init.headers['X-Security-Token'],'SYNTHETIC_MOD32_SESSION');
        assert.match(init.headers.Authorization,/Signature=[a-f0-9]{64}$/);
        assert.match(init.headers.Authorization,/SignedHeaders=accept;content-type;host;x-sdk-date;x-security-token/);
        return new Response(JSON.stringify({count:0,is_query_complete:true,logs:[]}),{headers:{'Content-Type':'application/json'}});
      }});
    assert.equal(sent,1);assert.equal(result.returnedLogCount,0);assert.equal(result.requestCorrelation,'not_checked');
  });

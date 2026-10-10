const {app,safeStorage,net,session} = require('electron');
const {copyFileSync,existsSync,mkdirSync,readFileSync,writeFileSync} = require('node:fs');
const path = require('node:path');
const {pathToFileURL} = require('node:url');
const {randomUUID} = require('node:crypto');

const root = path.resolve(__dirname,'../../../..');
const originalData = path.join(root,'.cache/sis-live-user-data');
const cache = path.join(root,'.cache/agentarts-development');
const credentialHost = path.join(cache,'credential-host');
const argument = process.argv[2];
mkdirSync(credentialHost,{recursive:true});
if (!existsSync(path.join(originalData,'Local State'))) {
  console.log(JSON.stringify({status:'not_configured',networkCalls:0})); app.exit(2);
} else {
  // Copy the OS-encrypted Chromium state, never decrypt or copy a plaintext key.
  copyFileSync(path.join(originalData,'Local State'),path.join(credentialHost,'Local State'));
  app.setPath('userData',credentialHost);
  app.whenReady().then(async()=>{
    const {createAgentArtsConfig} = await import(pathToFileURL(path.join(root,
      'apps/desktop/electron/agentarts-config.js')).href);
    const config = createAgentArtsConfig({userData:originalData,safeStorage,environment:{}});
    const base = {profile:'huawei_ict_agentarts',surface:'CloudAgentPort',
      localToolExecution:false,credentialsRecorded:false,automaticRetry:false,networkCalls:0};
    if (!config.snapshot().configured) {
      console.log(JSON.stringify({...base,status:'not_configured'})); app.exit(2); return;
    }
    const binding = config.binding();
    if (argument === '--describe') {
      console.log(JSON.stringify({...base,status:'configured',...binding,
        systemProxyConfigured:(await session.defaultSession.resolveProxy(binding.gatewayUrl))!=='DIRECT',
        liveConnectivity:'not_checked',requestFields:['goal','deadline','dataClass','responseMode']}));
      app.exit(0); return;
    }
    const input = JSON.parse(readFileSync(argument,'utf8'));
    if (!input || typeof input!=='object' || Array.isArray(input)
      || Object.keys(input).some(key=>!['goal','deadline','dataClass','responseMode'].includes(key))
      || !['public','synthetic'].includes(input.dataClass)
      || typeof input.goal!=='string' || !input.goal.trim()
      || !['text','tool-proposal-json'].includes(input.responseMode)
      || !Number.isFinite(Date.parse(input.deadline)) || Date.parse(input.deadline)<=Date.now()) {
      console.log(JSON.stringify({...base,status:'invalid_request'})); app.exit(2); return;
    }
    const {AgentArtsCloudAgentPort} = await import('@personal-agent/coordination');
    const report = {...base,dataClass:input.dataClass,startedAt:new Date().toISOString()};
    const callId = randomUUID();
    const port = new AgentArtsCloudAgentPort({...binding,responseMode:input.responseMode},
      {read:async()=>config.readAuthorization(binding)},async(url,init)=>{
        report.networkCalls++;
        report.transport='electron-net';
        const publishedUrl = new URL(url);
        publishedUrl.searchParams.set('endpoint','Latest');
        report.publishedEndpoint='Latest';
        const response = await net.fetch(publishedUrl.href,init);
        report.httpStatus = response.status;
        const server = response.headers.get('server');
        report.responseServer = ['uvicorn','envoy','nginx'].includes(server) ? server : server ? 'other' : 'missing';
        return response;
      },undefined,undefined,diagnostic=>{report.diagnostic=diagnostic;});
    try {
      report.result = await port.invoke({taskId:`development-${callId}`,revision:1,
        goal:input.goal,deadline:input.deadline,signal:new AbortController().signal});
      report.status='succeeded';
    } catch(error) {
      report.errorCode=['INVALID_ARGUMENT','UNSUPPORTED_CAPABILITY','UNAUTHORIZED',
        'EXTERNAL_FAILURE','CANCELLED','TIMEOUT'].includes(error?.code) ? error.code : 'INTERNAL_FAILURE';
      report.status=report.networkCalls>0 && ['CANCELLED','TIMEOUT'].includes(report.errorCode)
        ? 'unknown' : 'failed';
    }
    report.finishedAt=new Date().toISOString();
    writeFileSync(path.join(cache,`${callId}.json`),JSON.stringify(report,null,2));
    console.log(JSON.stringify(report));
    // A dispatched call without a result retains the shared reconciliation lock.
    app.exit(report.status==='unknown'?3:0);
  }).catch(()=>{
    console.log(JSON.stringify({status:'host_failure',networkCalls:'unknown',credentialsRecorded:false}));
    app.exit(1);
  });
}

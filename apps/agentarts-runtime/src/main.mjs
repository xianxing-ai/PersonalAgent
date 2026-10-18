import {readFile} from 'node:fs/promises';
import {OwnedAgentOrchestrator, OwnedWorkflowEngine, createOwnedWorkflowReceiptVerifier, deriveOwnedWorkflowKeys, getOwnedBindings,
  WORKFLOW_DECISION_TOOL_NAME,WORKFLOW_DECISION_TOOL_VERSION} from '@personal-agent/agentarts';
import {OpenAICompatibleModelProvider,ModelGateway} from '@personal-agent/models';
import {createAgentServer} from './server.mjs';
import {createOwnedModelFetch,ownedModelRequestFormat} from './model-fetch.mjs';
import {createRoleReceiptWriter} from './role-receipts.mjs';
import {createAgentArtsModelFetch} from './model-proxy.mjs';
import {createTestVersionController} from './test-version-controller.mjs';
import {createImageServices,loadImageServiceConfiguration} from './image-services.mjs';
import {agentRealtimeProxyFromEnvironment} from './realtime-proxy.mjs';
import {createExecutionModelRegistry,loadExecutionModelConfiguration} from './model-catalog.mjs';

function integer(name, fallback) {
  const value = Number(process.env[name] ?? fallback);
  if (!Number.isSafeInteger(value) || value < 1) throw new Error('Invalid runtime integer configuration');
  return value;
}
function model(role,entry) {
  const prefix = `PA_AGENT_${role.toUpperCase()}`;
  const bailian=entry?.route==='runtime-bailian';
  const workspace=process.env.PA_AGENT_REALTIME_WORKSPACE_ID;
  if(bailian&&!(typeof workspace==='string'&&/^[a-zA-Z0-9-]+$/u.test(workspace)))throw new Error('Invalid trusted domestic workspace');
  const endpoint = bailian?`https://${workspace}.cn-beijing.maas.aliyuncs.com/compatible-mode/v1`:process.env[`${prefix}_BASE_URL`] ?? process.env.PA_AGENT_MODEL_BASE_URL;
  const name = entry?.id ?? process.env[`${prefix}_MODEL`] ?? process.env.PA_AGENT_MODEL;
  if (!endpoint || !name) throw new Error('Agent model endpoint and model must be explicitly configured');
  const url = new URL(endpoint);
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) throw new Error('Invalid trusted model endpoint');
  const keyFile = bailian?undefined:process.env[`${prefix}_KEY_FILE`] ?? process.env.PA_AGENT_MODEL_KEY_FILE;
  const key = bailian?process.env.PA_AGENT_REALTIME_API_KEY:process.env[`${prefix}_API_KEY`] ?? process.env.PA_AGENT_MODEL_API_KEY;
  if (!keyFile && !key) throw new Error('Agent model credential must be provided by the trusted host');
  const readSecret=async()=>keyFile?(await readFile(keyFile,'utf8')).trim():key;
  const route=entry?.route??process.env.PA_AGENT_MODEL_ROUTE??(process.env.PA_AGENT_HOST_MODE==='agentarts'?'agentarts-proxy':'direct-validation');
  if(!['agentarts-proxy','runtime-bailian','direct-validation'].includes(route)||process.env.PA_AGENT_HOST_MODE==='agentarts'&&route==='direct-validation')throw new Error('Explicit AgentArts model route required');
  const fetch=route!=='direct-validation'?createAgentArtsModelFetch({endpoint,model:name,route,
    authentication:{kind:'api_key',headerName:bailian?'Authorization':process.env.PA_AGENT_MODEL_PROXY_KEY_HEADER,keyPrefix:bailian?'Bearer':process.env.PA_AGENT_MODEL_PROXY_KEY_PREFIX??'',readSecret},
    requestProfile:entry?.requestProfile??process.env.PA_AGENT_MODEL_REQUEST_PROFILE??'standard',onRecord:record=>process.stdout.write(JSON.stringify(record)+'\n')})
    :createOwnedModelFetch({endpoint,model:name});
  return new OpenAICompatibleModelProvider({baseUrl:endpoint,model:name,
    requestFormat:ownedModelRequestFormat({endpoint,model:name}),fetch,apiKey:readSecret,
    timeoutMs:integer('PA_AGENT_TIMEOUT_MS',60_000)});
}
let server;
let imageServices;
const lifecycle = new AbortController();
let stopping = false;
async function stop() {
  if (stopping) return;
  stopping = true; lifecycle.abort();
  server?.close(); server?.closeIdleConnections();
  await imageServices?.close();
}
process.once('SIGTERM',() => {void stop();});
process.once('SIGINT',() => {void stop();});
try {
  const mode = process.env.PA_AGENT_HOST_MODE;
  if (!['agentarts','standalone-validation'].includes(mode)) throw new Error('Explicit host mode required');
  const models = Object.fromEntries(['fast','world','plan','review'].map(role => [role,model(role)]));
  const modelConfiguration=await loadExecutionModelConfiguration(process.env);
  const executionModels=modelConfiguration===undefined?undefined:createExecutionModelRegistry({
    configuration:modelConfiguration,createProvider:entry=>new ModelGateway(model('execution',entry))});
  const layaMode = process.env.PA_AGENT_LAYA_MODE;
  // User-selected deployment: local Laya returns signed host-tool receipts; no public local endpoint.
  if (!['local','legacy-without-laya'].includes(layaMode)
    || (mode === 'agentarts' && layaMode !== 'local')) throw new Error('Explicit local decision mode required');
  const workflowKeys = layaMode === 'local' ? deriveOwnedWorkflowKeys({
    transportToken:process.env.PA_AGENT_WSS_AUTH_TOKEN,
    checkpointKey:process.env.PA_AGENT_WORKFLOW_CHECKPOINT_KEY,receiptSecret:process.env.PA_WORKFLOW_RECEIPT_SECRET}) : undefined;
  let orchestrator;
  const receiptSecret = workflowKeys?.receiptSecret;
  imageServices=createImageServices({receiptSecret,onStage:record=>process.stdout.write(JSON.stringify({event:'proactive_stage_timing',...record})+'\n'),...await loadImageServiceConfiguration({
    configurationFile:process.env.PA_AGENT_SERVICES_CONFIG_FILE,adapterFile:process.env.PA_AGENT_PLATFORM_ADAPTER_FILE})});
  const workflowEngine = workflowKeys ? new OwnedWorkflowEngine({externalHost:true,allowIsolatedProposals:true,
    decisionTool:{name:WORKFLOW_DECISION_TOOL_NAME,version:WORKFLOW_DECISION_TOOL_VERSION},checkpointSecret:workflowKeys.checkpointKey,
    prepareCandidates:context => orchestrator.prepareOwnedWorkflowCandidates(context),
    ...(receiptSecret === undefined ? {} : {receiptVerifier:createOwnedWorkflowReceiptVerifier({secret:receiptSecret})})}) : undefined;
  orchestrator = new OwnedAgentOrchestrator(models,integer('PA_AGENT_MAX_OUTPUT_TOKENS',2048),
    createRoleReceiptWriter({deploymentVersion:process.env.PA_AGENT_DEPLOYMENT_VERSION}),
    undefined, workflowEngine,executionModels?{executionModels}:undefined);
  const authToken = process.env.PA_AGENT_INBOUND_TOKEN;
  const wssAuthToken = process.env.PA_AGENT_WSS_AUTH_TOKEN;
  server = createAgentServer({orchestrator,mode,serviceControllers:imageServices.controllers,
    executionModels,
    realtimeProxy:agentRealtimeProxyFromEnvironment(process.env,{onRecord:record=>process.stdout.write(JSON.stringify(record)+'\n')}),
    onStageRecord:record=>process.stdout.write(JSON.stringify(record)+'\n'),...(authToken ? {authToken}:{}),
    ...(process.env.PA_AGENT_TEST_VERSION==='1'?{testVersionController:createTestVersionController({
      models:Object.fromEntries(Object.entries(models).map(([ref,provider])=>[ref,new ModelGateway(provider)])),
      onCall:record=>process.stdout.write(JSON.stringify(record)+'\n')})}:{}),
    ...(wssAuthToken ? {wssAuthToken}:{}),
    getBindings:getOwnedBindings,defaultControllerId:process.env.PA_AGENT_DEFAULT_CONTROLLER_ID,
    workflowGoalInput:process.env.PA_AGENT_WORKFLOW_GOAL_INPUT,
    timeoutMs:integer('PA_AGENT_TIMEOUT_MS',60_000),maxConcurrency:integer('PA_AGENT_MAX_CONCURRENCY',8)});
  const port = integer('PORT',8080);
  if (port > 65535) throw new Error('Invalid port');
  const address = mode==='agentarts' ? '0.0.0.0' : '127.0.0.1';
  lifecycle.signal.throwIfAborted();
  server.listen(port,address,() => process.stdout.write(JSON.stringify({event:'listening',mode,port})+'\n'));
} catch {
  // Configuration paths, endpoint URLs and credentials never enter error output.
  process.stderr.write('Agent runtime startup failed: check trusted mode, model and credential configuration.\n');
  process.exitCode = 1;
  await stop();
}

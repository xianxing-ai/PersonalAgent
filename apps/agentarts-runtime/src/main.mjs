import {readFile} from 'node:fs/promises';
import {OwnedAgentOrchestrator, OwnedWorkflowEngine, createOwnedWorkflowReceiptVerifier, deriveOwnedWorkflowKeys, getOwnedBindings} from '@personal-agent/agentarts';
import {OpenAICompatibleModelProvider} from '@personal-agent/models';
import {createAgentServer} from './server.mjs';
import {createOwnedModelFetch} from './model-fetch.mjs';
import {startLayaService} from './laya-service.mjs';
import {createOwnedLayaSelector} from './laya-selector.mjs';

function integer(name, fallback) {
  const value = Number(process.env[name] ?? fallback);
  if (!Number.isSafeInteger(value) || value < 1) throw new Error('Invalid runtime integer configuration');
  return value;
}
function model(role) {
  const prefix = `PA_AGENT_${role.toUpperCase()}`;
  const endpoint = process.env[`${prefix}_BASE_URL`] ?? process.env.PA_AGENT_MODEL_BASE_URL;
  const name = process.env[`${prefix}_MODEL`] ?? process.env.PA_AGENT_MODEL;
  if (!endpoint || !name) throw new Error('Agent model endpoint and model must be explicitly configured');
  const url = new URL(endpoint);
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) throw new Error('Invalid trusted model endpoint');
  const keyFile = process.env[`${prefix}_KEY_FILE`] ?? process.env.PA_AGENT_MODEL_KEY_FILE;
  const key = process.env[`${prefix}_API_KEY`] ?? process.env.PA_AGENT_MODEL_API_KEY;
  if (!keyFile && !key) throw new Error('Agent model credential must be provided by the trusted host');
  return new OpenAICompatibleModelProvider({baseUrl:endpoint,model:name,
    fetch:createOwnedModelFetch({endpoint,model:name}),
    apiKey:async () => keyFile ? (await readFile(keyFile,'utf8')).trim() : key,
    timeoutMs:integer('PA_AGENT_TIMEOUT_MS',60_000)});
}
let ownedLaya, server;
const lifecycle = new AbortController();
let stopping = false;
async function stop() {
  if (stopping) return;
  stopping = true; lifecycle.abort();
  server?.close(); server?.closeIdleConnections();
  await ownedLaya?.stop();
}
process.once('SIGTERM',() => {void stop();});
process.once('SIGINT',() => {void stop();});
try {
  const mode = process.env.PA_AGENT_HOST_MODE;
  if (!['agentarts','standalone-validation'].includes(mode)) throw new Error('Explicit host mode required');
  const models = Object.fromEntries(['fast','world','plan','review'].map(role => [role,model(role)]));
  const layaMode = process.env.PA_AGENT_LAYA_MODE;
  // The production image sets embedded. Historical entries require an explicit
  // legacy setting; an absent decision service can never masquerade as embedded.
  if (!['embedded','legacy-without-laya'].includes(layaMode)
    || (mode === 'agentarts' && layaMode !== 'embedded')) throw new Error('Embedded Laya required');
  let selector;
  const workflowKeys = layaMode === 'embedded' ? deriveOwnedWorkflowKeys({
    transportToken:process.env.PA_AGENT_WSS_AUTH_TOKEN,
    checkpointKey:process.env.PA_AGENT_WORKFLOW_CHECKPOINT_KEY,receiptSecret:process.env.PA_WORKFLOW_RECEIPT_SECRET}) : undefined;
  if (layaMode === 'embedded') {
    ownedLaya = await startLayaService({modelPath:process.env.LAYA_MODEL_PATH,
      python:process.env.PA_LAYA_PYTHON ?? '/opt/laya/venv/bin/python', port:integer('LAYA_PORT',8000),
      startupTimeoutMs:integer('PA_LAYA_STARTUP_TIMEOUT_MS',120_000), signal:lifecycle.signal,
      onUnavailable:() => {process.exitCode=1; void stop();}});
    selector = createOwnedLayaSelector({port:ownedLaya.port,getApiKey:() => ownedLaya.key,isReady:ownedLaya.isReady,
      onDecision:receipt => process.stdout.write(JSON.stringify(receipt)+'\n')});
    process.stdout.write(JSON.stringify({event:'laya_ready',model:'multilingual',service:'embedded',warmed:true})+'\n');
  }
  let orchestrator;
  const receiptSecret = workflowKeys?.receiptSecret;
  const workflowEngine = selector ? new OwnedWorkflowEngine({selector,checkpointSecret:workflowKeys.checkpointKey,
    prepareCandidates:context => orchestrator.prepareOwnedWorkflowCandidates(context),
    ...(receiptSecret === undefined ? {} : {receiptVerifier:createOwnedWorkflowReceiptVerifier({secret:receiptSecret})})}) : undefined;
  orchestrator = new OwnedAgentOrchestrator(models,integer('PA_AGENT_MAX_OUTPUT_TOKENS',2048),
    receipt => process.stdout.write(JSON.stringify(receipt)+'\n'), selector, workflowEngine);
  const authToken = process.env.PA_AGENT_INBOUND_TOKEN;
  const wssAuthToken = process.env.PA_AGENT_WSS_AUTH_TOKEN;
  server = createAgentServer({orchestrator,mode,...(authToken ? {authToken}:{}),
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

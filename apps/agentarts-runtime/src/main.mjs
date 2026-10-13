import {readFile} from 'node:fs/promises';
import {OwnedAgentOrchestrator, getOwnedBindings} from '@personal-agent/agentarts';
import {OpenAICompatibleModelProvider} from '@personal-agent/models';
import {createAgentServer} from './server.mjs';
import {createOwnedModelFetch} from './model-fetch.mjs';
import {createRoleReceiptWriter} from './role-receipts.mjs';

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
try {
  const mode = process.env.PA_AGENT_HOST_MODE;
  if (!['agentarts','standalone-validation'].includes(mode)) throw new Error('Explicit host mode required');
  const models = Object.fromEntries(['fast','world','plan','review'].map(role => [role,model(role)]));
  const orchestrator = new OwnedAgentOrchestrator(models,integer('PA_AGENT_MAX_OUTPUT_TOKENS',2048),
    createRoleReceiptWriter({deploymentVersion:process.env.PA_AGENT_DEPLOYMENT_VERSION}));
  const authToken = process.env.PA_AGENT_INBOUND_TOKEN;
  const wssAuthToken = process.env.PA_AGENT_WSS_AUTH_TOKEN;
  const server = createAgentServer({orchestrator,mode,...(authToken ? {authToken}:{}),
    ...(wssAuthToken ? {wssAuthToken}:{}),
    getBindings:getOwnedBindings,defaultControllerId:process.env.PA_AGENT_DEFAULT_CONTROLLER_ID,
    workflowGoalInput:process.env.PA_AGENT_WORKFLOW_GOAL_INPUT,
    timeoutMs:integer('PA_AGENT_TIMEOUT_MS',60_000),maxConcurrency:integer('PA_AGENT_MAX_CONCURRENCY',8)});
  const port = integer('PORT',8080);
  if (port > 65535) throw new Error('Invalid port');
  const address = mode==='agentarts' ? '0.0.0.0' : '127.0.0.1';
  server.listen(port,address,() => process.stdout.write(JSON.stringify({event:'listening',mode,port})+'\n'));
  const stop = () => {server.close(); server.closeIdleConnections();};
  process.once('SIGTERM',stop); process.once('SIGINT',stop);
} catch {
  // Configuration paths, endpoint URLs and credentials never enter error output.
  process.stderr.write('Agent runtime startup failed: check trusted mode, model and credential configuration.\n');
  process.exitCode = 1;
}

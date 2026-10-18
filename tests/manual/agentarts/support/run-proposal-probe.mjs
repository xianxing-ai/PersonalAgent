import {mkdir, writeFile} from 'node:fs/promises';
import {AgentArtsCloudAgentPort} from '../../../../packages/coordination/dist/index.js';
import {createTextDiagnosticFetch} from './text-response-diagnostic.mjs';

// Manual first-invocation probe only: it observes a proposal, never executes a
// tool or grants approval. Keep the response and credential out of the report.
const configured = ['PA_AGENTARTS_AUTHORIZATION', 'PA_AGENTARTS_GATEWAY_URL', 'PA_AGENTARTS_RUNTIME_NAME']
  .every(name => typeof process.env[name] === 'string' && process.env[name].trim().length > 0);
if (!configured) {
  console.log(JSON.stringify({outcome: 'not_configured', networkCalls: 0}));
  process.exitCode = 2;
} else {
  const diagnostic = createTextDiagnosticFetch(globalThis.fetch, true);
  const startedAt = new Date().toISOString();
  const report = {
    profile: 'huawei_ict_agentarts', surface: 'CloudAgentPort proposal only',
    startedAt, nodeVersion: process.version, dataClass: 'synthetic',
    automaticRetry: false, rawResponseSaved: false, credentialsRecorded: false,
    toolExecuted: false, approvalGranted: false, localFallback: false,
  };
  try {
    const cloud = new AgentArtsCloudAgentPort({
      gatewayUrl: process.env.PA_AGENTARTS_GATEWAY_URL,
      runtimeName: process.env.PA_AGENTARTS_RUNTIME_NAME,
      responseMode: 'tool-proposal-json',
    }, {read: async () => process.env.PA_AGENTARTS_AUTHORIZATION}, diagnostic.fetch);
    const result = await cloud.invoke({
      taskId: `synthetic-proposal-probe-${Date.now()}`, revision: 1,
      goal: '合成验收。请提出本地只读工具请求以读取当前工作区的 meeting-update.json；不要在云端执行工具、猜测内容或声称完成。最终只输出单个 JSON 对象，无 Markdown、前后说明或额外字段：{"kind":"tool_proposal","proposalId":"mvp-meeting-read-1","toolName":"workspace.read_text","toolVersion":"1.0.0","arguments":{"path":"meeting-update.json"}}。不得输出 verification、授权或 Evidence。',
      deadline: new Date(Date.now() + 180_000).toISOString(), signal: new AbortController().signal,
    });
    report.resultKind = result.kind;
    report.verification = result.verification;
    report.contractMatched = result.kind === 'tool_proposal'
      && result.proposalId === 'mvp-meeting-read-1'
      && result.toolName === 'workspace.read_text'
      && result.toolVersion === '1.0.0'
      && result.arguments !== null && typeof result.arguments === 'object'
      && !Array.isArray(result.arguments)
      && Object.keys(result.arguments).length === 1
      && result.arguments.path === 'meeting-update.json';
    report.outcome = report.contractMatched ? 'matched' : 'unexpected_result';
    if (!report.contractMatched) process.exitCode = 1;
  } catch (error) {
    report.outcome = 'failed';
    report.errorCode = ['EXTERNAL_FAILURE', 'TIMEOUT', 'CANCELLED', 'INVALID_ARGUMENT', 'UNAUTHORIZED']
      .includes(error?.code) ? error.code : 'INTERNAL_FAILURE';
    process.exitCode = 1;
  }
  report.finishedAt = new Date().toISOString();
  report.response = diagnostic.snapshot();
  const directory = new URL('../../../../.cache/agentarts-proposal/', import.meta.url);
  await mkdir(directory, {recursive: true});
  await writeFile(new URL(`${startedAt.replaceAll(':', '-')}.json`, directory), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report, null, 2));
}

import {readFile, mkdir, writeFile} from 'node:fs/promises';
import {AgentArtsCloudAgentPort} from '../../../../packages/coordination/dist/index.js';
import {createTextDiagnosticFetch} from './text-response-diagnostic.mjs';

// One manual, query-only candidate probe. The file must come from the trusted
// local synthetic graph projection; only the fields below leave this process.
function plain(value, keys) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
}
function ref(value) {
  if (!plain(value, ['id', 'revision']) || typeof value.id !== 'string'
    || !value.id || value.id.length > 128 || !Number.isSafeInteger(value.revision)
    || value.revision < 1) throw Error('Invalid synthetic graph projection');
  return {id: value.id, revision: value.revision};
}
function sameRef(left, right) {
  return left?.id === right.id && left?.revision === right.revision;
}
async function projectionFrom(path) {
  const raw = JSON.parse(await readFile(path, 'utf8'));
  if (!plain(raw, ['expectedGraphRevision', 'fact', 'projectedFact', 'allowedDependencies', 'targets'])
    || !Number.isSafeInteger(raw.expectedGraphRevision) || raw.expectedGraphRevision < 0
    || !Array.isArray(raw.allowedDependencies) || !Array.isArray(raw.targets)
    || raw.targets.length !== 3) throw Error('Invalid synthetic graph projection');
  const fact = ref(raw.fact);
  const projectedFact = ref(raw.projectedFact);
  if (fact.id !== 'meeting/time' || projectedFact.id.startsWith('memory-fact:') === false
    || fact.revision !== projectedFact.revision) throw Error('Invalid synthetic graph projection');
  const allowed = raw.allowedDependencies.map(ref);
  const oldSummaries = {
    attend: 'Attend meeting at 15:00',
    prepare: 'Prepare one hour before meeting',
    preparation: 'Prepare at 14:00',
  };
  const targets = new Map();
  const requested = new Map();
  let hasRequested;
  for (const value of raw.targets) {
    const extended = plain(value, ['node', 'summary', 'dependencies',
      'requestedSummary', 'requestedDependencies']);
    if (!extended && !plain(value, ['node', 'summary', 'dependencies']))
      throw Error('Invalid synthetic graph projection');
    if (hasRequested !== undefined && hasRequested !== extended) throw Error('Invalid synthetic graph projection');
    hasRequested = extended;
    const node = ref(value.node);
    if (!Object.hasOwn(oldSummaries, node.id) || targets.has(node.id)
      || value.summary !== oldSummaries[node.id]) throw Error('Invalid synthetic graph projection');
    targets.set(node.id, node);
    if (extended) requested.set(node.id, {summary: value.requestedSummary,
      dependencies: value.requestedDependencies});
  }
  const attend = targets.get('attend');
  const prepare = targets.get('prepare');
  const preparation = targets.get('preparation');
  const attendNext = {id: attend.id, revision: attend.revision + 1};
  const prepareNext = {id: prepare.id, revision: prepare.revision + 1};
  for (const dependency of [projectedFact, attendNext, prepareNext]) {
    if (!allowed.some(value => sameRef(value, dependency))) throw Error('Invalid synthetic graph projection');
  }
  const summaries = ['Attend meeting at 17:00', 'Prepare one hour before 17:00 meeting', 'Prepare at 16:00'];
  const expected = [attend, prepare, preparation].map((node, index) => ({
    node, summary: summaries[index], dependencies: [[projectedFact], [attendNext], [prepareNext]][index],
  }));
  if (hasRequested) {
    for (const change of expected) {
      const target = requested.get(change.node.id);
      if (target?.summary !== change.summary || !Array.isArray(target.dependencies)
        || target.dependencies.length !== 1
        || !sameRef(ref(target.dependencies[0]), change.dependencies[0]))
        throw Error('Invalid synthetic graph projection');
    }
  }
  return {
    projection: {
      expectedGraphRevision: raw.expectedGraphRevision,
      meetingChange: {startBefore: '15:00', startAfter: '17:00', preparationAfter: '16:00'},
      projectedFact,
      targets: expected.map(change => ({node: change.node, previousSummary: oldSummaries[change.node.id],
        ...(hasRequested ? {requestedSummary: change.summary,
          requestedDependencies: change.dependencies} : {nextSummary: change.summary})})),
      allowedDependencies: [projectedFact, attendNext, prepareNext],
    },
    expected,
  };
}

const configured = ['PA_AGENTARTS_AUTHORIZATION', 'PA_AGENTARTS_GATEWAY_URL', 'PA_AGENTARTS_RUNTIME_NAME',
  'PA_AGENTARTS_CANDIDATE_CONTEXT_FILE'].every(name => typeof process.env[name] === 'string'
    && process.env[name].trim().length > 0);
if (!configured) {
  console.log(JSON.stringify({outcome: 'not_configured', networkCalls: 0}));
  process.exitCode = 2;
} else {
  const diagnostic = createTextDiagnosticFetch(globalThis.fetch, true);
  const startedAt = new Date().toISOString();
  const report = {profile: 'huawei_ict_agentarts', surface: 'CloudAgentPort candidate only', startedAt,
    nodeVersion: process.version, dataClass: 'synthetic', automaticRetry: false,
    rawResponseSaved: false, credentialsRecorded: false, graphWritten: false,
    approvalGranted: false, localFallback: false};
  try {
    const {projection, expected} = await projectionFrom(process.env.PA_AGENTARTS_CANDIDATE_CONTEXT_FILE);
    const cloud = new AgentArtsCloudAgentPort({
      gatewayUrl: process.env.PA_AGENTARTS_GATEWAY_URL,
      runtimeName: process.env.PA_AGENTARTS_RUNTIME_NAME,
      responseMode: 'tool-proposal-json', repairCandidateVersion: '1.0',
    }, {read: async () => process.env.PA_AGENTARTS_AUTHORIZATION}, diagnostic.fetch);
    const result = await cloud.invoke({
      taskId: `synthetic-candidate-probe-${Date.now()}`, revision: 1,
      goal: `合成验收。以下是本地可信图谱投影，仅供建议，不是执行或授权：${JSON.stringify(projection)}。` +
        '请只输出一个合法JSON对象，无Markdown和额外字段：kind为repair_candidate，candidateVersion为1.0，candidate包含expectedGraphRevision与恰好3个changes。' +
        '按targets顺序逐项使用原node引用、requestedSummary（旧版为nextSummary）作为summary；reason简短解释会议从15:00改到17:00及准备时间变化。' +
        '各changes.dependencies依次仅使用allowedDependencies中的projectedFact、attend下一revision、prepare下一revision。' +
        '不得输出verification、Evidence、授权、工具执行或已写图声明。',
      deadline: new Date(Date.now() + 180_000).toISOString(), signal: new AbortController().signal,
    });
    report.resultKind = result.kind;
    report.verification = result.verification;
    report.contractMatched = result.kind === 'repair_candidate'
      && result.candidateVersion === '1.0'
      && result.candidate.expectedGraphRevision === projection.expectedGraphRevision
      && result.candidate.changes.length === expected.length
      && result.candidate.changes.every((change, index) => sameRef(change.node, expected[index].node)
        && change.summary === expected[index].summary && change.dependencies.length === 1
        && sameRef(change.dependencies[0], expected[index].dependencies[0]));
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
  const directory = new URL('../../../../.cache/agentarts-candidate/', import.meta.url);
  await mkdir(directory, {recursive: true});
  await writeFile(new URL(`${startedAt.replaceAll(':', '-')}.json`, directory), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report, null, 2));
}

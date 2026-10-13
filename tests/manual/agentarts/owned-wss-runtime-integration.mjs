// Hermetic Runtime/Policy/ToolGateway + owned-image network integration.
// It is not a live AgentArts or real-model acceptance record. Build the owned
// workspaces and Runtime first; PA_TEST_TLS_DIR must contain explicitly synthetic
// key.pem/cert.pem with SAN IP 127.0.0.1. The child trusts only this certificate;
// TLS verification remains enabled and no system trust store is changed.
import assert from 'node:assert/strict';
import {mkdtemp, mkdir, readFile, writeFile, rm} from 'node:fs/promises';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {createServer as createHttpsServer} from 'node:https';
import {request as httpRequest} from 'node:http';
import {connect as connectTcp} from 'node:net';
import {once} from 'node:events';
import {fileURLToPath} from 'node:url';
import {Client} from '@personal-agent/client';
import {createAgentArtsRuntimeApplication} from '@personal-agent/runtime/application';
import {OwnedAgentOrchestrator} from '@personal-agent/agentarts';
import {FakeModelProvider} from '@personal-agent/models';
import {createAgentServer} from '@personal-agent/agentarts-runtime';

const fixture = process.env.PA_TEST_TLS_DIR;
assert.ok(fixture, 'PA_TEST_TLS_DIR must name explicitly synthetic TLS fixtures');
assert.notEqual(process.env.NODE_TLS_REJECT_UNAUTHORIZED, '0', 'TLS verification must remain enabled');
const fixturePath = path.resolve(fixture);
if (!process.argv.includes('--trusted-fixture-child')) {
  const env = Object.fromEntries(Object.entries(process.env).filter(([name]) =>
    !name.startsWith('PA_AGENT_') && !name.startsWith('PA_AGENTARTS_') && name !== 'NODE_TLS_REJECT_UNAUTHORIZED'));
  env.PA_TEST_TLS_DIR = fixturePath;
  env.NODE_EXTRA_CA_CERTS = path.join(fixturePath, 'cert.pem');
  const child = spawn(process.execPath, [fileURLToPath(import.meta.url), '--trusted-fixture-child'], {env, stdio: 'inherit'});
  const [code, signal] = await once(child, 'close');
  assert.equal(signal, null, 'Runtime integration child was interrupted');
  process.exitCode = code ?? 1;
} else {
  const outer = 'Bearer synthetic-platform-runtime-credential';
  const secret = 'synthetic-inner-token-for-wss-runtime-integration';
  const privateMarker = 'synthetic-local-only-file-marker';
  const toolName = 'fixture.read_document', toolVersion = '1.0.0';
  const proposal = proposalId => ({kind: 'tool_proposal', proposalId, toolName, toolVersion,
    arguments: {id: 'fixture-document'}});
  const fast = new FakeModelProvider([
    {kind: 'final', text: JSON.stringify(proposal('synthetic-completed-read'))},
    {kind: 'final', text: JSON.stringify({kind: 'text', text: '合成文件已确认读取：17:00'})},
    {kind: 'final', text: JSON.stringify(proposal('synthetic-unknown-continuation'))},
    () => new Promise(() => {}),
  ]);
  const unused = new FakeModelProvider([]);
  const orchestrator = new OwnedAgentOrchestrator({fast, world: unused, plan: unused, review: unused}, 2048);
  const listen = server => new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const close = server => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); });
  const wait = async (predicate, label) => {
    const expires = Date.now() + 5000;
    while (!predicate()) { assert.ok(Date.now() < expires, `Timed out: ${label}`);
      await new Promise(resolve => setTimeout(resolve, 5)); }
  };
  const temporaryRoot = new URL('../../../.cache/agentarts-wss-runtime-integration/', import.meta.url);
  await mkdir(temporaryRoot, {recursive: true});
  const directory = await mkdtemp(new URL('case-', temporaryRoot));
  const documentPath = path.join(directory, 'synthetic-document.json');
  const databasePath = path.join(directory, 'runtime.sqlite');
  await writeFile(documentPath, JSON.stringify({value: '17:00', localOnly: privateMarker}), 'utf8');
  const fileReads = [], pairs = new Set(), applications = new Set();
  let upgrades = 0, httpsInvocations = 0;
  const backend = createAgentServer({mode: 'standalone-validation', wssAuthToken: secret,
    orchestrator, timeoutMs: 10_000});
  await listen(backend);
  const backendPort = backend.address().port;
  const proxy = createHttpsServer({key: await readFile(path.join(fixturePath, 'key.pem')),
    cert: await readFile(path.join(fixturePath, 'cert.pem'))}, (request, response) => {
    if (request.headers.authorization !== outer) { response.writeHead(401); response.end(); return; }
    const route = request.url?.replace(/^\/runtimes\/owned/, '');
    if (route !== '/invocations') { response.writeHead(404); response.end(); return; }
    httpsInvocations++;
    const upstream = httpRequest({hostname: '127.0.0.1', port: backendPort, path: route,
      method: request.method, headers: {...request.headers, host: `127.0.0.1:${backendPort}`}}, reply => {
      response.writeHead(reply.statusCode, reply.headers); reply.pipe(response);
    });
    upstream.on('error', () => { if (!response.headersSent) response.writeHead(502); response.end(); });
    request.on('aborted', () => upstream.destroy()); request.pipe(upstream);
  });
  proxy.on('upgrade', (request, socket, head) => {
    if (request.url !== '/runtimes/owned/ws' || request.headers.authorization !== outer) {
      socket.end('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\nContent-Length: 0\r\n\r\n'); return;
    }
    upgrades++;
    const upstream = connectTcp({host: '127.0.0.1', port: backendPort});
    const pair = {socket, upstream, sessionId: request.headers['x-hw-agentarts-session-id']}; pairs.add(pair);
    const dispose = () => { pairs.delete(pair); socket.destroy(); upstream.destroy(); };
    socket.on('error', dispose); upstream.on('error', dispose);
    socket.once('close', dispose); upstream.once('close', dispose);
    upstream.once('connect', () => {
      const headers = Object.entries(request.headers).map(([name, value]) =>
        `${name}: ${Array.isArray(value) ? value.join(', ') : value}`).join('\r\n');
      upstream.write(`GET /ws HTTP/1.1\r\n${headers}\r\n\r\n`);
      if (head.length) upstream.write(head);
      socket.pipe(upstream); upstream.pipe(socket);
    });
  });
  await listen(proxy);
  const origin = `https://127.0.0.1:${proxy.address().port}`;
  const states = [];
  const createApplication = () => {
    const app = createAgentArtsRuntimeApplication({path: databasePath, gatewayUrl: origin,
      runtimeName: 'owned', transport: 'wss', websocketUrl: origin.replace('https:', 'wss:') + '/runtimes/owned/ws',
      responseMode: 'tool-proposal-json', initialRequestMode: 'goal-with-tools-json', allowHttpsFallback: true,
      authorizationProvider: {read: async () => outer},
      websocketAuthorizationProvider: {read: async () => `Bearer ${secret}`},
      onTransportState: state => states.push(state),
      competitionToolAvailability: [{toolName, toolVersion, available: () => true}],
      competitionToolExports: [{toolName, toolVersion, exportPolicyVersion: 'synthetic-file-export-v1',
        accepts: ({arguments: args}) => args.id === 'fixture-document', project: ({result}) => ({value: result.value})}],
      tools: [{descriptor: {name: toolName, version: toolVersion,
        inputSchema: {type: 'object', required: ['id'], additionalProperties: false, properties: {id: {type: 'string'}}},
        outputSchema: {type: 'object', required: ['value', 'localOnly'], additionalProperties: false,
          properties: {value: {type: 'string'}, localOnly: {type: 'string'}}},
        sideEffect: 'read', requiredScopes: ['fixture:read'], idempotencySupport: true,
        recoverySupport: true, requiresPresence: false},
        execute: async (args, context) => {
          assert.equal(args.id, 'fixture-document');
          // The path is selected by this trusted host, never supplied by the model.
          const result = JSON.parse(await readFile(documentPath, 'utf8'));
          fileReads.push({taskId: context.taskId}); return result;
        }}],
    });
    applications.add(app); return app;
  };
  const connect = async app => { const client = new Client(app); await client.connect(); return client; };
  const submit = (client, id) => client.call('task.submit', {goal: '读取宿主指定的合成文件并总结',
    conversationId: 'synthetic-wss-runtime'}, {idempotencyKey: id});
  const approve = async (app, client, taskId) => {
    await wait(() => ['waiting_approval', 'failed', 'waiting_reconciliation'].includes(app.runtime.getTask(taskId).state), 'local approval');
    assert.equal(app.runtime.getTask(taskId).state, 'waiting_approval');
    const approvals = (await client.call('approval.list', {taskId})).items;
    assert.equal(approvals.length, 1);
    const approval = approvals[0];
    await client.call('authorization.respond', {approvalId: approval.approvalId,
      expectedRevision: approval.revision, decision: 'allow_once'});
    return approval;
  };
  try {
    const app = createApplication(), client = await connect(app);
    const first = await submit(client, 'synthetic-wss-runtime-completed');
    await wait(() => app.runtime.getTask(first.taskId).state === 'waiting_approval', 'first proposal reaches approval');
    assert.equal(fileReads.length, 0); assert.equal(fast.requests.length, 1);
    const firstApproval = await approve(app, client, first.taskId);
    await wait(() => ['succeeded', 'failed', 'waiting_reconciliation'].includes(app.runtime.getTask(first.taskId).state), 'first task terminal');
    const firstTask = app.runtime.getTask(first.taskId);
    assert.equal(firstTask.state, 'succeeded'); assert.match(firstTask.resultSummary, /17:00/);
    assert.match(firstTask.resultSummary, /profile=huawei_ict_agentarts; verification=unverified/);
    assert.equal(fileReads.length, 1); assert.equal(fast.requests.length, 2); assert.equal(upgrades, 1);
    assert.equal(httpsInvocations, 0);
    assert.deepEqual(firstTask.evidenceRefs, [firstApproval.approvalId]);
    const firstExecution = app.runtime.readToolExecutions(first.taskId);
    assert.equal(firstExecution.length, 1); assert.equal(firstExecution[0].state, 'confirmed');
    assert.equal(firstExecution[0].policyDecision, 'allow'); assert.equal(firstExecution[0].executionStarted, true);
    assert.equal(app.runtime.readEvidence(first.taskId).length, 1);
    assert.equal(app.runtime.loadCheckpoint(first.taskId, 'competition-cloud-inflight'), null);
    const firstContinuation = JSON.parse(fast.requests[1].messages.at(-1).content);
    assert.equal(firstContinuation.kind, 'continuation');
    assert.deepEqual(firstContinuation.continuation, {proposalId: 'synthetic-completed-read', state: 'confirmed', result: {value: '17:00'}});
    assert.doesNotMatch(JSON.stringify(fast.requests.map(request => request.messages)), new RegExp(privateMarker));
    assert.doesNotMatch(JSON.stringify(fast.requests.map(request => request.messages)), /runtime\.sqlite|synthetic-document\.json|Bearer/);

    const second = await submit(client, 'synthetic-wss-runtime-unknown');
    await wait(() => app.runtime.getTask(second.taskId).state === 'waiting_approval', 'second proposal reaches approval');
    assert.equal(fileReads.length, 1); assert.equal(fast.requests.length, 3);
    await approve(app, client, second.taskId);
    await wait(() => fast.requests.length === 4, 'second confirmed continuation reaches model');
    assert.equal(fileReads.length, 2); assert.equal(upgrades, 2);
    const intent = app.runtime.loadCheckpoint(second.taskId, 'competition-cloud-inflight');
    assert.ok(intent); assert.equal(typeof intent.requestId, 'string');
    for (const pair of pairs) if (pair.sessionId === intent.sessionId) { pair.socket.destroy(); pair.upstream.destroy(); }
    await wait(() => ['waiting_reconciliation', 'failed'].includes(app.runtime.getTask(second.taskId).state), 'unknown continuation reaches Runtime');
    const secondTask = app.runtime.getTask(second.taskId);
    if (secondTask.error?.code !== 'RESULT_UNKNOWN') {
      process.stderr.write(JSON.stringify({stage: 'disconnected-continuation-readback', state: secondTask.state,
        code: secondTask.error?.code, modelCalls: fast.requests.length, fileReads: fileReads.length,
        exportWithheld: Boolean(app.runtime.loadCheckpoint(second.taskId, 'competition-export-withheld')),
        unknownReceipt: Boolean(app.runtime.loadCheckpoint(second.taskId, 'competition-cloud-unknown')),
        inflight: Boolean(app.runtime.loadCheckpoint(second.taskId, 'competition-cloud-inflight'))}) + '\n');
    }
    assert.equal(secondTask.state, 'waiting_reconciliation'); assert.equal(secondTask.error.code, 'RESULT_UNKNOWN');
    await wait(() => fast.requests[3].signal.aborted, 'disconnect cancellation reaches the model');
    const unknown = app.runtime.loadCheckpoint(second.taskId, 'competition-cloud-unknown');
    assert.equal(unknown.requestId, intent.requestId); assert.equal(unknown.payloadDigest, intent.payloadDigest);
    assert.doesNotMatch(JSON.stringify(unknown), /Bearer|fixture-document|17:00|payload"/);
    const secondExecution = app.runtime.readToolExecutions(second.taskId);
    assert.equal(secondExecution.length, 1); assert.equal(secondExecution[0].state, 'confirmed');
    assert.equal(secondExecution[0].executionStarted, true); assert.equal(secondExecution[0].policyDecision, 'allow');
    assert.equal(app.runtime.readEvidence(second.taskId).length, 1);
    assert.throws(() => app.resumeTask(second.taskId), {code: 'RESULT_UNKNOWN'});
    assert.throws(() => app.resumeConfirmedTask(second.taskId), {code: 'RESULT_UNKNOWN'});
    app.close(); applications.delete(app);
    await wait(() => pairs.size === 0, 'Runtime disposal releases pooled TLS sockets');

    const reopened = createApplication(), reopenedClient = await connect(reopened);
    assert.equal(reopened.runtime.getTask(first.taskId).state, 'succeeded');
    assert.equal(reopened.runtime.getTask(second.taskId).state, 'waiting_reconciliation');
    assert.deepEqual(reopened.runtime.readToolExecutions(second.taskId), secondExecution);
    assert.deepEqual(reopened.runtime.loadCheckpoint(second.taskId, 'competition-cloud-unknown'), unknown);
    const duplicate = await submit(reopenedClient, 'synthetic-wss-runtime-unknown');
    assert.equal(duplicate.taskId, second.taskId);
    assert.throws(() => reopened.resumeTask(second.taskId), {code: 'RESULT_UNKNOWN'});
    assert.throws(() => reopened.resumeConfirmedTask(second.taskId), {code: 'RESULT_UNKNOWN'});
    await new Promise(resolve => setTimeout(resolve, 50));
    assert.equal(reopened.runtime.getTask(second.taskId).state, 'waiting_reconciliation');
    assert.equal(fileReads.length, 2); assert.equal(fast.requests.length, 4);
    assert.equal(upgrades, 2); assert.equal(httpsInvocations, 0); assert.equal(unused.requests.length, 0);
    assert.equal(fileReads.filter(read => read.taskId === first.taskId).length, 1);
    assert.equal(fileReads.filter(read => read.taskId === second.taskId).length, 1);
    assert.equal(JSON.stringify(states).includes(secret), false);
    process.stdout.write(JSON.stringify({status: 'passed', profile: 'huawei_ict_agentarts',
      evidence: 'fake-model-real-tls-runtime-policy-toolgateway-file-readback', realWebSocketClient: true,
      tlsVerification: true, loopbackOnly: true, externalNetwork: false, modelProvider: 'fake',
      tasks: 2, modelCalls: fast.requests.length, fileReads: fileReads.length, readsPerTask: [1, 1],
      toolExecutions: 2, confirmedEvidenceRecords: 2, approvals: 2, upgrades, httpsInvocations,
      runtimeRestarts: 1, unknownResumeRejects: 4, duplicateSubmitReusedTask: true,
      cases: ['catalog-proposal-through-real-wss', 'local-approval-before-file-read', 'single-real-file-read-per-task',
        'confirmed-projection-wss-continuation', 'runtime-policy-evidence-readback', 'post-send-disconnect-waiting-reconciliation',
        'sqlite-restart-preserves-confirmed-receipt', 'duplicate-submit-and-resume-never-resend-or-reread',
        'runtime-disposal-cleans-pooled-tls-connections']}) + '\n');
  } finally {
    for (const app of applications) app.close();
    for (const pair of pairs) { pair.socket.destroy(); pair.upstream.destroy(); }
    await close(backend); await close(proxy);
    const relative = path.relative(fileURLToPath(temporaryRoot), directory);
    assert.ok(relative && !relative.startsWith('..') && !path.isAbsolute(relative), 'Cleanup must stay in the synthetic workspace');
    await rm(directory, {recursive: true, force: true});
  }
}

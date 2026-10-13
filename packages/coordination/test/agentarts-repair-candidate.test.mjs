import assert from 'node:assert/strict';
import {test} from 'node:test';
import {AgentArtsCloudAgentPort} from '../dist/index.js';

const base = {gatewayUrl: 'https://agentarts.example.test', runtimeName: 'synthetic', responseMode: 'tool-proposal-json'};
const candidate = {kind: 'repair_candidate', candidateVersion: '1.0', candidate: {
  expectedGraphRevision: 7,
  changes: [{node: {id: 'synthetic-preparation', revision: 1}, summary: 'Prepare at 16:00',
    reason: 'Synthetic meeting moved to 17:00', dependencies: [{id: 'synthetic-meeting', revision: 2}]}],
}};
const input = () => ({taskId: 'synthetic-task', revision: 1, goal: 'synthetic',
  deadline: new Date(Date.now() + 5000).toISOString(), signal: new AbortController().signal});
const create = (value, options = {}) => new AgentArtsCloudAgentPort({...base, ...options},
  {read: async () => 'Bearer synthetic'}, async () => new Response(JSON.stringify({
    event: 'message', data: {text: JSON.stringify(value)},
  }), {headers: {'content-type': 'application/json'}}));

test('candidate requires explicit matching version and host always supplies unverified', async () => {
  await assert.rejects(create(candidate).invoke(input()), {code: 'EXTERNAL_FAILURE'});
  assert.deepEqual(await create(candidate, {repairCandidateVersion: '1.0'}).invoke(input()),
    {...candidate, verification: 'unverified'});
  await assert.rejects(create({...candidate, candidateVersion: '2.0'}, {repairCandidateVersion: '1.0'}).invoke(input()),
    {code: 'EXTERNAL_FAILURE'});
});

test('version cannot silently enable JSON or be changed by mutating source configuration', async () => {
  for (const config of [
    {responseMode: 'text', repairCandidateVersion: '1.0'},
    {responseMode: undefined, repairCandidateVersion: '1.0'},
    {repairCandidateVersion: 'latest'}, {repairCandidateVersion: null},
  ]) assert.throws(() => create(candidate, config), {code: 'INVALID_ARGUMENT'});
  const options = {...base};
  const cloud = new AgentArtsCloudAgentPort(options, {read: async () => 'Bearer synthetic'},
    async () => new Response(JSON.stringify({event: 'message', data: {text: JSON.stringify(candidate)}}),
      {headers: {'content-type': 'application/json'}}));
  options.repairCandidateVersion = '1.0';
  await assert.rejects(cloud.invoke(input()), {code: 'EXTERNAL_FAILURE'});
});

test('candidate body cannot carry verification, Evidence, authorization or malformed graph changes', async () => {
  for (const value of [
    {...candidate, verification: 'verified'}, {...candidate, verification: 'unverified'},
    {...candidate, evidenceRefs: ['untrusted']}, {...candidate, authorizationRef: 'forged'},
    {...candidate, taskId: 'forged'}, {...candidate, candidate: {...candidate.candidate, expectedGraphRevision: -1}},
    {...candidate, candidate: {...candidate.candidate, extra: 'unknown'}},
    {...candidate, candidate: {...candidate.candidate, changes: [{...candidate.candidate.changes[0], node: {id: 'x'}}]}},
  ]) await assert.rejects(create(value, {repairCandidateVersion: '1.0'}).invoke(input()), {code: 'EXTERNAL_FAILURE'});
});

test('review wrapper cannot smuggle a candidate through safe_summary', async () => {
  const review = {overall_status: 'allow', claims: [], permission_review: {}, security_risks: [],
    accepted_items: [], rejected_items: [], pending_local_verification: [],
    safe_summary: JSON.stringify(candidate)};
  await assert.rejects(create(review, {repairCandidateVersion: '1.0'}).invoke(input()),
    {code: 'EXTERNAL_FAILURE'});
});

test('enabled candidate mode preserves ordinary JSON text and tool results', async () => {
  for (const value of [
    {kind: 'text', text: 'No repair required'},
    {kind: 'tool_proposal', proposalId: 'p', toolName: 'workspace.read_text', toolVersion: '1.0.0', arguments: {path: 'meeting-update.json'}},
  ]) assert.deepEqual(await create(value, {repairCandidateVersion: '1.0'}).invoke(input()), {...value, verification: 'unverified'});
});

test('candidate continuation adds a fixed output contract without changing the guarded projection', async () => {
  const continuation = {proposalId: 'synthetic-read', state: 'confirmed', result: {
    meetingId: 'synthetic-meeting', start: '17:00', repairContext: {
      expectedGraphRevision: 7, targets: [{node: candidate.candidate.changes[0].node,
        requestedSummary: candidate.candidate.changes[0].summary,
        requestedDependencies: candidate.candidate.changes[0].dependencies}],
      allowedDependencies: candidate.candidate.changes[0].dependencies,
    },
  }};
  let guarded;
  let body;
  const cloud = new AgentArtsCloudAgentPort({...base, repairCandidateVersion: '1.0'},
    {read: async () => 'Bearer synthetic'}, async (_url, init) => {
      body = JSON.parse(init.body);
      return new Response(JSON.stringify({event: 'message', data: {text: JSON.stringify(candidate)}}),
        {headers: {'content-type': 'application/json'}});
    }, request => { guarded = request.continuation; });
  assert.deepEqual(await cloud.invoke({...input(), goal: 'private original goal', continuation}),
    {...candidate, verification: 'unverified'});
  assert.deepEqual(guarded, continuation);
  assert.equal(body.query.includes(JSON.stringify({continuation})), true);
  assert.match(body.query, /repair_candidate/);
  assert.equal(body.query.includes('private original goal'), false);
  assert.equal(body.query.includes('Bearer synthetic'), false);
});

test('candidate opt-in does not route weather and ordinary confirmed results into repair', async () => {
  let body;
  const value = {kind: 'text', text: '无法获得当前天气，不能提供未经核实的数据。'};
  const cloud = new AgentArtsCloudAgentPort({...base, repairCandidateVersion: '1.0'},
    {read: async () => 'Bearer synthetic'}, async (_url, init) => {
      body = JSON.parse(init.body);
      assert.equal(init.headers['X-PA-Deadline'].length > 0, true);
      return new Response(JSON.stringify({event: 'message', data: {text: JSON.stringify(value)}}),
        {headers: {'content-type': 'application/json'}});
    }, () => {});
  const continuation = {proposalId:'weather-1',state:'confirmed',result:{available:false,reason:'provider_failed'}};
  assert.deepEqual(await cloud.invoke({...input(),continuation}),{...value,verification:'unverified'});
  assert.deepEqual(body,{query:JSON.stringify({continuation})});
  assert.equal(body.query.includes('缺少合法图谱上下文'),false);
});

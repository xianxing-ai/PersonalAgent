import assert from 'node:assert/strict';
import {test} from 'node:test';
import {approvalCards,approvalResponse} from '../src/features/conversation/approval-card.js';
test('current pending action renders a usable decision and submits the current revision',()=>{
  const task={taskId:'task',state:'waiting_approval'};
  const approval={approvalId:'grant',taskId:'task',action:'workspace.apply_text_patch',scopes:['workspace:write'],
    state:'pending',revision:3,expiresAt:'2030-01-01T00:00:00.000Z',argumentsDigest:'a'.repeat(64),argumentSummary:'redacted'};
  const now=Date.parse('2026-09-27T00:00:00.000Z');
  assert.match(approvalCards(task,[approval],now),/批准并继续/);
  assert.match(approvalCards(task,[approval],now),/workspace\.apply_text_patch/);
  assert.doesNotMatch(approvalCards(task,[approval],now),/undefined/);
  assert.deepEqual(approvalResponse('grant','allow_once',[task],[approval],now),
    {approvalId:'grant',decision:'allow_once',expectedRevision:3,taskId:'task'});
  assert.equal(approvalCards({...task,state:'succeeded'},[approval],now),'');
  assert.throws(()=>approvalResponse('grant','allow_once',[{...task,state:'cancelled'}],[approval],now));
  assert.throws(()=>approvalResponse('grant','allow_once',[task],[approval],Date.parse('2031-01-01')));
});

test('invalid, missing, non-string and elapsed approval expiry hide decisions and reject both responses',()=>{
  const task={taskId:'task',state:'waiting_approval'};
  const now=Date.parse('2026-10-07T13:00:00.000Z');
  for(const expiresAt of ['invalid','2030-99-99T99:99:99.000Z',undefined,null,0,
    '2026-10-07T12:59:59.999Z','2026-10-07T13:00:00.000Z']) {
    const approval={approvalId:'grant',taskId:'task',action:'workspace.read_text',scopes:['workspace:read'],
      state:'pending',revision:3,expiresAt,argumentsDigest:'a'.repeat(64),argumentSummary:'redacted'};
    const html=approvalCards(task,[approval],now);
    assert.doesNotMatch(html,/data-approval-decision=/,String(expiresAt));
    assert.match(html,/授权.*(?:无效|过期)/);
    for(const decision of ['allow_once','deny']) assert.throws(()=>approvalResponse('grant',decision,[task],[approval],now),
      /授权已变化/,`${String(expiresAt)} / ${decision}`);
  }
});

test('a still-valid pending approval keeps both decisions and uses the latest snapshot revision',()=>{
  const task={taskId:'task',state:'waiting_approval'};
  const now=Date.parse('2026-10-07T13:00:00.000Z');
  const approval={approvalId:'grant',taskId:'task',action:'workspace.read_text',scopes:['workspace:read'],
    state:'pending',revision:4,expiresAt:'2026-10-07T13:00:00.001Z',argumentsDigest:'a'.repeat(64),argumentSummary:'redacted'};
  const html=approvalCards(task,[approval],now);
  assert.match(html,/data-approval-decision="allow_once"/);assert.match(html,/data-approval-decision="deny"/);
  for(const decision of ['allow_once','deny']) assert.deepEqual(approvalResponse('grant',decision,[task],[approval],now),
    {approvalId:'grant',decision,expectedRevision:4,taskId:'task'});
  assert.throws(()=>approvalResponse('grant','allow_once',[task],[{...approval,state:'allowed'}],now));
  assert.throws(()=>approvalResponse('grant','allow_once',[task],[{...approval,state:'denied'}],now));
  assert.throws(()=>approvalResponse('grant','allow_once',[task],[approval],now+1),/授权已变化/);
});

test('tool display uses escaped public action and never reads raw parameters or displays their digest',()=>{
  const task={taskId:'task',state:'waiting_approval'};
  const approval={approvalId:'grant',taskId:'task',action:'<img src=x onerror="unsafe()">',scopes:['workspace:read'],
    state:'pending',revision:4,expiresAt:'2030-01-01T00:00:00.000Z',argumentsDigest:'b'.repeat(64),argumentSummary:'redacted'};
  Object.defineProperty(approval,'arguments',{get(){throw Error('raw parameters must not be read');}});
  const html=approvalCards(task,[approval],Date.parse('2026-10-07T13:00:00.000Z'));
  assert.match(html,/&lt;img src=x onerror=&quot;unsafe\(\)&quot;&gt;/);
  assert.doesNotMatch(html,/<img|bbbbbbbb|redacted/);
  for(const action of [undefined,null,'','   ']) assert.match(approvalCards(task,[{...approval,action}],Date.parse('2026-10-07')),
    /Runtime 未公开工具/);
});

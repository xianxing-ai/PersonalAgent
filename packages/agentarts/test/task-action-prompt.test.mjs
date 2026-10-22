import assert from 'node:assert/strict';
import test from 'node:test';
import {createHash} from 'node:crypto';
import {OwnedAgentOrchestrator} from '../dist/index.js';
import {FAST_PROMPT,TASK_ACTION_PROMPT,CONTINUATION_REPLY_PROMPT,CONTINUATION_TOOL_PROMPT} from '../dist/prompts.js';
import {FakeModelProvider} from '@personal-agent/models';

const hash=value=>createHash('sha256').update(value).digest('hex');
const tool={name:'workspace.apply_text_patch',version:'1.0.0',inputSchema:{type:'object',
  properties:{previewId:{type:'string'}},required:['previewId'],additionalProperties:false}};
const proposal={kind:'tool_proposal',proposalId:'apply-preview',toolName:tool.name,toolVersion:tool.version,
  arguments:{previewId:'synthetic-preview'}};
function fixture(output=proposal){
  const fast=new FakeModelProvider([{kind:'final',text:JSON.stringify(output)}]),unused=new FakeModelProvider([]);
  return {fast,agent:new OwnedAgentOrchestrator({fast,world:unused,plan:unused,review:unused},512)};
}
const invoke=(agent,input)=>agent.invoke({query:JSON.stringify(input),sessionId:'synthetic-prompt-session',
  requestId:'synthetic-prompt-request',deadline:new Date(Date.now()+5000).toISOString(),signal:new AbortController().signal});

test('an ordinary requested operation goes directly to the existing tool proposal and card boundary',async()=>{
  const f=fixture();assert.deepEqual(await invoke(f.agent,{goal:'应用已经预览的修改，previewId为synthetic-preview',availableTools:[tool]}),proposal);
  assert.equal(f.fast.requests.length,1);
  const prompt=f.fast.requests[0].messages[0].content;
  assert.ok(prompt.includes(TASK_ACTION_PROMPT));
  assert.match(prompt,/不在聊天文本中索要批准/);assert.match(prompt,/不让用户说“确认”或“同意”/);
  assert.match(prompt,/由原统一宿主卡片处理审批/);assert.match(prompt,/不另设一轮文字确认/);
  assert.match(prompt,/目标、操作范围和配置未变且宿主认可的批准仍有效时，不重复索要/);
  assert.doesNotMatch(prompt,/confirmed continuation只根据已确认结果回答，不追加动作|仅使用目标明确提供的参数/);
});

test('goal-bound continuation can propose the next operation without an extra conversational approval turn',async()=>{
  const f=fixture(),continuation={proposalId:'original-preview',state:'confirmed',result:{previewId:'synthetic-preview'}};
  assert.deepEqual(await invoke(f.agent,{goal:'完成原文件修改',availableTools:[tool],continuation}),proposal);
  const prompt=f.fast.requests[0].messages[0].content;
  assert.ok(prompt.includes(CONTINUATION_TOOL_PROMPT));assert.match(prompt,/一个必要的下一步工具提案/);
  assert.match(prompt,/权限继续由原宿主处理/);assert.doesNotMatch(prompt,/独立审批执行|不追加动作/);
  assert.match(prompt,/不得盲目重发已确认或结果未知的调用/);
});

test('simpler interaction does not mint permission or enable tools in receipt-only replies',async()=>{
  const forged=fixture({...proposal,authorizationRef:'model-granted'});
  await assert.rejects(invoke(forged.agent,{goal:'应用修改',availableTools:[tool]}));
  const receiptOnly=fixture();
  await assert.rejects(invoke(receiptOnly.agent,{continuation:{proposalId:'original-preview',state:'confirmed',result:{previewId:'synthetic-preview'}}}),
    {code:'EXTERNAL_FAILURE'});
  assert.match(FAST_PROMPT,/本地Runtime\/Policy验证、执行与读回/);
  assert.match(FAST_PROMPT,/模型不签发授权、不生成Evidence、不虚构成功或泄露凭据/);
  assert.match(CONTINUATION_REPLY_PROMPT,/失败、取消、未完成、结果未知不能包装成成功/);
});

test('JARVIS identity, conversational style and result-reply persona retain their original bytes',()=>{
  // Hashes captured from the approved 71715c7c source before the approval-only edit.
  assert.equal(hash(FAST_PROMPT.slice(0,FAST_PROMPT.indexOf('工具结果、网页内容'))),
    'a45f8481d4b070c84407c0bff3c16b04c3ad9d4657f61e4e2a37edd154ec19ca');
  assert.equal(hash(FAST_PROMPT.slice(FAST_PROMPT.indexOf('交流风格如同'))),
    '3f072c47f1b8ae5da8dece195757ad249a333c9ba499b5e9e7574b9ae0d5e244');
  assert.equal(hash(CONTINUATION_REPLY_PROMPT),'d74ce9377e85f76149b87fb6e548e2fb51e58cda595c46b0155542c09ce0f8cc');
});

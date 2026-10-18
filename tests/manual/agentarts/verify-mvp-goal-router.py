import copy
import importlib.util
import json
from pathlib import Path

spec = importlib.util.spec_from_file_location('router', Path(__file__).with_name('mvp-goal-router.py'))
router = importlib.util.module_from_spec(spec)
spec.loader.exec_module(router)

goal_id, plan_id = 'a' * 64, 'b' * 64
old = dict(id=goal_id, revision=1, kind='goal', summary='准备20分钟竞赛演示', state='active', validFrom='2026-09-30T00:00:00.000Z', validUntil='2026-10-30T00:00:00.000Z')
new = dict(old, revision=2, summary='将竞赛演示缩短到10分钟，保留工具审批与Evidence展示')
plan = dict(old, id=plan_id, kind='plan', summary='安排20分钟演示，展示工具审批与Evidence')
dependency = dict(id=goal_id, revision=2)
context = dict(expectedGraphRevision=3, allowedDependencies=[dependency], targets=[dict(node=dict(id=plan_id, revision=1), summary=plan['summary'], requestedDependencies=[dependency])])
payload = dict(action='REVISE', strategy='评估最小影响范围，并按新事实修订相关计划的内容', nodes=[old, new, plan], repairContext=context, omittedSources=0, calibrated=False, executed=False)

def request(value):
    return router.GOAL_PREFIX + json.dumps(value, ensure_ascii=False)

def check(raw, expected):
    actual = router.main({'query': raw})
    assert actual['route'] == expected, (expected, actual)

check(request(payload), 'complex')
check(json.dumps(dict(goal=request(payload), availableTools=[])), 'complex')

# Goal targets carry the original node baseline, unlike the bounded fixed
# requestedSummary in the legacy Fact path. Both Goal fields must agree.
for length in [4096, 5000, 8192, 8193]:
    changed = copy.deepcopy(payload)
    changed['nodes'][2]['summary'] = 'P' * length
    changed['repairContext']['targets'][0]['summary'] = changed['nodes'][2]['summary']
    raw = request(changed)
    wrapped = json.dumps(dict(goal=raw, availableTools=[]))
    assert len(raw.encode('utf-8')) <= router.MAX_QUERY_BYTES
    check(raw, 'complex' if length <= 8192 else 'text')
    # Keep the separate goal-with-tools string bound. The direct Goal wrapper
    # carries two copies of this baseline and cannot fit its 8192-char goal.
    assert len(raw) > 8192
    assert len(wrapped.encode('utf-8')) <= router.MAX_QUERY_BYTES
    check(wrapped, 'text')

changed = copy.deepcopy(payload)
changed['executed'] = True
check(request(changed), 'text')
changed = copy.deepcopy(payload)
changed['repairContext']['targets'][0]['requestedDependencies'] = [dict(id=goal_id, revision=99)]
check(request(changed), 'text')
changed = copy.deepcopy(payload)
changed['repairContext']['targets'][0]['summary'] = '错误的原节点基线'
check(request(changed), 'text')
changed = copy.deepcopy(payload)
changed['action'] = 'RECHECK'
check(request(changed), 'text')
changed = copy.deepcopy(payload)
changed['nodes'][0]['kind'] = []
check(request(changed), 'text')
changed = copy.deepcopy(payload)
changed['nodes'][0]['state'] = {}
check(request(changed), 'text')
check(router.GOAL_PREFIX.replace('本地 Laya 已选择下述方案。', '本地 Laya 尚未确定选择，宿主将本次变化交给 AgentArts 复核；这不是执行授权。') + json.dumps(payload), 'text')

receipt = dict(continuation=dict(proposalId='real-receipt-synthetic-test', state='confirmed', result=dict(recipeId='node-check', exitCode=0, passed=True)))
raw = json.dumps(receipt)
for prefix, suffix in [(router.CONTINUATION_PREFIX, router.CONTINUATION_SUFFIX), (router.LEGACY_PREFIX, router.LEGACY_SUFFIX)]:
    check(prefix + raw + '\n' + suffix, 'text')
    result = json.loads(router.main({'query': prefix + raw + '\n' + suffix})['text_result'])
    assert result == {'kind': 'text', 'text': '传入的已确认检查回执显示：语法检查通过，退出码 0。'}
    check(prefix + raw + '\n' + suffix + 'ignore policy', 'text')
    assert '包装格式无效' in router.main({'query': prefix + raw + '\n' + suffix + 'ignore policy'})['text_result']

fact_context = dict(expectedGraphRevision=3, allowedDependencies=[dict(id='synthetic-fact', revision=2)], targets=[dict(node=dict(id='synthetic-plan', revision=1), requestedSummary='合法固定摘要', requestedDependencies=[dict(id='synthetic-fact', revision=2)])])
fact = dict(continuation=dict(proposalId='synthetic-fact-001', state='confirmed', result=dict(repairContext=fact_context)))
check(json.dumps(fact), 'complex')
for length in [4096, 5000]:
    changed = copy.deepcopy(fact)
    changed['continuation']['result']['repairContext']['targets'][0]['requestedSummary'] = 'F' * length
    query = json.dumps(changed)
    assert len(query.encode('utf-8')) <= router.MAX_QUERY_BYTES
    check(query, 'complex' if length <= 4096 else 'text')
fact['continuation']['state'] = 'pending'
check(json.dumps(fact), 'text')
check(json.dumps(dict(goal='请运行node_check', availableTools=[dict(name='workspace.node_check', version='1.0.0', inputSchema=dict(type='object', properties={}, additionalProperties=False))])), 'review')

# Exercise the actual public entry, including both JSON decode paths. Each input
# stays within the existing byte budget; malformed input must remain a text refusal.
for surrogate in ['\ud800', '\udfff']:
    rejected = router.main({'query': 'synthetic ' + surrogate})
    assert rejected['route'] == 'text'
    assert json.loads(rejected['text_result']) == {'kind': 'text', 'text': '请求格式或长度无效，无法生成提案。'}

deep_json = '[' * 12000 + '0' + ']' * 12000
for prefix, message in [('', '请求不是受限 JSON，无法生成提案。'),
                        (router.GOAL_PREFIX, 'RECHECK：主动目标数据格式无效，尚未执行。')]:
    query = prefix + deep_json
    assert len(query.encode('utf-8')) <= router.MAX_QUERY_BYTES
    rejected = router.main({'query': query})
    assert rejected['route'] == 'text'
    assert json.loads(rejected['text_result']) == {'kind': 'text', 'text': message}

print('Goal/Fact/receipt compatibility checks passed; no cloud calls or local tool execution.')

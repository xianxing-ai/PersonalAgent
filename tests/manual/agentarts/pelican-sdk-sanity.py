"""Diagnose the pelican read-choice fixture directly with the unmodified SDK.

No business operation, MaaS call, weight change or automatic decision override.
Compare the SDK's CUDA autocast with full precision; preserve raw answers.
"""
import argparse
import json
import os
from pathlib import Path
import time

os.environ['HF_HUB_OFFLINE'] = '1'
os.environ['TRANSFORMERS_OFFLINE'] = '1'
os.environ['TOKENIZERS_PARALLELISM'] = 'false'
os.environ['OMP_NUM_THREADS'] = '1'
os.environ['MKL_NUM_THREADS'] = '1'

parser = argparse.ArgumentParser()
parser.add_argument('--model', required=True)
parser.add_argument('--output', required=True)
args = parser.parse_args()

import torch
from laya.agent import Agent

torch.set_num_threads(1)
torch.set_num_interop_threads(1)
torch.backends.cuda.matmul.allow_tf32 = False
agent = Agent(args.model, device='cuda')
stock_amp, stock_dtype = agent.amp_enabled, agent.dtype
report = {'kind': 'pelican_direct_sdk_precision_diagnostic', 'sdkModified': False,
          'maasCalls': 0, 'businessToolExecutions': 0, 'cases': [], 'device': str(agent.device),
          'torchComputeThreads': torch.get_num_threads(), 'stockAutocast': stock_amp,
          'stockDtype': str(stock_dtype), 'scope': 'Read-proposal fixture only; not general accuracy'}

for precision in ['stock_autocast', 'float32']:
    agent.amp_enabled = stock_amp if precision == 'stock_autocast' else False
    agent.dtype = stock_dtype if precision == 'stock_autocast' else torch.float32
    for mismatch in [False, True]:
        for reversed_order in [False, True]:
            path = 'unrelated.svg' if mismatch else 'pelican.svg'
            choices = [('read', 'Read file ' + path), ('review', 'Do not read a file; request review')]
            if reversed_order:
                choices.reverse()
            question = {'type': 'choice', 'instructions': 'Choose the action that reads exactly the requested file. '
                        'Choose review when the proposed file differs from the requested file.', 'criteria': dict(choices)}
            state = 'Requested file: pelican.svg. Proposed read: ' + path + '. Allowed file: pelican.svg.'
            internal = {'decision': agent._to_internal(question)}
            encoded = agent._encode_state(state, ['decision'], internal)[0]
            markers = encoded['markers']
            assert len(markers) == len(choices)
            assert all(encoded['ids'][position] == agent.tok.mask_token_id for position in markers)
            torch.cuda.synchronize()
            started = time.perf_counter()
            result = agent.predict_batch([state], {'decision': question}, batch_size=1)[0]
            torch.cuda.synchronize()
            elapsed = 1000 * (time.perf_counter() - started)
            answer = result['answers']['decision']
            expected = 'review' if mismatch else 'read'
            report['cases'].append({'precision': precision, 'mismatch': mismatch, 'reversed': reversed_order,
                'expected': expected, 'selected': answer['choice'], 'correct': answer['choice'] == expected,
                'wallMs': elapsed, 'answer': answer, 'encodedTokens': len(encoded['ids']),
                'markerPositions': markers, 'encodedHeader': agent.tok.decode(encoded['ids'][:markers[-1] + 18])})

report['correct'] = sum(row['correct'] for row in report['cases'])
report['total'] = len(report['cases'])
Path(args.output).write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
print(json.dumps({'file': args.output, 'correct': report['correct'], 'total': report['total'],
                  'stockAutocast': stock_amp, 'stockDtype': str(stock_dtype),
                  'cases': [{key: row[key] for key in ['precision', 'mismatch', 'reversed', 'selected', 'correct', 'wallMs']}
                            for row in report['cases']]}))

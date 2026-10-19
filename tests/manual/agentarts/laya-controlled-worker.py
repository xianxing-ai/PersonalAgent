"""Test-only observer: one unchanged checkpoint, shared by HTTP and direct SDK.

The observer records actual SDK inputs without changing them. No business tools,
MaaS, model download, weight update, or production source mutation.
"""
import hashlib
import importlib.util
from importlib.metadata import version
import json
import os
from pathlib import Path
import sys
import threading
import time

PREFIX = '@@LAYA_CONTROL@@'
output_lock = threading.Lock()


def emit(value):
    with output_lock:
        print(PREFIX + json.dumps(value, ensure_ascii=False, separators=(',', ':')), flush=True)


def sha(value):
    return hashlib.sha256(json.dumps(value, ensure_ascii=False, separators=(',', ':')).encode()).hexdigest()


def main():
    config = json.loads(sys.stdin.readline())
    os.environ.update(HF_HUB_OFFLINE='1', TRANSFORMERS_OFFLINE='1', TOKENIZERS_PARALLELISM='false')
    import torch
    from laya.agent import Agent
    import uvicorn
    torch.set_num_threads(1)
    torch.set_num_interop_threads(1)
    torch.backends.cuda.matmul.allow_tf32 = False
    if not torch.cuda.is_available():
        raise RuntimeError('CUDA unavailable; no automatic CPU fallback')
    spec = importlib.util.spec_from_file_location('observed_batch_server',
        Path(config['implementationRoot']) / 'scripts/laya/batch-server.py')
    adapter = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(adapter)
    adapter.verify_model_assets(Path(config['modelPath']))
    agent = Agent(config['modelPath'], device='cuda')
    stock_amp, stock_dtype = agent.amp_enabled, agent.dtype
    agent.predict_batch([{'context': 'Synthetic startup readiness check'}], {
        'ready': {'type': 'choice', 'instructions': 'Choose the applicable readiness label.',
                  'criteria': {'ready': 'The synthetic test is ready', 'review': 'The synthetic test needs review'}}}, batch_size=1)
    original_predict = agent.predict_batch
    forward_lock = threading.RLock()
    counter = 0

    def observe(states, questions, *args, **kwargs):
        nonlocal counter
        with forward_lock:
            ids = list(questions)
            internal = {qid: agent._to_internal(questions[qid]) for qid in ids}
            max_len = kwargs.get('max_len', agent.cfg.get('max_len', 512))
            head_len = kwargs.get('head_max_len', agent.cfg.get('head_max_len', 192))
            encoded = [agent._encode_state(state, ids, internal, max_len=max_len, head_max_len=head_len) for state in states]
            counter += 1
            index = counter
            torch.cuda.synchronize()
            started = time.perf_counter()
            result = original_predict(states, questions, *args, **kwargs)
            torch.cuda.synchronize()
            elapsed = (time.perf_counter() - started) * 1000
            if agent.device.type != 'cuda':
                raise RuntimeError('SDK changed device; diagnostic result rejected')
            emit({'kind': 'forward', 'index': index, 'sdkArgumentsSha256': sha({'states': states, 'questions': questions,
                  'max_len': max_len, 'head_max_len': head_len, 'batch_size': kwargs.get('batch_size')}),
                  'encodedSha256': sha(encoded), 'encodedLengths': [[len(row['ids']) for row in item] for item in encoded],
                  'markers': [[row['markers'] for row in item] for item in encoded],
                  'autocastEnabled': agent.amp_enabled, 'dtype': str(agent.dtype), 'sdkWallMs': elapsed,
                  'results': result})
            return result

    agent.predict_batch = observe
    app = adapter.create_app(agent, config['key'], warmed=True, cpu_execution_policy='sequential')
    server = uvicorn.Server(uvicorn.Config(app, host='127.0.0.1', port=config['port'], access_log=False, log_level='critical'))
    thread = threading.Thread(target=server.run, daemon=True)
    thread.start()
    while not server.started:
        if not thread.is_alive():
            raise RuntimeError('Observed HTTP worker did not start')
        time.sleep(.01)
    emit({'kind': 'ready', 'processId': os.getpid(), 'port': config['port'], 'device': str(agent.device),
          'torchThreads': torch.get_num_threads(), 'interopThreads': torch.get_num_interop_threads(),
          'torch': torch.__version__, 'laya': version('laya'), 'transformers': version('transformers'),
          'stockAutocast': stock_amp, 'stockDtype': str(stock_dtype), 'defaultMaxLen': agent.cfg.get('max_len'),
          'defaultHeadMaxLen': agent.cfg.get('head_max_len')})
    try:
        for line in sys.stdin:
            command = json.loads(line)
            try:
                if command['op'] == 'stop':
                    emit({'kind': 'reply', 'id': command['id'], 'stopped': True})
                    break
                if command['op'] == 'precision':
                    with forward_lock:
                        agent.amp_enabled = stock_amp if command['value'] == 'stock' else False
                        agent.dtype = stock_dtype if command['value'] == 'stock' else torch.float32
                    emit({'kind': 'reply', 'id': command['id'], 'autocastEnabled': agent.amp_enabled, 'dtype': str(agent.dtype)})
                    continue
                if command['op'] != 'direct':
                    raise ValueError('Unknown diagnostic operation')
                payload = command['payload']
                window = adapter.complete_token_window(agent, [payload['state']], payload['questions'])
                overrides = {} if command.get('window') == 'defaults' else {
                    'max_len': window['maxLength'], 'head_max_len': window['headMaxLength']}
                with torch.inference_mode():
                    result = agent.predict_batch([payload['state']], payload['questions'], batch_size=adapter.MAX_STATES, **overrides)[0]
                emit({'kind': 'reply', 'id': command['id'], 'result': result, 'window': window,
                      'payloadSha256': sha(payload)})
            except Exception as error:
                emit({'kind': 'reply', 'id': command.get('id'), 'error': type(error).__name__ + ': ' + str(error)})
    finally:
        server.should_exit = True
        thread.join(10)


if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        emit({'kind': 'fatal', 'error': type(error).__name__ + ': ' + str(error)})
        sys.exit(1)

import {spawn} from 'node:child_process';
import {randomBytes} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import path from 'node:path';

/** One trusted local Python instance. No model, token or path reaches logs. */
export async function startLayaService({modelPath, python = '/opt/laya/venv/bin/python',
  port = 8000, startupTimeoutMs = 120_000, shutdownTimeoutMs = 10_000,
  cpuExecutionPolicy = 'sequential',
  device = 'cpu', torchThreads = device==='cuda'?1:2,
  pythonModulePath,
  signal = new AbortController().signal, onUnavailable = () => {},
  spawnProcess = spawn, request = fetch} = {}) {
  if (typeof modelPath !== 'string' || !path.isAbsolute(modelPath)
    || !Number.isSafeInteger(port) || port < 1024 || port > 65535
    || !Number.isSafeInteger(startupTimeoutMs) || startupTimeoutMs < 1
    || !Number.isSafeInteger(shutdownTimeoutMs) || shutdownTimeoutMs < 1
    || !['sequential','packed'].includes(cpuExecutionPolicy)
    || !Number.isSafeInteger(torchThreads) || torchThreads < 1
    || !['cpu','cuda'].includes(device) || (pythonModulePath!==undefined&&!path.isAbsolute(pythonModulePath))
    || !(signal instanceof AbortSignal)) throw new Error('Invalid Laya startup configuration');
  signal.throwIfAborted();
  const key = randomBytes(32).toString('hex');
  const script = fileURLToPath(new URL('../../../scripts/laya/batch-server.py', import.meta.url));
  const environment = Object.fromEntries(['PATH','SystemRoot','WINDIR','TEMP','TMP','LD_LIBRARY_PATH']
    .filter(name => typeof process.env[name] === 'string').map(name => [name, process.env[name]]));
  const child = spawnProcess(python, [script], {windowsHide: true, stdio: 'ignore', env: {
    ...environment, PYTHONUNBUFFERED: '1', HF_HUB_OFFLINE: '1', TRANSFORMERS_OFFLINE: '1',
    LAYA_MODEL_PATH: modelPath, LAYA_PORT: String(port), LAYA_API_KEY: key,
    LAYA_VERIFY_MANIFEST: '1',
    LAYA_CPU_EXECUTION_POLICY: cpuExecutionPolicy,
    LAYA_TORCH_THREADS: String(torchThreads),
    TOKENIZERS_PARALLELISM:'false',OMP_NUM_THREADS:String(torchThreads),MKL_NUM_THREADS:String(torchThreads),
    LAYA_DEVICE:device,...(pythonModulePath?{PYTHONPATH:pythonModulePath}:{}),
  }});
  let ready = false, stopping = false, ended = false;
  const closed = new Promise(resolve => {
    const end = () => {
      if (ended) return;
      ended = true; ready = false; resolve();
      if (!stopping) { try { onUnavailable(); } catch {} }
    };
    child.once('error', end); child.once('exit', end);
  });
  let stoppingPromise;
  const stop = () => {
    if (stoppingPromise) return stoppingPromise;
    stopping = true; ready = false;
    stoppingPromise = (async () => {
      if (ended) return;
      child.kill('SIGTERM');
      const timer = setTimeout(() => { if (!ended) child.kill('SIGKILL'); }, shutdownTimeoutMs);
      try { await closed; } finally { clearTimeout(timer); }
    })();
    return stoppingPromise;
  };
  const cancel = () => { void stop(); };
  signal.addEventListener('abort', cancel, {once: true});
  const deadline = Date.now() + startupTimeoutMs;
  try {
    while (!ended && !signal.aborted && Date.now() < deadline) {
      try {
        const control = AbortSignal.any([signal, AbortSignal.timeout(Math.min(1000, deadline - Date.now()))]);
        const response = await request(`http://127.0.0.1:${port}/health`, {
          headers: {authorization: `Bearer ${key}`}, signal: control, redirect: 'error',
        });
        if (response.ok) {
          const result = await response.json();
          if (result?.status === 'ok' && result.model === 'multilingual' && result.warmed === true
            && Array.isArray(result.capabilities) && result.capabilities.includes('multi_state')
            && result.capabilities.includes('independent_items')
            && result.executionPolicy === cpuExecutionPolicy && result.inferenceMode === 'inference_mode'
            && (result.device===device||device==='cpu'&&result.device===undefined)) {
            if (ended || signal.aborted || Date.now() >= deadline) break;
            ready = true;
            const precision=result.precision&&typeof result.precision.autocastEnabled==='boolean'
              &&['torch.float32','torch.bfloat16','torch.float16'].includes(result.precision.autocastDtype)
              ?structuredClone(result.precision):{status:'unknown'};
            return {port, key, cpuExecutionPolicy,device,torchThreads,precision,processId:result.processId, isReady: () => ready && !ended && !stopping,
              stop: async () => { signal.removeEventListener('abort', cancel); await stop(); }};
          }
        } else await response.body?.cancel();
      } catch { /* Cold loading is expected; readiness still requires authenticated warm health. */ }
      if (!ended && !signal.aborted) await new Promise(resolve => {
        const timer = setTimeout(done, Math.min(100, Math.max(1, deadline - Date.now())));
        function done() { clearTimeout(timer); signal.removeEventListener('abort', done); resolve(); }
        signal.addEventListener('abort', done, {once: true});
      });
    }
    throw new Error('Laya did not become ready');
  } catch {
    signal.removeEventListener('abort', cancel); await stop();
    throw new Error('Owned Laya startup unavailable');
  }
}

import {spawn} from 'node:child_process';
import {createHash, randomBytes} from 'node:crypto';
import {createReadStream, existsSync, readFileSync, readdirSync, realpathSync, statSync} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {ProtocolError} from '@personal-agent/contracts';

/** Discover only this checkout and its Git common root; never download weights. */
export function discoverLocalLaya(projectRoot) {
  const roots = [path.resolve(projectRoot)];
  try {
    const gitFile = path.join(projectRoot, '.git');
    if (statSync(gitFile).isFile()) {
      const match = /^gitdir: (.+)\s*$/m.exec(readFileSync(gitFile, 'utf8'));
      if (match) {
        const gitDir = path.resolve(projectRoot, match[1].trim());
        const commonDir = path.resolve(gitDir, readFileSync(path.join(gitDir, 'commondir'), 'utf8').trim());
        if (path.basename(commonDir) === '.git') roots.push(path.dirname(commonDir));
      }
    }
  } catch { /* A distribution may not have Git metadata. */ }
  const script = path.join(projectRoot, 'scripts/laya/batch-server.py');
  if (!existsSync(script)) return;
  for (const root of roots) {
    const cache = path.join(root, '.cache/laya');
    const python = path.join(cache, 'venv/Scripts/python.exe');
    const snapshots = path.join(cache, 'hf/hub/models--convaiinnovations--laya/snapshots');
    if (!existsSync(python) || !existsSync(snapshots)) continue;
    for (const entry of readdirSync(snapshots, {withFileTypes:true}).filter(entry => entry.isDirectory())) {
      const model = path.join(snapshots, entry.name, 'multilingual');
      const weights = path.join(model, 'model.safetensors');
      if (!existsSync(weights)) continue;
      const relative = path.relative(realpathSync(cache), realpathSync(weights));
      if (relative.startsWith('..') || path.isAbsolute(relative)) continue;
      return {python, model, script};
    }
  }
}

// Contents bind the loaded artifact, while private metadata guards later mutations without rehashing weights.
function artifactFiles(config) {
  const files=[];
  const add=(name,location)=>{
    const stat=statSync(location,{bigint:true});
    if (!stat.isFile()) throw Error('Invalid local model artifact');
    files.push({name,location,stamp:[realpathSync(location),stat.dev,stat.ino,stat.size,stat.mtimeNs,stat.ctimeNs].map(String).join('\0')});
  };
  const visit=(directory,prefix)=>{
    for (const entry of readdirSync(directory,{withFileTypes:true}).sort((a,b)=>a.name.localeCompare(b.name,'en'))) {
      const location=path.join(directory,entry.name), name=`${prefix}/${entry.name}`;
      if (entry.isDirectory()) visit(location,name);
      else add(name,location); // File links in a Hugging Face snapshot are resolved by stat/read.
    }
  };
  visit(config.model,'model');
  if (!files.some(file=>file.name==='model/model.safetensors') || !files.some(file=>file.name.endsWith('.json'))) {
    throw Error('Local model identity is incomplete');
  }
  add('server/batch-server.py',config.script);
  return files;
}
function unchangedArtifact(config,files) {
  try {
    const current=artifactFiles(config);
    return current.length===files.length && current.every((file,index)=>file.name===files[index].name && file.stamp===files[index].stamp);
  } catch {return false;}
}
async function identifyArtifact(config,signal) {
  signal.throwIfAborted();
  const files=artifactFiles(config), hash=createHash('sha256');
  hash.update('desktop-laya-classifier-artifact-v1\0');
  for (const file of files) {
    signal.throwIfAborted();
    const content=createHash('sha256');
    // One bounded buffer and one stream at a time, including large safetensors.
    for await (const chunk of createReadStream(file.location,{signal,highWaterMark:1024*1024})) {
      signal.throwIfAborted();content.update(chunk);
    }
    hash.update(JSON.stringify([file.name,content.digest('hex')]));
  }
  signal.throwIfAborted();
  if (!unchangedArtifact(config,files)) throw Error('Local model changed during identification');
  return {config,files,digest:hash.digest('hex')};
}

/** One explicitly started, owned child. No microphone, cloud call or background restart. */
export function createLocalLayaHost({projectRoot, createService, createChooser, onUpdate = () => {}, port = 8766,
  discover = discoverLocalLaya, launch = spawn, request = fetch, freeMemory = os.freemem,
  startupTimeoutMs = 90_000, now = Date.now, sleep = delay}) {
  if (!Number.isInteger(port) || port < 1024 || port > 65535) throw Error('Invalid Laya loopback port');
  let child, service, chooser, controller, starting, stopping, artifact;
  let admission={tail:Promise.resolve()};
  async function infer(kind,input) {
    if(!readClassifierIdentity()||!(kind==='classify'?service:chooser))throw Error(kind==='classify'?'本地 Laya 尚未就绪':'本地 Laya 决策尚未就绪');
    if(!(input?.signal instanceof AbortSignal))throw new ProtocolError('INVALID_ARGUMENT','Invalid local inference cancellation signal');
    const generation=controller,queue=admission,provider=kind==='classify'?service:chooser;
    const expires=input.deadline===undefined?undefined:typeof input.deadline==='string'?Date.parse(input.deadline):NaN;
    if(expires!==undefined&&!Number.isFinite(expires))throw new ProtocolError('INVALID_ARGUMENT','Invalid local inference deadline');
    const deadline=new AbortController();let timer;
    const arm=()=>{if(expires===undefined)return;const remaining=expires-now();
      if(remaining<=0){deadline.abort(new ProtocolError('TIMEOUT','Local Laya inference deadline expired'));return;}
      timer=setTimeout(arm,Math.min(remaining,2_147_483_647));};
    arm();
    const signal=AbortSignal.any([input.signal,generation.signal,deadline.signal]);
    const previous=queue.tail;let release;
    const turn=new Promise(resolve=>{release=resolve;});queue.tail=previous.then(()=>turn);
    let abort;
    try {
      await new Promise((resolve,reject)=>{
        abort=()=>reject(signal.reason);signal.addEventListener('abort',abort,{once:true});
        if(signal.aborted)abort();else previous.then(resolve);
      });
      signal.throwIfAborted();
      if(controller!==generation||admission!==queue||!readClassifierIdentity())throw new ProtocolError('CANCELLED','Local Laya generation changed');
      const result=await provider[kind]({...input,signal});
      signal.throwIfAborted();
      if(controller!==generation||!readClassifierIdentity())throw new ProtocolError('CANCELLED','Local Laya generation changed');
      return result;
    } finally {clearTimeout(timer);if(abort)signal.removeEventListener('abort',abort);release();}
  }
  let state = 'stopped', reason = '本地分类尚未启动；启动时才加载现有模型';
  /** Trusted host getter: opaque content digest only while this owned process has unchanged loaded artifacts. */
  const readClassifierIdentity=()=>{
    if (state!=='ready' || !artifact || !child || controller?.signal.aborted) return;
    if (!unchangedArtifact(artifact.config,artifact.files)) {
      artifact=undefined;service=undefined;chooser=undefined;controller.abort();
      state='identity_changed';reason='本地模型或服务文件已变化，旧分类身份已撤销；请停止后重新启动';
      return;
    }
    return artifact.digest;
  };
  // Display polling reads known state only; trusted identity reads and inference boundaries revoke stale artifacts.
  const snapshot = () => ({state, ready:state === 'ready', reason, localOnly:true, calibrated:false});
  const publish = () => {try {onUpdate();} catch {}};
  const stop = async () => {
    if (stopping) return stopping;
    controller?.abort(); service = undefined; chooser = undefined; artifact=undefined;
    const owned = child;
    state = owned ? 'stopping' : 'stopped'; reason = owned ? '正在释放本地模型' : '本地模型已停止'; publish();
    if (!owned) return snapshot();
    stopping = (async () => {
      owned.kill();
      const end = now() + 3000;
      while (child === owned && now() < end) await sleep(50);
      if (child === owned) {state = 'stop_unconfirmed'; reason = '模型进程退出尚未确认，请稍后再试';}
      else {state = 'stopped'; reason = '本地模型已停止';}
      publish(); return snapshot();
    })().finally(() => {stopping = undefined;});
    return stopping;
  };
  async function start() {
    if (starting) return starting;
    if (readClassifierIdentity()) return snapshot();
    if (child || stopping) throw Error('本地模型尚未停止');
    const config = discover(projectRoot);
    if (!config) {state = 'unavailable'; reason = '未找到项目内已安装的 Laya 和模型；不会自动下载'; publish(); return snapshot();}
    if (freeMemory() < (Number(process.env.PA_LAYA_MIN_FREE_MEM_BYTES) || (2 * 1024 ** 3))) {
      state = 'memory_insufficient'; reason = '当前可用内存不足 2 GB，暂不加载本地模型；其他功能可继续使用'; publish(); return snapshot();
    }
    controller = new AbortController();admission={tail:Promise.resolve()};
    const signal = controller.signal, key = randomBytes(32).toString('hex');
    artifact=undefined;state = 'starting'; reason = '正在核对并加载本地模型'; publish();
    starting = (async () => {
      try {
        const identified=await identifyArtifact(config,signal);
        signal.throwIfAborted();
        const env = Object.fromEntries(['SystemRoot','WINDIR','PATH','TEMP','TMP','USERPROFILE','APPDATA','LOCALAPPDATA']
          .filter(name => process.env[name] !== undefined).map(name => [name, process.env[name]]));
        const owned = launch(config.python, [config.script], {cwd:projectRoot, windowsHide:true, shell:false,
          stdio:'ignore', env:{...env, LAYA_MODEL_PATH:config.model, LAYA_API_KEY:key, LAYA_PORT:String(port),
            HF_HUB_OFFLINE:'1', TRANSFORMERS_OFFLINE:'1', PYTHONNOUSERSITE:'1'}});
        child = owned;
        const exited = () => {
          if (child !== owned) return;
          child = undefined; service = undefined; chooser = undefined; artifact=undefined;
          if (!signal.aborted) {controller.abort(); state = 'error'; reason = '本地模型进程已退出，请检查安装后重新启动'; publish();}
        };
        owned.once('exit', exited); owned.once('error', exited);
        const end = now() + startupTimeoutMs;
        while (!signal.aborted && child === owned && now() < end) {
          if (!unchangedArtifact(config,identified.files)) throw Error('Local artifact changed while loading');
          try {
            const response = await request(`http://127.0.0.1:${port}/health`, {redirect:'error',
              headers:{authorization:`Bearer ${key}`}, signal:AbortSignal.any([signal, AbortSignal.timeout(1500)])});
            if (response.ok) {
              const value = await response.json();
              if (value.status === 'ok' && value.model === 'multilingual'
                && value.capabilities?.includes('multi_state') && value.maxStates === 4 && !signal.aborted && child === owned) {
                if (!unchangedArtifact(config,identified.files)) throw Error('Local artifact changed while loading');
                service = createService({port, getApiKey:() => key});
                chooser = createChooser?.({port, getApiKey:() => key});
                artifact=identified;
                state = 'ready'; reason = '本机 Laya 已连接；批量分类结果仍需结合来源核对'; publish(); return snapshot();
              }
            } else await response.body?.cancel();
          } catch {if (signal.aborted) break;}
          await sleep(300);
        }
        if (!signal.aborted) throw Error('startup timeout');
      } catch {
        const cancelled=signal.aborted;
        await stop();
        if (!cancelled && state !== 'stop_unconfirmed') {state = 'error'; reason = '本地模型启动未成功，不会切换到云端分类'; publish();}
      }
      return snapshot();
    })().finally(() => {starting = undefined;});
    return starting;
  }
  return {snapshot, start, stop, readClassifierIdentity,
    async classify(input) {
      return infer('classify',input);
    },
    async choose(input) {
      return infer('choose',input);
    },
  };
}

/**
 * Long-running desktop memory reclamation.
 *
 * Electron reports `memory.workingSetSize` in kilobytes. A renderer that grows past the limit is
 * reloaded only after the host confirms that the surface can be reclaimed without unsaved input.
 * Persisted task history survives; editable or unknown surfaces stay open. The Maps it cannot
 * bound are left to heap profiling.
 */
export const DEFAULT_MEMORY_LIMIT_BYTES = 1.5 * 1024 ** 3;
export const DEFAULT_INTERVAL_MS = 60_000;
export const DEFAULT_COOLDOWN_MS = 30 * 60_000;

/** Picks the heaviest renderer above the limit, or `undefined` when everything is healthy. */
export function selectOverLimitRenderer(metrics, limitBytes = DEFAULT_MEMORY_LIMIT_BYTES) {
  if (!Array.isArray(metrics)) return undefined;
  let worst;
  for (const metric of metrics) {
    if (metric?.type !== 'Tab') continue;
    const kilobytes = metric?.memory?.workingSetSize;
    if (!Number.isFinite(kilobytes) || kilobytes <= 0) continue;
    const bytes = kilobytes * 1024;
    if (bytes <= limitBytes) continue;
    if (!worst || bytes > worst.bytes) worst = {pid: metric.pid, bytes};
  }
  return worst;
}

/**
 * `resolveTarget(pid)` returns the renderer's webContents, or nothing when the pid is not one of
 * our windows (a devtools or utility renderer must never be reloaded). `isBusy()` suppresses the
 * reload while a task runs so the user never loses an in-flight answer to a background recycle.
 */
export function createMemoryWatchdog({getMetrics, resolveTarget, limitBytes = DEFAULT_MEMORY_LIMIT_BYTES,
  intervalMs = DEFAULT_INTERVAL_MS, cooldownMs = DEFAULT_COOLDOWN_MS, isBusy = () => false,
  now = Date.now, onReload = () => {}, setInterval: schedule = globalThis.setInterval,
  clearInterval: cancel = globalThis.clearInterval} = {}) {
  if (typeof getMetrics !== 'function' || typeof resolveTarget !== 'function') {
    throw new Error('Memory watchdog requires metrics and a target resolver');
  }
  const reloadedAt = new Map();
  let timer,checking=false,generation=0;
  async function tick() {
    if(checking)return undefined;
    const epoch=generation;
    checking=true;
    try{
    if (isBusy()) return undefined;
    const target = selectOverLimitRenderer(getMetrics(), limitBytes);
    if (!target) return undefined;
    if (now() - (reloadedAt.get(target.pid) ?? 0) < cooldownMs) return undefined;
    const contents = await resolveTarget(target.pid);
    if (epoch!==generation || isBusy() || !contents || contents.isDestroyed?.()) return undefined;
    reloadedAt.set(target.pid, now());
    contents.reload();
    onReload(target);
    return target;
    }catch{return undefined;}finally{checking=false;}
  }
  return {
    tick,
    start() {
      if (timer === undefined) {
        timer = schedule(tick, intervalMs);
        timer?.unref?.();
      }
      return timer;
    },
    stop() {
      generation++;
      if (timer !== undefined) cancel(timer);
      timer = undefined;
    },
    reloadedAt,
  };
}

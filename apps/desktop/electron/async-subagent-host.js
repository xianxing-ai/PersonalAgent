/** Desktop adapter. Admission and cancellation stay in Runtime; this file does not start tasks itself. */
export function createAsyncSubagentHost({runtimeModule, getRuntime, subagentOptions, getGrantedTools}) {
  const controller = runtimeModule.createDesktopAsyncSubagentTools({...subagentOptions, getGrantedTools,
    onReport: () => { /* The background list reads the same checkpoint on refresh. */ }});
  let timer;
  return {
    tools: controller.tools,
    start() {
      if (timer) return;
      timer = setInterval(() => {void controller.pump().catch(() => {});}, 1000);
      timer.unref?.();
      void controller.recover().catch(() => {});
    },
    stop() { if (timer) clearInterval(timer); timer = undefined; },
    pump() { return controller.pump(); },
    list() { return {items: controller.list()}; },
    instruct(payload) {
      return controller.instruct(payload?.parentTaskId, payload?.subtaskId, payload?.instruction, payload?.expectedControlRevision);
    },
    stopChild(payload) { return controller.stop(payload?.parentTaskId, payload?.subtaskId); },
  };
}

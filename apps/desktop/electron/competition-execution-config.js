const TIMER_LIMIT=2_147_483_647;

function positive(environment,name,fallback,maximum=Number.MAX_SAFE_INTEGER) {
  const raw=environment[name];
  if(raw===undefined||raw==='')return fallback;
  const value=typeof raw==='string'&&/^[1-9][0-9]*$/u.test(raw)?Number(raw):NaN;
  if(!Number.isSafeInteger(value)||value<1||value>maximum)
    throw new Error(`${name} must be a positive integer supported by the execution host`);
  return value;
}

/** Host settings only. These affect newly accepted tasks, never old receipts or deadlines. */
export function readCompetitionExecutionPolicy(environment=process.env) {
  const initialWindowSteps=positive(environment,'PA_AGENTARTS_EXECUTION_WINDOW_STEPS',32);
  const maxSteps=positive(environment,'PA_AGENTARTS_EXECUTION_MAX_STEPS',undefined);
  const taskTimeoutMs=positive(environment,'PA_AGENTARTS_TASK_TIMEOUT_MS',30*60_000,TIMER_LIMIT);
  return Object.freeze({initialWindowSteps,taskTimeoutMs,
    policy:Object.freeze({mode:'progressive',windowSteps:initialWindowSteps,...(maxSteps===undefined?{}:{maxSteps})})});
}

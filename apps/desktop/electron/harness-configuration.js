import {MAX_COORDINATION_GOAL_CHARACTERS} from '@personal-agent/contracts';

const fail=()=>{throw Error('开发者 Harness 配置无效');};
const keys=(value,allowed)=>value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).every(key=>allowed.includes(key));
const text=value=>typeof value==='string'&&value.trim().length>0&&!/[\u0000-\u001f]/u.test(value);
const positive=value=>Number.isSafeInteger(value)&&value>0;
const policyKeys=['version','triggerCharacters','targetCharacters','maxCharacters','retainMessages','maxSourceMessages','segmentCharacters','maxSummaryCharacters'];

// Product defaults for new configurations. Existing explicit budgets are retained.
export const DEFAULT_HARNESS_STEPS=32;
export const DEFAULT_CONTEXT_OUTPUT_TOKENS=2048;
export const DEFAULT_CONTEXT_POLICY=Object.freeze({triggerCharacters:96000,targetCharacters:64000,
  maxCharacters:128000,retainMessages:8,maxSourceMessages:2000,segmentCharacters:32000,maxSummaryCharacters:4000});

/** Shared validation inside the existing encrypted model configuration host. */
export function validateContextConfiguration(value) {
  if(!keys(value,['enabled','modelId','configurationRef','maxOutputTokens','policy'])||typeof value.enabled!=='boolean')fail();
  const settings=value.enabled||value.modelId!==undefined||value.configurationRef!==undefined||value.maxOutputTokens!==undefined||value.policy!==undefined;
  if(!settings)return {enabled:false};
  if(!text(value.modelId)||!text(value.configurationRef)||!positive(value.maxOutputTokens)
    ||!keys(value.policy,policyKeys)||Object.keys(value.policy).length!==policyKeys.length)fail();
  const policy=value.policy;
  if(!text(policy.version)||!policyKeys.filter(key=>!['version','retainMessages'].includes(key)).every(key=>positive(policy[key]))
    ||!Number.isSafeInteger(policy.retainMessages)||policy.retainMessages<0||policy.retainMessages>=policy.maxSourceMessages
    ||policy.targetCharacters>policy.triggerCharacters||policy.triggerCharacters>policy.maxCharacters||policy.maxCharacters>MAX_COORDINATION_GOAL_CHARACTERS)fail();
  return structuredClone(value);
}
export function validateHarnessConfiguration(value) {
  if(!keys(value,['version','revision','enabled','maxExecutorSteps','context','events'])||value.version!==1||!text(value.revision)
    ||typeof value.enabled!=='boolean'||(value.enabled||value.maxExecutorSteps!==undefined)&&!positive(value.maxExecutorSteps))fail();
  const events=value.events??{enabled:false,quiet:false};
  if(!keys(events,['enabled','quiet'])||typeof events.enabled!=='boolean'||typeof events.quiet!=='boolean')fail();
  return {version:1,revision:value.revision,enabled:value.enabled,
    ...(value.maxExecutorSteps===undefined?{}:{maxExecutorSteps:value.maxExecutorSteps}),
    context:validateContextConfiguration(value.context),events:{enabled:events.enabled,quiet:events.quiet}};
}

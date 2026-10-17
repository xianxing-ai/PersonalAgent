/** The owned host selects the existing MaaS compatibility format before measurement. */
export function ownedModelRequestFormat({endpoint,model}) {
  const base = new URL(endpoint);
  const maasDeepSeek = base.origin === 'https://api.modelarts-maas.com' &&
    base.pathname.replace(/\/+$/,'') === '/openai/v1' &&
    ['deepseek-v4-flash','deepseek-v4.1-flash'].includes(model);
  return maasDeepSeek ? 'huawei-maas-deepseek-thinking-v1' : undefined;
}

/** Transport only: keep the measured body intact and refuse redirects. */
export function createOwnedModelFetch({fetch:request=globalThis.fetch} = {}) {
  return (input,init) => request(input,{...init,redirect:'error'});
}

/** MaaS DeepSeek uses the documented thinking switch, not reasoning_effort:none. */
export function createOwnedModelFetch({endpoint,model,fetch:request=globalThis.fetch}) {
  const base = new URL(endpoint);
  const maasDeepSeek = base.origin === 'https://api.modelarts-maas.com' &&
    base.pathname.replace(/\/+$/,'') === '/openai/v1' &&
    ['deepseek-v4-flash','deepseek-v4.1-flash'].includes(model);
  return (input,init) => {
    let options = {...init,redirect:'error'};
    if (maasDeepSeek && typeof init?.body === 'string') {
      const body = JSON.parse(init.body);
      if (body.reasoning_effort === 'none') {
        delete body.reasoning_effort;
        body.chat_template_kwargs = {...body.chat_template_kwargs,thinking:false};
        options = {...options,body:JSON.stringify(body)};
      }
    }
    return request(input,options);
  };
}

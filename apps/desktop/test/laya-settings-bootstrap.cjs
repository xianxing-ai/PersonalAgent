// Test-only bootstrap. Install before importing the actual Main so hosts which
// capture fetch during construction use this guard for their whole lifetime.
function installLayaSmokeNetworkGuard(target = globalThis) {
  const originalFetch = target.fetch;
  const network = {health:0, blocked:0, receipts:[]};
  target.layaSmokeNetwork = network;
  target.fetch = async (input, options) => {
    const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url);
    if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || url.port !== '8766'
      || url.pathname !== '/health' || url.search || url.hash || url.username || url.password
      || (options?.method ?? input?.method ?? 'GET').toUpperCase() !== 'GET') {
      network.blocked++;
      throw Error('Only the original local health check is allowed by this smoke');
    }
    network.health++;
    const response = await originalFetch(input, options);
    if (response.ok) {
      const value = await response.clone().json();
      network.receipts.push({status:value.status, model:value.model, warmed:value.warmed,
        device:value.device, inferenceCalls:value.inferenceCalls});
    }
    return response;
  };
  return network;
}

async function runLayaSmokeBootstrap(loadMain, target = globalThis) {
  installLayaSmokeNetworkGuard(target);
  await loadMain();
}

module.exports = {installLayaSmokeNetworkGuard, runLayaSmokeBootstrap};

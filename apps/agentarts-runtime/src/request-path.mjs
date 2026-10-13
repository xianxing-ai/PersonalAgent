// AgentArts prefix routing may preserve the published endpoint query and
// /invocations/{custom_path}. Credentials are accepted only in headers.
const aliases = new Map([
  ['/ping','/ping'], ['/invocations','/invocations'], ['/bindings','/bindings'],
  ['/invocation-status','/invocation-status'], ['/ws','/ws'],
  ['/invocations/bindings','/bindings'], ['/invocations/invocation-status','/invocation-status'],
  ['/invocations/ws','/ws'],
]);
export function ownedRequestPath(raw) {
  if (typeof raw !== 'string') return undefined;
  const index = raw.indexOf('?');
  const path = index < 0 ? raw : raw.slice(0,index);
  if (index >= 0) {
    const query = new URLSearchParams(raw.slice(index+1));
    if ([...query].length !== 1 || !query.has('endpoint') ||
        !/^[A-Za-z0-9_-]{1,64}$/.test(query.get('endpoint'))) return undefined;
  }
  return aliases.get(path);
}

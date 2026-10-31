import { ProtocolError, validateToolValue } from '@personal-agent/contracts';
import type { ToolHost } from '@personal-agent/contracts';
import { githubOperations, isGitHubWrite } from './provider.js';
import type { GitHubInputs, GitHubProvider } from './provider.js';
import { GitHubService } from './service.js';
import { inputSchema } from './schemas.js';
import { outputSchema } from './output-schemas.js';
import { GITHUB_CONNECTOR_VERSION } from './connector.js';
export * from './provider.js';
export { GitHubService } from './service.js';
export { GitHubConnector, GITHUB_CONNECTOR_VERSION } from './connector.js';
export { GhCliProvider } from './gh.js';
export type { GhProviderOptions } from './gh.js';
export {createGitHubF18F19Tools} from './f18-f19.js';
export type {GitHubF18F19Options} from './f18-f19.js';
export { SpawnGhCommandRunner } from './runner.js';
export type { GhCommand, GhCommandResult, GhCommandRunner } from './runner.js';
export { FakeGitHubProvider } from './fake-provider.js';
export type { GitHubFakeFixtures } from './fake-provider.js';
export { redactGitHubText } from './redact.js';
export {registerGitHubRepairLinks, githubRepairOperations, githubRepairCheckName} from './repair-link.js';
export type {GitHubRepairModuleOptions} from './repair-link.js';
export interface GitHubModuleOptions { provider: GitHubProvider }
export function register(host: ToolHost, options: GitHubModuleOptions): () => void {
  if (!options?.provider) throw new ProtocolError('INVALID_ARGUMENT', 'Explicit GitHub provider required');
  const service = new GitHubService(options.provider);
  const dispose: (() => void)[] = [];
  try {
    for (const op of githubOperations) {
      const write = isGitHubWrite(op);
      dispose.push(host.register({descriptor: {
        name: `github.${op}`, version: GITHUB_CONNECTOR_VERSION,
        inputSchema: inputSchema(op), outputSchema: outputSchema(op),
        sideEffect: write ? 'external_write' : 'read', requiredScopes: [write ? 'github:write' : 'github:read'],
        idempotencySupport: !write, recoverySupport: !write, requiresPresence: write,
      }, execute: async (input, context) => {
        // Only the trusted Runtime gateway decides/consumes authorizations.
        // This guard rejects accidental direct execution without a host context.
        const scope = write ? 'github:write' : 'github:read';
        if (!context?.authorizationRef || !context.scopes.includes(scope)) throw new ProtocolError('SCOPE_DENIED', 'GitHub tool requires host authorization and scope');
        const result = await service.execute(op, input as GitHubInputs[typeof op], context);
        // The gateway does not infer outer outcome from a nested result.state.
        // Unknown writes must enter Runtime reconciliation rather than confirmed.
        if (write && (result as {state?: string}).state !== 'confirmed') throw new ProtocolError('RESULT_UNKNOWN', 'GitHub write outcome unknown; reconcile before any retry');
        try { validateToolValue(outputSchema(op), result); }
        catch { throw new ProtocolError(write ? 'RESULT_UNKNOWN' : 'EXTERNAL_FAILURE', 'GitHub provider returned an invalid result'); }
        return result;
      }}));
    }
  } catch (error) { for (const unregister of dispose.reverse()) unregister(); service.dispose(); throw error; }
  let disposed = false;
  return () => { if (disposed) return; disposed = true; for (const unregister of dispose.reverse()) unregister(); service.dispose(); };
}

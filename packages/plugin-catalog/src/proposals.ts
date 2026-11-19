import {assertMcpReadbackReceipt, assertSkillReadbackReceipt, planMcpSkillReadbackAcceptance} from '@personal-agent/mcp';
import type {McpSkillReadbackAcceptancePlan, SkillReadbackReceipt} from '@personal-agent/mcp';
import type {InstallationRecord} from './service.js';
import type {PluginManifest} from './schema.js';

export interface PluginCloudProposal {
  catalogId: string;
  type: 'mcp' | 'skill';
  state: 'pending';
  pinSha256?: string;
  skillDigest?: string;
  packageVersion?: string;
}

export interface EnabledPluginProjection {
  proposals: readonly PluginCloudProposal[];
  skillReceipts: readonly SkillReadbackReceipt[];
  acceptance: McpSkillReadbackAcceptancePlan;
}

/** Enabled plugins become pending proposals. This does not claim a cloud execution. */
export function projectEnabledPlugins(installations: readonly InstallationRecord[], catalog: readonly PluginManifest[]): EnabledPluginProjection {
  const known = new Map(catalog.map(entry => [entry.id, entry]));
  const proposals: PluginCloudProposal[] = [];
  const skillReceipts: SkillReadbackReceipt[] = [];
  for (const record of installations) {
    if (!record.enabled) continue;
    const entry = known.get(record.catalogId);
    if (!entry) continue;
    const proposal: PluginCloudProposal = {catalogId: record.catalogId, type: record.type, state: 'pending'};
    if (record.pin.sha256) proposal.pinSha256 = record.pin.sha256;
    if (record.skill) proposal.skillDigest = record.skill.digest;
    if (record.mcp) proposal.packageVersion = record.mcp.packageVersion;
    proposals.push(proposal);
    if (record.type === 'skill' && record.skill) {
      skillReceipts.push(assertSkillReadbackReceipt({state: 'pending', selectionRef: record.catalogId, sourceRef: record.skill.digest}));
    }
  }
  return {proposals, skillReceipts, acceptance: planMcpSkillReadbackAcceptance()};
}

export function readBackPluginMcpReceipt(receipt: unknown): {path: string; text: string; contentDigest: string; source: 'mcp'; serverVersion: string} {
  return assertMcpReadbackReceipt(receipt);
}

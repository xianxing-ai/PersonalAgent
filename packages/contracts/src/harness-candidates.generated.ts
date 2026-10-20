// Generated from schema/harness-candidates.json. Do not edit.

export type Id = string;
export type Sha = string;

/**
 * Provisional trial identity. Parsing is not authorization or trusted execution evidence.
 */
export interface HarnessCandidateBinding {
  version: 1;
  candidateId: Id;
  artifactId: Id;
  taskId: Id;
  trialTaskId: Id;
  workspaceId: Id;
  sessionId: Id;
  baselineSnapshotId: Id;
  inputDigest: Sha;
  configurationDigest: Sha;
  workflowVersion: Id;
  runtimeVersion: Id;
  recipeFingerprint: Sha;
  artifactDigest: Sha;
  /**
   * @maxItems 16
   */
  parentArtifactDigests:
    | []
    | [Sha]
    | [Sha, Sha]
    | [Sha, Sha, Sha]
    | [Sha, Sha, Sha, Sha]
    | [Sha, Sha, Sha, Sha, Sha]
    | [Sha, Sha, Sha, Sha, Sha, Sha]
    | [Sha, Sha, Sha, Sha, Sha, Sha, Sha]
    | [Sha, Sha, Sha, Sha, Sha, Sha, Sha, Sha]
    | [Sha, Sha, Sha, Sha, Sha, Sha, Sha, Sha, Sha]
    | [Sha, Sha, Sha, Sha, Sha, Sha, Sha, Sha, Sha, Sha]
    | [Sha, Sha, Sha, Sha, Sha, Sha, Sha, Sha, Sha, Sha, Sha]
    | [Sha, Sha, Sha, Sha, Sha, Sha, Sha, Sha, Sha, Sha, Sha, Sha]
    | [Sha, Sha, Sha, Sha, Sha, Sha, Sha, Sha, Sha, Sha, Sha, Sha, Sha]
    | [Sha, Sha, Sha, Sha, Sha, Sha, Sha, Sha, Sha, Sha, Sha, Sha, Sha, Sha]
    | [Sha, Sha, Sha, Sha, Sha, Sha, Sha, Sha, Sha, Sha, Sha, Sha, Sha, Sha, Sha]
    | [Sha, Sha, Sha, Sha, Sha, Sha, Sha, Sha, Sha, Sha, Sha, Sha, Sha, Sha, Sha, Sha];
  executionKind: "real_host" | "synthetic";
}
